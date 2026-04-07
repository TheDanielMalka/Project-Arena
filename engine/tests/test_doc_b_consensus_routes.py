"""
Tests for Step 3 — MatchConsensus DB persistence routes:

  POST /validate/screenshot  — returns consensus_status / consensus_result
  GET  /match/{id}/consensus — reads votes from match_consensus table

All tests mock SessionLocal; no real DB needed.
"""
from __future__ import annotations

import io
import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app
import src.auth as auth

client = TestClient(app)

# ── Shared helpers ─────────────────────────────────────────────────────────────

_USER_ID    = str(uuid.uuid4())
_MATCH_ID   = str(uuid.uuid4())
_WALLET     = "0xDEADBEEF"
_TOKEN      = auth.issue_token(_USER_ID, "user@arena.gg")
_AUTH_HDRS  = {"Authorization": f"Bearer {_TOKEN}"}


def _make_session(fetchone=None, fetchall=None):
    """Context-manager-compatible session mock."""
    session = MagicMock()
    session.execute.return_value.fetchone.return_value = fetchone
    session.execute.return_value.fetchall.return_value = fetchall or []
    session.execute.return_value.rowcount = 1
    ctx = MagicMock()
    ctx.__enter__ = MagicMock(return_value=session)
    ctx.__exit__  = MagicMock(return_value=False)
    return ctx, session


def _tiny_png() -> bytes:
    """1×1 white PNG — valid enough for VisionEngine to process without crashing."""
    import base64
    # Minimal valid PNG
    return base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8"
        "z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg=="
    )


# ═══════════════════════════════════════════════════════════════════════════════
# GET /match/{id}/consensus
# ═══════════════════════════════════════════════════════════════════════════════

class TestMatchConsensusRoute:
    """GET /match/{id}/consensus reads from match_consensus table."""

    def test_no_votes_returns_no_data(self):
        """No rows in match_consensus → status='no_data'."""
        ctx, session = _make_session()
        # fetchall for votes → []
        # fetchone for max_players → (2,)
        session.execute.return_value.fetchall.return_value = []
        session.execute.return_value.fetchone.return_value = (2,)

        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get(f"/match/{_MATCH_ID}/consensus")

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "no_data"
        assert data["total_votes"] == 0
        assert data["submissions"] == []

    def test_one_vote_pending(self):
        """1 vote for a 2-player match → status='pending'."""
        now = datetime.now(timezone.utc)
        vote_rows = [(_WALLET, "CT_WIN", 0.95, now)]
        ctx, session = _make_session()
        session.execute.return_value.fetchall.return_value = vote_rows
        session.execute.return_value.fetchone.return_value = (2,)

        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get(f"/match/{_MATCH_ID}/consensus")

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "pending"
        assert data["total_votes"] == 1
        assert len(data["submissions"]) == 1
        assert data["submissions"][0]["wallet_address"] == _WALLET
        assert data["submissions"][0]["result"] == "CT_WIN"

    def test_two_votes_unanimous_reached(self):
        """2 votes, both agree on CT_WIN → status='reached'."""
        now = datetime.now(timezone.utc)
        vote_rows = [
            (_WALLET,           "CT_WIN", 0.95, now),
            ("0xANOTHERWALLET", "CT_WIN", 0.91, now),
        ]
        ctx, session = _make_session()
        session.execute.return_value.fetchall.return_value = vote_rows
        session.execute.return_value.fetchone.return_value = (2,)

        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get(f"/match/{_MATCH_ID}/consensus")

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "reached"
        assert data["agreed_result"] == "CT_WIN"
        assert data["agreeing_votes"] == 2

    def test_split_vote_failed(self):
        """2 players, each reports a different result → status='failed'."""
        now = datetime.now(timezone.utc)
        vote_rows = [
            (_WALLET,           "CT_WIN", 0.95, now),
            ("0xANOTHERWALLET", "T_WIN",  0.90, now),
        ]
        ctx, session = _make_session()
        session.execute.return_value.fetchall.return_value = vote_rows
        session.execute.return_value.fetchone.return_value = (2,)

        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get(f"/match/{_MATCH_ID}/consensus")

        assert resp.status_code == 200
        data = resp.json()
        # 50/50 split → FAILED (below 60% threshold)
        assert data["status"] == "failed"
        assert data["agreed_result"] is None

    def test_db_error_returns_error_status(self):
        """DB failure returns error status gracefully (no 500)."""
        with patch("main.SessionLocal", side_effect=Exception("DB down")):
            resp = client.get(f"/match/{_MATCH_ID}/consensus")

        assert resp.status_code == 200
        assert resp.json()["status"] == "error"

    def test_unknown_match_max_players_defaults_to_2(self):
        """When max_players row not found, defaults to expected_players=2."""
        now = datetime.now(timezone.utc)
        vote_rows = [(_WALLET, "victory", 0.88, now)]
        ctx, session = _make_session()
        session.execute.return_value.fetchall.return_value = vote_rows
        session.execute.return_value.fetchone.return_value = None  # no match row

        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get(f"/match/{_MATCH_ID}/consensus")

        assert resp.status_code == 200
        data = resp.json()
        assert data["expected_players"] == 2


