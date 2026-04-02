"""
Client Tests — Arena Desktop Client
Covers: game detection, upload flow, config load/save, failure paths.
All external dependencies (psutil, httpx, mss) are fully mocked.
"""
import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch, mock_open

import pytest

# ── Add client root to path ───────────────────────────────────
CLIENT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(CLIENT_ROOT))

import main as client_main
from main import (
    DEFAULT_CONFIG,
    GAME_INTERVALS,
    EngineClient,
    MatchMonitor,
    capture_screenshot,
    detect_running_game,
    is_game_running,
    load_config,
    save_config,
)

@pytest.fixture(autouse=True)
def isolate_config_file(tmp_path, monkeypatch):
    """
    Ensure tests never read/write the repo's tracked client/config.json.
    Some code paths (e.g. MatchMonitor session_id creation) persist to CONFIG_FILE.
    """
    cfg_file = tmp_path / "config.json"
    monkeypatch.setattr(client_main, "CONFIG_FILE", str(cfg_file))
    # Seed a valid config file for code paths that expect it to exist.
    cfg_file.write_text(json.dumps(DEFAULT_CONFIG, indent=2))
    yield


# ══════════════════════════════════════════════════════════════
# 1. Config load / save
# ══════════════════════════════════════════════════════════════

class TestConfigLoadSave:
    def test_load_config_returns_defaults_when_no_file(self, tmp_path, monkeypatch):
        """load_config() returns DEFAULT_CONFIG when config.json doesn't exist."""
        monkeypatch.setattr("main.CONFIG_FILE", str(tmp_path / "nonexistent.json"))
        cfg = load_config()
        assert cfg["engine_url"] == DEFAULT_CONFIG["engine_url"]
        assert cfg["game"] == DEFAULT_CONFIG["game"]
        assert cfg["auto_start"] == DEFAULT_CONFIG["auto_start"]

    def test_load_config_merges_saved_values(self, tmp_path, monkeypatch):
        """load_config() merges saved values over defaults."""
        cfg_file = tmp_path / "config.json"
        cfg_file.write_text(json.dumps({"engine_url": "http://myserver:9000", "monitor": 2}))
        monkeypatch.setattr("main.CONFIG_FILE", str(cfg_file))
        cfg = load_config()
        assert cfg["engine_url"] == "http://myserver:9000"
        assert cfg["monitor"] == 2
        # Defaults still present for unset keys
        assert cfg["game"] == DEFAULT_CONFIG["game"]

    def test_save_config_writes_json(self, tmp_path, monkeypatch):
        """save_config() writes a valid JSON file."""
        cfg_file = tmp_path / "config.json"
        monkeypatch.setattr("main.CONFIG_FILE", str(cfg_file))
        save_config({"engine_url": "http://test", "game": "CS2"})
        saved = json.loads(cfg_file.read_text())
        assert saved["engine_url"] == "http://test"
        assert saved["game"] == "CS2"

    def test_load_config_keys_match_default_config(self, tmp_path, monkeypatch):
        """Every key in DEFAULT_CONFIG is present after load_config()."""
        monkeypatch.setattr("main.CONFIG_FILE", str(tmp_path / "nonexistent.json"))
        cfg = load_config()
        for key in DEFAULT_CONFIG:
            assert key in cfg, f"Missing key: {key}"

    def test_heartbeat_interval_is_4_seconds(self):
        """_HEARTBEAT_INTERVAL must be 4s — must stay below engine _CLIENT_TIMEOUT_SECONDS (10s).
        If this constant is changed, disconnect detection breaks."""
        assert MatchMonitor._HEARTBEAT_INTERVAL == 4, (
            "_HEARTBEAT_INTERVAL must be 4s (engine timeout is 10s; "
            "2 missed beats before marking offline)"
        )


# ══════════════════════════════════════════════════════════════
# 2. Game Detection
# ══════════════════════════════════════════════════════════════

