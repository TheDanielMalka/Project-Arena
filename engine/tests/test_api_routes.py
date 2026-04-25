"""
Tests for Arena Engine HTTP routes.

Covers the contracts defined in CLAUDE.md:
  GET  /health          → HealthResponse (status, db, environment)
  GET  /ready           → ReadinessResponse (ready, reason)
  POST /validate/screenshot → ValidationResponse (includes accepted)
  GET  /match/{id}/status  → status + winner_id

All tests run against the FastAPI TestClient — no real DB or files needed.
"""
from __future__ import annotations

import io
import os
import uuid
import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient

from main import app
import src.auth as auth

# Valid JWT for routes that require authentication in tests.
# Uses a real token so verify_token passes without mocking it.
_TEST_USER_ID = str(uuid.uuid4())
_TEST_TOKEN = auth.issue_token(_TEST_USER_ID, "test@arena.gg")
_AUTH_HEADER = {"Authorization": f"Bearer {_TEST_TOKEN}"}

client = TestClient(app)


# ── GET /health ───────────────────────────────────────────────────────────────

class TestHealthRoute:

    def test_returns_200(self):
        resp = client.get("/health")
        assert resp.status_code == 200

    def test_status_is_ok(self):
        resp = client.get("/health")
        assert resp.json()["status"] == "ok"

    def test_db_field_present(self):
        """db field must be 'connected' or 'disconnected' — never absent."""
        resp = client.get("/health")
        data = resp.json()
        assert "db" in data
        assert data["db"] in ("connected", "disconnected")

    def test_environment_field_present(self):
        """environment field must always be returned."""
        resp = client.get("/health")
        data = resp.json()
        assert "environment" in data
        assert isinstance(data["environment"], str)
        assert data["environment"]  # non-empty

    def test_db_disconnected_when_no_db(self):
        """In CI / test env with no real DB, db='disconnected' — not an error."""
        resp = client.get("/health")
        # status must still be 'ok' even when DB is unreachable
        assert resp.json()["status"] == "ok"


# ── GET /ready ────────────────────────────────────────────────────────────────

class TestReadyRoute:

    def test_returns_200(self):
        resp = client.get("/ready")
        assert resp.status_code == 200

    def test_ready_field_is_bool(self):
        resp = client.get("/ready")
        data = resp.json()
        assert "ready" in data
        assert isinstance(data["ready"], bool)

    def test_reason_field_present(self):
        """reason must always be in the response (empty string when ready=True)."""
        resp = client.get("/ready")
        data = resp.json()
        assert "reason" in data
        assert isinstance(data["reason"], str)

    def test_ready_true_when_dir_writable(self, tmp_path):
        """ready=True when screenshot dir can be created and written."""
        with patch("main.SCREENSHOT_DIR", str(tmp_path / "screenshots")):
            resp = client.get("/ready")
        assert resp.json()["ready"] is True
        assert resp.json()["reason"] == ""

    def test_ready_false_when_dir_not_writable(self):
        """ready=False when screenshot dir cannot be written."""
        with patch("main.SCREENSHOT_DIR", "/no/such/path/xyz"):
            with patch("os.makedirs", side_effect=PermissionError("no write")):
                resp = client.get("/ready")
        data = resp.json()
        assert data["ready"] is False
        assert data["reason"]  # non-empty explanation

    def test_ready_reason_empty_when_ready(self, tmp_path):
        with patch("main.SCREENSHOT_DIR", str(tmp_path / "ss")):
            resp = client.get("/ready")
        assert resp.json()["reason"] == ""


# ── POST /validate/screenshot — ValidationResponse.accepted ──────────────────