# ═══════════════════════════════════════════════════════════════════════════════
# POST /validate/screenshot — consensus_status / consensus_result in response
# ═══════════════════════════════════════════════════════════════════════════════

class TestValidateScreenshotConsensus:
    """
    POST /validate/screenshot now returns consensus_status and consensus_result.

    The VisionEngine is mocked so these tests don't need a real screenshot.
    The consensus submit step uses a mocked SessionLocal.
    """

    def _mock_output(self, result="CT_WIN", confidence=0.95):
        """Build a minimal VisionEngineOutput mock."""
        from src.vision.engine import VisionEngineOutput
        return VisionEngineOutput(
            result=result,
            confidence=confidence,
            players=[],
            accepted=True,
            score=None,
        )

    def _post_screenshot(self, session_mock_ctx):
        """
        POST /validate/screenshot with all filesystem I/O mocked out.

        Patches applied every time:
          - builtins.open      → mock_open() — no real file created (CI-safe)
          - shutil.copyfileobj → no-op
          - main.VisionEngine  → returns self._mock_output()
          - save_evidence      → None
          - main.SessionLocal  → session_mock_ctx
        """
        from unittest.mock import mock_open as _mock_open
        png = _tiny_png()
        with patch("builtins.open", _mock_open()), \
             patch("shutil.copyfileobj"), \
             patch("main.SessionLocal", return_value=session_mock_ctx), \
             patch("main.VisionEngine") as MockEngine, \
             patch("src.vision.matcher.save_evidence", return_value=None):
            MockEngine.return_value.process_frame.return_value = self._mock_output()
            return client.post(
                f"/validate/screenshot?match_id={_MATCH_ID}&game=CS2",
                files={"file": ("ss.png", io.BytesIO(png), "image/png")},
                headers=_AUTH_HDRS,
            )

    def test_response_contains_consensus_fields(self):
        """Response always contains consensus_status and consensus_result keys."""
        ctx, session = _make_session()
        # Chain: status check, wallet+dup, evidence insert, max_players, consensus restore+persist
        session.execute.return_value.fetchone.side_effect = [
            ("in_progress",),  # match status
            (_WALLET, None),   # wallet + dup (no existing)
        ]
        # fetchall for consensus restore → no prior votes
        session.execute.return_value.fetchall.return_value = []

        resp = self._post_screenshot(ctx)
        assert resp.status_code == 200
        body = resp.json()
        assert "consensus_status" in body
        assert "consensus_result" in body

    def test_consensus_status_pending_on_first_vote(self):
        """First vote in a 2-player room → consensus_status='pending'."""
        ctx, session = _make_session()
        session.execute.return_value.fetchone.side_effect = [
            ("in_progress",),  # match status
            (_WALLET, None),   # wallet + no dup
        ]
        session.execute.return_value.fetchall.return_value = []

        # max_players = 2, no prior votes → after 1 vote: PENDING
        from src.vision.consensus import ConsensusStatus
        from unittest.mock import mock_open as _mock_open
        with patch("builtins.open", _mock_open()), \
             patch("shutil.copyfileobj"), \
             patch("main.SessionLocal", return_value=ctx), \
             patch("main.VisionEngine") as MockEngine, \
             patch("src.vision.matcher.save_evidence", return_value=None), \
             patch("src.vision.consensus.MatchConsensus.submit",
                   return_value=ConsensusStatus.PENDING), \
             patch("src.vision.consensus.MatchConsensus._restore_from_db"):
            MockEngine.return_value.process_frame.return_value = self._mock_output()
            resp = client.post(
                f"/validate/screenshot?match_id={_MATCH_ID}&game=CS2",
                files={"file": ("ss.png", io.BytesIO(_tiny_png()), "image/png")},
                headers=_AUTH_HDRS,
            )

        assert resp.status_code == 200
        assert resp.json()["consensus_status"] == "pending"
        assert resp.json()["consensus_result"] is None

    def test_consensus_result_set_when_reached(self):
        """When consensus is REACHED, consensus_result is set in the response."""
        ctx, session = _make_session()
        session.execute.return_value.fetchone.side_effect = [
            ("in_progress",),
            (_WALLET, None),
        ]
        session.execute.return_value.fetchall.return_value = []

        from src.vision.consensus import ConsensusStatus, ConsensusResult

        mock_verdict = ConsensusResult(
            status=ConsensusStatus.REACHED,
            agreed_result="CT_WIN",
            total_players=2,
            agreeing_players=2,
            flagged_wallets=[],
            submissions=[],
        )

        from unittest.mock import mock_open as _mock_open
        with patch("builtins.open", _mock_open()), \
             patch("shutil.copyfileobj"), \
             patch("main.SessionLocal", return_value=ctx), \
             patch("main.VisionEngine") as MockEngine, \
             patch("src.vision.matcher.save_evidence", return_value=None), \
             patch("src.vision.consensus.MatchConsensus.submit",
                   return_value=ConsensusStatus.REACHED), \
             patch("src.vision.consensus.MatchConsensus.evaluate",
                   return_value=mock_verdict), \
             patch("src.vision.consensus.MatchConsensus._restore_from_db"):
            MockEngine.return_value.process_frame.return_value = self._mock_output()
            resp = client.post(
                f"/validate/screenshot?match_id={_MATCH_ID}&game=CS2",
                files={"file": ("ss.png", io.BytesIO(_tiny_png()), "image/png")},
                headers=_AUTH_HDRS,
            )

        assert resp.status_code == 200
        assert resp.json()["consensus_status"] == "reached"
        assert resp.json()["consensus_result"] == "CT_WIN"

    def test_consensus_none_when_vision_returns_no_result(self):
        """When vision output.result is None, consensus step is skipped entirely."""
        ctx, session = _make_session()
        session.execute.return_value.fetchone.side_effect = [
            ("in_progress",),
            (_WALLET, None),
        ]

        from src.vision.engine import VisionEngineOutput
        no_result_output = VisionEngineOutput(
            result=None, confidence=0.0, players=[], accepted=False
        )

        from unittest.mock import mock_open as _mock_open
        with patch("builtins.open", _mock_open()), \
             patch("shutil.copyfileobj"), \
             patch("main.SessionLocal", return_value=ctx), \
             patch("main.VisionEngine") as MockEngine:
            MockEngine.return_value.process_frame.return_value = no_result_output
            resp = client.post(
                f"/validate/screenshot?match_id={_MATCH_ID}&game=CS2",
                files={"file": ("ss.png", io.BytesIO(_tiny_png()), "image/png")},
                headers=_AUTH_HDRS,
            )

        assert resp.status_code == 200
        assert resp.json()["consensus_status"] is None
        assert resp.json()["consensus_result"] is None

    def test_evidence_saved_even_when_result_is_none(self):
        """match_evidence INSERT is executed even when vision returns result=None."""
        ctx, session = _make_session()
        session.execute.return_value.fetchone.side_effect = [
            ("in_progress",),
            (_WALLET, None),
        ]

        from src.vision.engine import VisionEngineOutput
        no_result_output = VisionEngineOutput(
            result=None, confidence=0.0, players=[], accepted=False
        )

        from unittest.mock import mock_open as _mock_open
        with patch("builtins.open", _mock_open()), \
             patch("shutil.copyfileobj"), \
             patch("main.SessionLocal", return_value=ctx), \
             patch("main.VisionEngine") as MockEngine:
            MockEngine.return_value.process_frame.return_value = no_result_output
            resp = client.post(
                f"/validate/screenshot?match_id={_MATCH_ID}&game=CS2",
                files={"file": ("ss.png", io.BytesIO(_tiny_png()), "image/png")},
                headers=_AUTH_HDRS,
            )

        assert resp.status_code == 200
        # session.execute must have been called for the INSERT (even with no result)
        assert session.execute.called