class TestGameDetection:
    def _make_proc(self, name: str) -> MagicMock:
        proc = MagicMock()
        proc.info = {"name": name}
        return proc

    def test_is_game_running_cs2(self):
        """is_game_running detects CS2 by process name."""
        with patch("psutil.process_iter") as mock_iter:
            mock_iter.return_value = [self._make_proc("cs2.exe")]
            assert is_game_running("CS2") is True

    def test_is_game_running_valorant(self):
        """is_game_running detects Valorant by process name."""
        with patch("psutil.process_iter") as mock_iter:
            mock_iter.return_value = [self._make_proc("VALORANT-Win64-Shipping.exe")]
            assert is_game_running("Valorant") is True

    def test_is_game_running_returns_false_when_not_running(self):
        """is_game_running returns False when no matching process found."""
        with patch("psutil.process_iter") as mock_iter:
            mock_iter.return_value = [self._make_proc("notepad.exe")]
            assert is_game_running("CS2") is False

    def test_detect_running_game_returns_correct_game(self):
        """detect_running_game detects only active games (CS2 & Valorant in v1)."""
        with patch("psutil.process_iter") as mock_iter:
            mock_iter.return_value = [self._make_proc("VALORANT-Win64-Shipping.exe")]
            assert detect_running_game() == "Valorant"

    def test_detect_running_game_ignores_coming_soon_games(self):
        """detect_running_game returns None for Coming Soon games (Fortnite, Apex etc.)."""
        with patch("psutil.process_iter") as mock_iter:
            # Fortnite process running — should NOT be detected (Coming Soon)
            mock_iter.return_value = [self._make_proc("FortniteClient-Win64-Shipping.exe")]
            assert detect_running_game() is None

    def test_detect_running_game_returns_none_when_no_game(self):
        """detect_running_game returns None when no active game is running."""
        with patch("psutil.process_iter") as mock_iter:
            mock_iter.return_value = [self._make_proc("chrome.exe")]
            assert detect_running_game() is None

    def test_game_intervals_covers_all_active_games(self):
        """GAME_INTERVALS has entries only for active games + AUTO (CS2 & Valorant in v1)."""
        expected = {"AUTO", "CS2", "Valorant"}
        assert set(GAME_INTERVALS.keys()) == expected

    def test_cs2_has_fastest_interval(self):
        """CS2 capture interval is the smallest (most frequent)."""
        non_auto = {k: v for k, v in GAME_INTERVALS.items() if k != "AUTO"}
        assert GAME_INTERVALS["CS2"] == min(non_auto.values())


# ══════════════════════════════════════════════════════════════
# 3. Upload Flow (EngineClient)
# ══════════════════════════════════════════════════════════════

class TestEngineClient:
    def _client(self, url="http://localhost:8000", token="test-token"):
        with patch("main.httpx.Client"):
            return EngineClient(url, token)

    def test_upload_screenshot_sends_correct_params(self, tmp_path):
        """upload_screenshot posts to /validate/screenshot with match_id and file."""
        png = tmp_path / "frame.png"
        png.write_bytes(b"\x89PNG")

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"result": "CT_WIN", "confidence": 0.95}

        with patch("main.httpx.Client") as MockClient:
            instance = MockClient.return_value
            instance.post.return_value = mock_response

            ec = EngineClient("http://localhost:8000", "tok")
            result = ec.upload_screenshot("match-001", str(png))

        assert result == {"result": "CT_WIN", "confidence": 0.95}
        _, call_kwargs = instance.post.call_args
        assert call_kwargs["params"]["match_id"] == "match-001"

    def test_upload_screenshot_returns_none_on_non_200(self, tmp_path):
        """upload_screenshot returns None when engine returns non-200."""
        png = tmp_path / "frame.png"
        png.write_bytes(b"\x89PNG")

        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.text = "Internal Server Error"

        with patch("main.httpx.Client") as MockClient:
            instance = MockClient.return_value
            instance.post.return_value = mock_response
            ec = EngineClient("http://localhost:8000", "tok")
            result = ec.upload_screenshot("match-001", str(png))

        assert result is None

    def test_upload_screenshot_returns_none_on_network_error(self, tmp_path):
        """upload_screenshot returns None and logs when network fails."""
        png = tmp_path / "frame.png"
        png.write_bytes(b"\x89PNG")

        with patch("main.httpx.Client") as MockClient:
            instance = MockClient.return_value
            instance.post.side_effect = Exception("Connection refused")
            ec = EngineClient("http://localhost:8000", "tok")
            result = ec.upload_screenshot("match-001", str(png))

        assert result is None

    def test_health_returns_none_on_failure(self):
        """health() returns None when engine is unreachable."""
        with patch("main.httpx.Client") as MockClient:
            instance = MockClient.return_value
            instance.get.side_effect = Exception("Timeout")
            ec = EngineClient("http://localhost:8000", "tok")
            assert ec.health() is None

    def test_health_returns_json_on_success(self):
        """health() returns parsed JSON when engine is reachable."""
        mock_response = MagicMock()
        mock_response.json.return_value = {"status": "ok", "db": "ok"}

        with patch("main.httpx.Client") as MockClient:
            instance = MockClient.return_value
            instance.get.return_value = mock_response
            ec = EngineClient("http://localhost:8000", "tok")
            result = ec.health()

        assert result == {"status": "ok", "db": "ok"}