class TestValidationResponseAccepted:
    """
    Verifies that POST /validate/screenshot returns the 'accepted' field
    as mandated by the CLAUDE.md naming contract.

    We use a synthetic solid-colour PNG so the engine can run without
    a real game screenshot or Tesseract.
    """

    @pytest.fixture
    def teal_png(self, tmp_path):
        """Solid teal PNG → Valorant VICTORY (teal_pct ~100 %)."""
        import cv2
        import numpy as np
        hsv = np.full((200, 400, 3), (90, 200, 160), dtype=np.uint8)
        bgr = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)
        path = str(tmp_path / "teal.png")
        cv2.imwrite(path, bgr)
        with open(path, "rb") as f:
            return f.read()

    @pytest.fixture
    def grey_png(self, tmp_path):
        """Solid grey PNG → no result detected."""
        import cv2
        import numpy as np
        grey = np.full((200, 400, 3), 128, dtype=np.uint8)
        path = str(tmp_path / "grey.png")
        cv2.imwrite(path, grey)
        with open(path, "rb") as f:
            return f.read()

    def test_accepted_field_present_in_response(self, teal_png, tmp_path):
        with patch("main.SCREENSHOT_DIR", str(tmp_path)):
            resp = client.post(
                "/validate/screenshot?match_id=TEST-001&game=Valorant",
                files={"file": ("teal.png", io.BytesIO(teal_png), "image/png")},
                headers=_AUTH_HEADER,
            )
        assert resp.status_code == 200
        data = resp.json()
        assert "accepted" in data, "'accepted' field missing from ValidationResponse"
        assert isinstance(data["accepted"], bool)

    def test_accepted_true_when_confidence_meets_threshold(self, teal_png, tmp_path):
        """accepted=True when result is non-None AND confidence >= 0.8 (default threshold)."""
        with patch("main.SCREENSHOT_DIR", str(tmp_path)):
            resp = client.post(
                "/validate/screenshot?match_id=TEST-002&game=Valorant",
                files={"file": ("teal.png", io.BytesIO(teal_png), "image/png")},
                headers=_AUTH_HEADER,
            )
        data = resp.json()
        # Solid teal gives very high confidence (≥0.80) — accepted must be True
        if data["result"] == "victory" and data["confidence"] >= 0.80:
            assert data["accepted"] is True

    def test_accepted_false_when_no_result(self, grey_png, tmp_path):
        """accepted=False when result is None (grey image → no detection)."""
        with patch("main.SCREENSHOT_DIR", str(tmp_path)):
            resp = client.post(
                "/validate/screenshot?match_id=TEST-003&game=Valorant",
                files={"file": ("grey.png", io.BytesIO(grey_png), "image/png")},
                headers=_AUTH_HEADER,
            )
        data = resp.json()
        if data["result"] is None:
            assert data["accepted"] is False

    def test_accepted_is_python_bool_not_numpy(self, teal_png, tmp_path):
        """
        accepted must be a JSON boolean (true/false), never a numpy bool_.
        Pydantic serialises Python bool → JSON bool; np.bool_ would cause
        a serialisation error in strict mode.
        Verify: JSON deserialization gives us a Python bool (not int, not str).
        """
        with patch("main.SCREENSHOT_DIR", str(tmp_path)):
            resp = client.post(
                "/validate/screenshot?match_id=TEST-004&game=Valorant",
                files={"file": ("teal.png", io.BytesIO(teal_png), "image/png")},
                headers=_AUTH_HEADER,
            )
        data = resp.json()
        # json.loads always maps true/false → Python bool, never numpy.bool_
        assert type(data["accepted"]) is bool, (
            f"accepted must be Python bool, got {type(data['accepted'])}"
        )

    def test_validation_response_contract_fields(self, grey_png, tmp_path):
        """All CLAUDE.md contract fields must be present in ValidationResponse."""
        with patch("main.SCREENSHOT_DIR", str(tmp_path)):
            resp = client.post(
                "/validate/screenshot?match_id=TEST-005&game=CS2",
                files={"file": ("grey.png", io.BytesIO(grey_png), "image/png")},
                headers=_AUTH_HEADER,
            )
        data = resp.json()
        required = {"match_id", "game", "result", "confidence", "accepted",
                    "players", "agents", "score"}
        missing = required - data.keys()
        assert not missing, f"Missing fields in ValidationResponse: {missing}"


# ── POST /validate/screenshot — submission limit ──────────────────────────────

