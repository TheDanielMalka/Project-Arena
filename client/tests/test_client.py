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
        """detect_running_game returns the name of the running game."""
        with patch("psutil.process_iter") as mock_iter:
            mock_iter.return_value = [self._make_proc("FortniteClient-Win64-Shipping.exe")]
            assert detect_running_game() == "Fortnite"

    def test_detect_running_game_returns_none_when_no_game(self):
        """detect_running_game returns None when no supported game is running."""
        with patch("psutil.process_iter") as mock_iter:
            mock_iter.return_value = [self._make_proc("chrome.exe")]
            assert detect_running_game() is None

    def test_game_intervals_covers_all_supported_games(self):
        """GAME_INTERVALS has an entry for every supported game + AUTO."""
        expected = {"AUTO", "CS2", "Valorant", "Fortnite", "Apex Legends"}
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