# ═══════════════════════════════════════════════════════════════════════════════
# _auto_payout_on_consensus — unit tests
# ═══════════════════════════════════════════════════════════════════════════════

class TestAutoPayout:
    """Direct unit tests for _auto_payout_on_consensus()."""

    def _make_session(self, winner_row=None):
        session = MagicMock()
        session.execute.return_value.fetchone.return_value = winner_row
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__  = MagicMock(return_value=False)
        return MagicMock(return_value=ctx), session

    def test_at_match_calls_settle(self):
        """AT match: _settle_at_match called with correct args."""
        import uuid as _uuid2
        winner_uid = str(_uuid2.uuid4())
        sf, session = self._make_session(winner_row=(winner_uid, "AT"))

        with patch("main.SessionLocal", sf), \
             patch("main._settle_at_match") as mock_settle:
            from main import _auto_payout_on_consensus
            _auto_payout_on_consensus("match-1", "victory")

        mock_settle.assert_called_once_with("match-1", winner_uid)

    def test_crypto_match_calls_declare_winner(self):
        """CRYPTO match: EscrowClient.declare_winner called."""
        import uuid as _uuid2
        winner_uid = str(_uuid2.uuid4())
        sf, session = self._make_session(winner_row=(winner_uid, "CRYPTO"))
        mock_escrow = MagicMock()
        mock_escrow.declare_winner.return_value = "0xTX"

        with patch("main.SessionLocal", sf), \
             patch("main._escrow_client", mock_escrow):
            from main import _auto_payout_on_consensus
            _auto_payout_on_consensus("match-1", "CT_WIN")

        mock_escrow.declare_winner.assert_called_once_with("match-1", winner_uid)

    def test_no_winner_found_is_nonfatal(self):
        """If no matching wallet in match_consensus, function returns without error."""
        sf, _ = self._make_session(winner_row=None)

        with patch("main.SessionLocal", sf):
            from main import _auto_payout_on_consensus
            _auto_payout_on_consensus("match-1", "victory")   # should not raise

    def test_db_error_is_nonfatal(self):
        """Any DB exception is caught and logged — never propagates."""
        sf = MagicMock(side_effect=Exception("DB down"))

        with patch("main.SessionLocal", sf):
            from main import _auto_payout_on_consensus
            _auto_payout_on_consensus("match-1", "victory")   # should not raise

    def test_on_chain_failure_is_nonfatal(self):
        """on-chain declare_winner failure does not crash the function."""
        import uuid as _uuid2
        winner_uid = str(_uuid2.uuid4())
        sf, _ = self._make_session(winner_row=(winner_uid, "CRYPTO"))
        mock_escrow = MagicMock()
        mock_escrow.declare_winner.side_effect = Exception("RPC timeout")

        with patch("main.SessionLocal", sf), \
             patch("main._escrow_client", mock_escrow):
            from main import _auto_payout_on_consensus
            _auto_payout_on_consensus("match-1", "victory")   # should not raise

    def test_auto_payout_triggered_when_consensus_reached(self):
        """POST /validate/screenshot triggers _auto_payout when consensus REACHED."""
        ctx, session = _make_session()
        session.execute.return_value.fetchone.side_effect = [
            ("in_progress",),
            (_WALLET, None),
        ]
        session.execute.return_value.fetchall.return_value = []

        from src.vision.consensus import ConsensusStatus, ConsensusResult

        mock_verdict = ConsensusResult(
            status=ConsensusStatus.REACHED,
            agreed_result="victory",
            total_players=2, agreeing_players=2,
            flagged_wallets=[], submissions=[],
        )

        from unittest.mock import mock_open as _mock_open
        with patch("builtins.open", _mock_open()), \
             patch("shutil.copyfileobj"), \
             patch("main.SessionLocal", return_value=ctx), \
             patch("main.VisionEngine") as MockEngine, \
             patch("src.vision.matcher.save_evidence", return_value=None), \
             patch("src.vision.consensus.MatchConsensus.submit",
                   return_value=ConsensusStatus.REACHED), \
             patch("src.vision.consensus.MatchConsensus.evaluate",
                   return_value=mock_verdict), \
             patch("src.vision.consensus.MatchConsensus._restore_from_db"), \
             patch("main._auto_payout_on_consensus") as mock_payout:
            MockEngine.return_value.process_frame.return_value = \
                __import__("src.vision.engine", fromlist=["VisionEngineOutput"]).VisionEngineOutput(
                    result="victory", confidence=0.95, players=[], accepted=True
                )
            resp = client.post(
                f"/validate/screenshot?match_id={_MATCH_ID}&game=CS2",
                files={"file": ("ss.png", io.BytesIO(_tiny_png()), "image/png")},
                headers=_AUTH_HDRS,
            )

        assert resp.status_code == 200
        mock_payout.assert_called_once_with(_MATCH_ID, "victory")