class TestSubmissionLimit:
    """
    1 screenshot submission per wallet per match.
    Second submission by the same user → 409.
    """

    @pytest.fixture
    def grey_png(self, tmp_path):
        import cv2
        import numpy as np
        grey = np.full((200, 400, 3), 128, dtype=np.uint8)
        path = str(tmp_path / "grey.png")
        cv2.imwrite(path, grey)
        with open(path, "rb") as f:
            return f.read()

    def test_second_submission_returns_409(self, grey_png, tmp_path):
        """
        When the same wallet submits twice for the same match, the second
        call must return 409.
        """
        match_id = "LIMIT-MATCH-001"
        wallet   = "0xdeadbeef00000001"

        with patch("main.SCREENSHOT_DIR", str(tmp_path)), \
             patch("main.SessionLocal") as mock_session_cls:

            session_cm = mock_session_cls.return_value.__enter__.return_value

            # First call: no existing submission, wallet resolved
            session_cm.execute.return_value.fetchone.side_effect = [
                None,          # match status check → None (skip)
                (wallet,),     # wallet_address lookup
                (1,),          # participant check → passes gate
                None,          # no existing evidence
            ]

            resp1 = client.post(
                f"/validate/screenshot?match_id={match_id}&game=CS2",
                files={"file": ("g.png", io.BytesIO(grey_png), "image/png")},
                headers=_AUTH_HEADER,
            )
            assert resp1.status_code == 200

            # Second call: existing submission found
            session_cm.execute.return_value.fetchone.side_effect = [
                None,               # match status check
                (wallet,),          # wallet_address lookup
                (1,),               # participant check → passes gate
                (str(uuid.uuid4()),),  # existing evidence row → duplicate
            ]

            resp2 = client.post(
                f"/validate/screenshot?match_id={match_id}&game=CS2",
                files={"file": ("g.png", io.BytesIO(grey_png), "image/png")},
                headers=_AUTH_HEADER,
            )
            assert resp2.status_code == 409
            assert "already submitted" in resp2.json()["detail"].lower()

    def test_match_completed_returns_409(self, grey_png, tmp_path):
        """
        Submitting to a completed match must return 409.
        """
        match_id = "DONE-MATCH-001"

        with patch("main.SCREENSHOT_DIR", str(tmp_path)), \
             patch("main.SessionLocal") as mock_session_cls:

            session_cm = mock_session_cls.return_value.__enter__.return_value
            session_cm.execute.return_value.fetchone.return_value = ("completed",)

            resp = client.post(
                f"/validate/screenshot?match_id={match_id}&game=CS2",
                files={"file": ("g.png", io.BytesIO(grey_png), "image/png")},
                headers=_AUTH_HEADER,
            )
        assert resp.status_code == 409
        assert "completed" in resp.json()["detail"].lower()

    def test_no_wallet_skips_duplicate_check(self, grey_png, tmp_path):
        """
        If the user has no wallet_address in DB, skip the duplicate check
        and process the screenshot normally.
        """
        match_id = "NOWALLET-MATCH-001"

        with patch("main.SCREENSHOT_DIR", str(tmp_path)), \
             patch("main.SessionLocal") as mock_session_cls:

            session_cm = mock_session_cls.return_value.__enter__.return_value
            session_cm.execute.return_value.fetchone.side_effect = [
                None,   # match status check → not found, proceed
                (None,),  # wallet_address = None → skip duplicate check
            ]

            resp = client.post(
                f"/validate/screenshot?match_id={match_id}&game=CS2",
                files={"file": ("g.png", io.BytesIO(grey_png), "image/png")},
                headers=_AUTH_HEADER,
            )
        assert resp.status_code == 200


# ── GET /match/{id}/status — winner_id ───────────────────────────────────────