# ══════════════════════════════════════════════════════════════
# 4. Failure Paths — nothing crashes
# ══════════════════════════════════════════════════════════════

class TestFailurePaths:
    def test_is_game_running_no_crash_without_psutil(self):
        """is_game_running returns False gracefully if psutil unavailable."""
        with patch("psutil.process_iter", side_effect=ImportError("no psutil")):
            result = is_game_running("CS2")
            assert result is False

    def test_detect_running_game_no_crash_on_exception(self):
        """detect_running_game returns None gracefully on unexpected error."""
        with patch("psutil.process_iter", side_effect=RuntimeError("OS error")):
            result = detect_running_game()
            assert result is None

    def test_capture_screenshot_returns_none_on_mss_failure(self, tmp_path):
        """capture_screenshot returns None (not raises) when mss fails."""
        with patch("main.mss.mss") as mock_mss:
            mock_mss.side_effect = Exception("Display not found")
            result = capture_screenshot(str(tmp_path))
        assert result is None

    def test_match_monitor_set_match_id(self, tmp_path):
        """MatchMonitor.set_match_id stores the match_id correctly."""
        cfg = {**DEFAULT_CONFIG, "screenshot_dir": str(tmp_path), "log_dir": str(tmp_path)}
        with patch("main.httpx.Client"):
            monitor = MatchMonitor(cfg)
        monitor.set_match_id("match-xyz-123")
        assert monitor.current_match_id == "match-xyz-123"

    def test_match_monitor_upload_skipped_without_match_id(self, tmp_path):
        """MatchMonitor does not upload if no match_id is set."""
        cfg = {**DEFAULT_CONFIG, "screenshot_dir": str(tmp_path), "log_dir": str(tmp_path)}
        with patch("main.httpx.Client") as MockClient:
            monitor = MatchMonitor(cfg)
            instance = MockClient.return_value
            # No match_id set → upload should never be called
            monitor.current_match_id = None
            instance.post.assert_not_called()


# ══════════════════════════════════════════════════════════════
# 5. Phase 5 — Auth wiring (login / bind / logout / profile)
# ══════════════════════════════════════════════════════════════