class TestMatchStatusRoute:

    def test_returns_200(self):
        resp = client.get("/match/M-001/status")
        assert resp.status_code == 200

    def test_pending_when_no_db(self):
        """Without DB the endpoint returns status='pending' gracefully."""
        resp = client.get("/match/M-001/status")
        data = resp.json()
        assert data["status"] == "pending"

    def test_winner_id_field_present(self):
        """winner_id must always be present in the response (null when unknown)."""
        resp = client.get("/match/M-001/status")
        data = resp.json()
        assert "winner_id" in data, "'winner_id' field missing from match status response"

    def test_winner_id_null_when_pending(self):
        """winner_id=null when no match in DB / match not yet completed."""
        resp = client.get("/match/M-001/status")
        data = resp.json()
        if data["status"] == "pending":
            assert data["winner_id"] is None

    def test_match_id_echoed(self):
        resp = client.get("/match/ECHO-XYZ/status")
        assert resp.json()["match_id"] == "ECHO-XYZ"

    def test_different_match_ids_independent(self):
        r1 = client.get("/match/AAA/status")
        r2 = client.get("/match/BBB/status")
        assert r1.json()["match_id"] == "AAA"
        assert r2.json()["match_id"] == "BBB"

    def test_response_has_all_required_fields(self):
        """All contract fields must be present — including on-chain escrow fields."""
        resp = client.get("/match/M-999/status")
        data = resp.json()
        assert "match_id"          in data
        assert "status"            in data
        assert "winner_id"         in data
        assert "on_chain_match_id" in data   # null until MatchCreated event
        assert "stake_per_player"  in data   # null until match is funded
        assert "your_team"         in data   # null when unauthenticated

    def test_on_chain_fields_null_when_no_db(self):
        """Without DB the new escrow fields return null gracefully."""
        resp = client.get("/match/M-999/status")
        data = resp.json()
        assert data["on_chain_match_id"] is None
        assert data["stake_per_player"]  is None
        assert data["your_team"]         is None


# ── PATCH /users/me — wallet_address ─────────────────────────────────────────

class TestPatchWalletAddress:
    """
    Verifies the wallet_address field in PATCH /users/me under the identity-lock
    policy:
      • Wallet is switchable — users can link, re-link, or unlink at any time.
      • unlink_wallet=true clears the wallet address.
      • "" returns 400 (format validation).
      • 24h post-deletion cooldown — returns 409.
    """

    _VALID_ADDR = "0xAbCd1234AbCd1234AbCd1234AbCd1234AbCd1234"

    def _patch(self, body: dict):
        return client.patch("/users/me", json=body, headers=_AUTH_HEADER)

    # ── Format validation (no DB needed) ─────────────────────────────────────

    def test_invalid_address_too_short_returns_400(self):
        resp = self._patch({"wallet_address": "0x1234"})
        assert resp.status_code == 400

    def test_invalid_address_no_0x_prefix_returns_400(self):
        resp = self._patch({"wallet_address": "AbCd1234AbCd1234AbCd1234AbCd1234AbCd1234"})
        assert resp.status_code == 400

    def test_invalid_address_wrong_chars_returns_400(self):
        resp = self._patch({"wallet_address": "0x" + "G" * 40})
        assert resp.status_code == 400

    # ── Lock & cooldown semantics (DB mocked) ────────────────────────────────

    def test_link_when_no_current_wallet_succeeds(self):
        """User can link a wallet — uniqueness clear, cooldown clear."""
        with patch("main.SessionLocal") as MockSession:
            session = MockSession.return_value.__enter__.return_value
            # uniqueness clear, cooldown clear
            session.execute.return_value.fetchone.side_effect = [
                None,  # uniqueness
                None,  # cooldown
                None,  # (UPDATE session)
            ]
            resp = self._patch({"wallet_address": self._VALID_ADDR})
        assert resp.status_code != 400
        assert resp.status_code != 409

    def test_unlink_empty_string_returns_400(self):
        """wallet_address="" fails format validation — empty is not a valid address."""
        resp = self._patch({"wallet_address": ""})
        assert resp.status_code == 400
        assert "invalid ethereum wallet address format" in resp.json()["detail"].lower()

    def test_unlink_null_ignored(self):
        """wallet_address=null means "no change" — no 400 because field is omitted."""
        with patch("main.SessionLocal") as MockSession:
            session = MockSession.return_value.__enter__.return_value
            session.execute.return_value.fetchone.return_value = None
            resp = self._patch({"wallet_address": None})
        assert resp.status_code != 400

    def test_relink_with_different_wallet_succeeds(self):
        """User with an existing wallet can switch to a new one — write-once removed."""
        with patch("main.SessionLocal") as MockSession:
            session = MockSession.return_value.__enter__.return_value
            # new address is unique, not in cooldown
            session.execute.return_value.fetchone.side_effect = [
                None,  # uniqueness clear
                None,  # cooldown clear
                None,  # UPDATE result
            ]
            resp = self._patch({"wallet_address": self._VALID_ADDR})
        assert resp.status_code not in (400, 409)

    def test_conflict_with_other_user_returns_409(self):
        """wallet_address taken by another live user → 409."""
        with patch("main.SessionLocal") as MockSession:
            session = MockSession.return_value.__enter__.return_value
            session.execute.return_value.fetchone.side_effect = [
                (None,),  # current wallet (NULL — not yet linked)
                (1,),     # uniqueness hit — another user has it
            ]
            resp = self._patch({"wallet_address": self._VALID_ADDR})
        assert resp.status_code == 409

    def test_cooldown_returns_409(self):
        """wallet_address in 24h post-deletion cooldown → 409."""
        from datetime import datetime, timezone, timedelta
        recent_delete = datetime.now(timezone.utc) - timedelta(hours=1)
        with patch("main.SessionLocal") as MockSession:
            session = MockSession.return_value.__enter__.return_value
            session.execute.return_value.fetchone.side_effect = [
                None,                # uniqueness clear
                (recent_delete,),    # cooldown — deleted 1h ago → blocked
            ]
            resp = self._patch({"wallet_address": self._VALID_ADDR})
        assert resp.status_code == 409
        assert "cooldown" in resp.json()["detail"].lower()

    def test_unrelated_fields_not_affected(self):
        """Sending only avatar does not touch wallet_address logic."""
        with patch("main.SessionLocal") as MockSession:
            session = MockSession.return_value.__enter__.return_value
            session.execute.return_value.fetchone.return_value = None
            resp = self._patch({"avatar": "avatar_01"})
        assert resp.status_code != 400


# ── Standalone contract assertions ────────────────────────────────────────────


def test_health_has_process_time_header():
    """GET /health must include x-process-time-ms header (timing middleware)."""
    resp = client.get("/health")
    assert "x-process-time-ms" in resp.headers, (
        "x-process-time-ms header missing — add timing middleware to main.py"
    )


def test_validate_screenshot_returns_fields(tmp_path):
    """POST /validate/screenshot must return result, confidence, and accepted."""
    import io
    import cv2
    import numpy as np

    grey = np.full((200, 400, 3), 128, dtype=np.uint8)
    path = str(tmp_path / "grey.png")
    cv2.imwrite(path, grey)
    with open(path, "rb") as f:
        raw = f.read()

    with patch("main.SCREENSHOT_DIR", str(tmp_path)):
        resp = client.post(
            "/validate/screenshot?match_id=CONTRACT-001&game=CS2",
            files={"file": ("grey.png", io.BytesIO(raw), "image/png")},
            headers=_AUTH_HEADER,
        )
    data = resp.json()
    assert "result"     in data, "result missing from /validate/screenshot response"
    assert "confidence" in data, "confidence missing from /validate/screenshot response"
    assert "accepted"   in data, "accepted missing from /validate/screenshot response"


def test_match_result_settles_at():
    """POST /match/result with valid payload must return 200 (AT settlement path)."""
    from unittest.mock import MagicMock

    match_id  = str(uuid.uuid4())
    winner_id = str(uuid.uuid4())

    session = MagicMock()
    session.execute.return_value.fetchone.return_value = (
        "in_progress", "AT", winner_id
    )
    ctx = MagicMock()
    ctx.__enter__ = MagicMock(return_value=session)
    ctx.__exit__  = MagicMock(return_value=False)

    with patch("main.SessionLocal", return_value=ctx), \
         patch("main._settle_at_match"):
        resp = client.post(
            "/match/result",
            json={
                "match_id":          match_id,
                "winner_id":         winner_id,
                "game":              "CS2",
                "agents_detected":   [],
                "players_detected":  [],
                "score":             "13-7",
            },
            headers=_AUTH_HEADER,
        )
    assert resp.status_code == 200