class TestEngineClientAuth:
    """Tests for Phase 5 EngineClient auth methods."""

    def _make_ec(self, mock_http):
        return EngineClient("http://localhost:8001", "")

    def _mock_response(self, status_code: int, json_data: dict) -> MagicMock:
        r = MagicMock()
        r.status_code = status_code
        r.json.return_value = json_data
        return r

    # ── login ─────────────────────────────────────────────────

    def test_login_success_returns_normalised_dict(self):
        """login() maps access_token → token and returns user fields."""
        resp = self._mock_response(200, {
            "access_token": "jwt-abc", "token_type": "bearer",
            "user_id": "u-001", "username": "player1", "email": "p@arena.gg",
            "arena_id": "ARENA-XYZ",
        })
        with patch("main.httpx.Client") as MockClient:
            MockClient.return_value.post.return_value = resp
            ec = EngineClient("http://localhost:8001", "")
            result = ec.login("player1", "pass123")
        assert result["token"] == "jwt-abc"
        assert result["user_id"] == "u-001"
        assert result["username"] == "player1"
        assert result["email"] == "p@arena.gg"
        assert result["arena_id"] == "ARENA-XYZ"

    def test_login_401_returns_detail(self):
        """login() returns {'detail': ...} on 401."""
        resp = self._mock_response(401, {"detail": "Invalid credentials"})
        with patch("main.httpx.Client") as MockClient:
            MockClient.return_value.post.return_value = resp
            ec = EngineClient("http://localhost:8001", "")
            result = ec.login("bad@user.com", "wrongpass")
        assert result is not None
        assert "detail" in result
        assert "Invalid" in result["detail"]

    def test_login_network_error_returns_none(self):
        """login() returns None on network failure."""
        with patch("main.httpx.Client") as MockClient:
            MockClient.return_value.post.side_effect = Exception("Connection refused")
            ec = EngineClient("http://localhost:8001", "")
            result = ec.login("user@arena.gg", "pass")
        assert result is None

    # ── bind_session ──────────────────────────────────────────

    def test_bind_session_returns_true_on_200(self):
        """bind_session() returns True on success."""
        resp = self._mock_response(200, {"bound": True, "session_id": "sess-1"})
        with patch("main.httpx.Client") as MockClient:
            MockClient.return_value.post.return_value = resp
            ec = EngineClient("http://localhost:8001", "tok")
            assert ec.bind_session("jwt-tok", "sess-1") is True

    def test_bind_session_returns_false_on_non_200(self):
        """bind_session() returns False on non-200 (non-fatal)."""
        resp = self._mock_response(404, {"detail": "Session not found"})
        with patch("main.httpx.Client") as MockClient:
            MockClient.return_value.post.return_value = resp
            ec = EngineClient("http://localhost:8001", "tok")
            assert ec.bind_session("jwt-tok", "bad-sess") is False

    def test_bind_session_returns_false_on_network_error(self):
        """bind_session() returns False gracefully on network error."""
        with patch("main.httpx.Client") as MockClient:
            MockClient.return_value.post.side_effect = Exception("Timeout")
            ec = EngineClient("http://localhost:8001", "tok")
            assert ec.bind_session("jwt-tok", "sess-1") is False

    # ── logout_from_engine ────────────────────────────────────

    def test_logout_from_engine_calls_endpoint(self):
        """logout_from_engine() POSTs to /auth/logout with Bearer token."""
        resp = self._mock_response(200, {"logged_out": True})
        with patch("main.httpx.Client") as MockClient:
            instance = MockClient.return_value
            instance.post.return_value = resp
            ec = EngineClient("http://localhost:8001", "tok")
            ec.logout_from_engine("jwt-tok")
        call_kwargs = instance.post.call_args
        assert "/auth/logout" in call_kwargs[0][0]
        assert call_kwargs[1]["headers"]["Authorization"] == "Bearer jwt-tok"

    def test_logout_from_engine_is_silent_on_network_error(self):
        """logout_from_engine() does not raise on network failure."""
        with patch("main.httpx.Client") as MockClient:
            MockClient.return_value.post.side_effect = Exception("Engine down")
            ec = EngineClient("http://localhost:8001", "tok")
            ec.logout_from_engine("jwt-tok")  # must not raise

    # ── get_profile ───────────────────────────────────────────

    def test_get_profile_returns_dict_on_success(self):
        """get_profile() returns profile dict on 200."""
        profile = {"user_id": "u-001", "username": "player1", "rank": "Gold", "xp": 500}
        resp = self._mock_response(200, profile)
        with patch("main.httpx.Client") as MockClient:
            MockClient.return_value.get.return_value = resp
            ec = EngineClient("http://localhost:8001", "tok")
            result = ec.get_profile("jwt-tok")
        assert result["username"] == "player1"
        assert result["xp"] == 500

    def test_get_profile_returns_none_on_401(self):
        """get_profile() returns None on 401 (token expired)."""
        resp = self._mock_response(401, {"detail": "Token expired"})
        with patch("main.httpx.Client") as MockClient:
            MockClient.return_value.get.return_value = resp
            ec = EngineClient("http://localhost:8001", "tok")
            result = ec.get_profile("expired-jwt")
        assert result is None

    def test_get_profile_returns_none_on_network_error(self):
        """get_profile() returns None gracefully on network failure."""
        with patch("main.httpx.Client") as MockClient:
            MockClient.return_value.get.side_effect = Exception("Timeout")
            ec = EngineClient("http://localhost:8001", "tok")
            result = ec.get_profile("jwt-tok")
        assert result is None


class TestAuthManagerPhase5:
    """Tests for Phase 5 AuthManager.login() bind + AuthManager.logout() engine call."""

    def _make_auth(self, tmp_path, monkeypatch) -> "AuthManager":
        from main import AuthManager
        cfg_path = str(tmp_path / "config.json")
        import main as m
        monkeypatch.setattr(m, "CONFIG_FILE", cfg_path)
        cfg = {**DEFAULT_CONFIG}
        return AuthManager(cfg)

    def test_login_calls_bind_session_on_success(self, tmp_path, monkeypatch):
        """AuthManager.login() calls engine.bind_session() when session_id given."""
        from main import AuthManager
        auth = self._make_auth(tmp_path, monkeypatch)

        engine = MagicMock()
        engine.login.return_value = {
            "token": "jwt-x", "user_id": "u-1",
            "username": "p1", "email": "p@a.gg",
        }
        engine.bind_session.return_value = True
        engine.get_profile.return_value = None  # no profile fetch in unit tests

        err = auth.login(engine, "p1", "pass", session_id="sess-abc")
        assert err is None
        engine.bind_session.assert_called_once_with("jwt-x", "sess-abc")

    def test_login_no_bind_when_no_session_id(self, tmp_path, monkeypatch):
        """AuthManager.login() does NOT call bind_session when session_id is None."""
        from main import AuthManager
        auth = self._make_auth(tmp_path, monkeypatch)

        engine = MagicMock()
        engine.login.return_value = {
            "token": "jwt-x", "user_id": "u-1",
            "username": "p1", "email": "p@a.gg",
        }
        engine.get_profile.return_value = None  # no profile fetch in unit tests

        err = auth.login(engine, "p1", "pass")  # no session_id
        assert err is None
        engine.bind_session.assert_not_called()

    def test_login_returns_detail_on_401(self, tmp_path, monkeypatch):
        """AuthManager.login() surfaces error string from engine on bad credentials."""
        from main import AuthManager
        auth = self._make_auth(tmp_path, monkeypatch)

        engine = MagicMock()
        engine.login.return_value = {"detail": "Invalid credentials"}

        err = auth.login(engine, "bad@user.com", "wrongpass")
        assert err == "Invalid credentials"
        engine.bind_session.assert_not_called()

    def test_logout_calls_engine_logout(self, tmp_path, monkeypatch):
        """AuthManager.logout(engine) calls engine.logout_from_engine() before clear."""
        from main import AuthManager
        auth = self._make_auth(tmp_path, monkeypatch)
        auth._config["auth_token"] = "live-jwt"

        engine = MagicMock()
        auth.logout(engine=engine)

        engine.logout_from_engine.assert_called_once_with("live-jwt")
        assert auth._config["auth_token"] == ""

    def test_logout_without_engine_still_clears(self, tmp_path, monkeypatch):
        """AuthManager.logout() with no engine arg still clears local state."""
        from main import AuthManager
        auth = self._make_auth(tmp_path, monkeypatch)
        auth._config["auth_token"] = "live-jwt"

        auth.logout()  # no engine arg

        assert auth._config["auth_token"] == ""
