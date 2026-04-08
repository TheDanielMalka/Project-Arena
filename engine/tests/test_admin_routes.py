"""
Tests for Step 4 — Admin routes:

  GET  /admin/oracle/status                   — listener health
  POST /admin/oracle/sync?from_block=N        — recovery sync with optional from_block
  POST /admin/freeze                          — M8 kill switch (suspend/resume payouts)
  GET  /admin/freeze/status                   — current kill switch state
  POST /admin/match/{id}/declare-winner       — manual winner declaration

All tests mock SessionLocal; no real DB / blockchain needed.
FastAPI dependency overrides are used instead of unittest.mock.patch for
require_admin, because FastAPI holds a reference to the original function
in Depends() and patching the module attribute has no effect at runtime.
"""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app
from main import require_admin as _require_admin
import src.auth as auth

client = TestClient(app)

# ── Shared test data ───────────────────────────────────────────────────────────

_ADMIN_ID   = str(uuid.uuid4())
_WINNER_ID  = str(uuid.uuid4())
_MATCH_ID   = str(uuid.uuid4())

_ADMIN_TOKEN   = auth.issue_token(_ADMIN_ID,            "admin@arena.gg")
_ADMIN_HEADERS = {"Authorization": f"Bearer {_ADMIN_TOKEN}"}

_USER_ID       = str(uuid.uuid4())
_USER_TOKEN    = auth.issue_token(_USER_ID,             "user@arena.gg")
_USER_HEADERS  = {"Authorization": f"Bearer {_USER_TOKEN}"}


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=False)
def as_admin():
    """
    Override require_admin dependency so tests skip the real DB admin check.
    Automatically cleaned up after each test that requests this fixture.
    """
    app.dependency_overrides[_require_admin] = lambda: {
        "sub": _ADMIN_ID, "email": "admin@arena.gg"
    }
    yield
    app.dependency_overrides.pop(_require_admin, None)


# ── Session mock helper ────────────────────────────────────────────────────────

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


# ═══════════════════════════════════════════════════════════════════════════════
# GET /admin/oracle/status
# ═══════════════════════════════════════════════════════════════════════════════

class TestAdminOracleStatus:
    """GET /admin/oracle/status — listener health check."""

    def test_returns_status_fields(self, as_admin):
        """Response contains all expected fields."""
        ctx, session = _make_session(fetchone=(1234, None))

        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/admin/oracle/status", headers=_ADMIN_HEADERS)

        assert resp.status_code == 200
        data = resp.json()
        assert "escrow_enabled" in data
        assert "listener_active" in data
        assert "last_block" in data
        assert "last_sync_at" in data

    def test_last_block_from_db(self, as_admin):
        """last_block is read from oracle_sync_state."""
        ctx, _ = _make_session(fetchone=(9999, None))

        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/admin/oracle/status", headers=_ADMIN_HEADERS)

        assert resp.json()["last_block"] == 9999

    def test_no_escrow_client_escrow_enabled_false(self, as_admin):
        """escrow_enabled=False when EscrowClient not initialised."""
        ctx, _ = _make_session(fetchone=(0, None))

        with patch("main.SessionLocal", return_value=ctx), \
             patch("main._escrow_client", None):
            resp = client.get("/admin/oracle/status", headers=_ADMIN_HEADERS)

        assert resp.json()["escrow_enabled"] is False

    def test_requires_auth(self):
        """No Authorization header → 422."""
        resp = client.get("/admin/oracle/status")
        assert resp.status_code == 422


# ═══════════════════════════════════════════════════════════════════════════════
# POST /admin/oracle/sync
# ═══════════════════════════════════════════════════════════════════════════════

class TestAdminOracleSync:
    """POST /admin/oracle/sync — manual event catch-up with optional from_block."""

    def _mock_escrow(self, last_block=100, current_block=200, events_processed=5):
        ec = MagicMock()
        ec._load_last_block.return_value = last_block
        ec._w3.eth.block_number = current_block
        ec.process_events.return_value = events_processed
        return ec

    def test_no_escrow_returns_503(self, as_admin):
        """No EscrowClient → 503 Service Unavailable."""
        with patch("main._escrow_client", None):
            resp = client.post("/admin/oracle/sync", headers=_ADMIN_HEADERS)
        assert resp.status_code == 503

    def test_sync_without_from_block_uses_saved_block(self, as_admin):
        """Omitting from_block → scan starts from last_block+1."""
        ec = self._mock_escrow(last_block=100, current_block=200, events_processed=3)

        with patch("main._escrow_client", ec):
            resp = client.post("/admin/oracle/sync", headers=_ADMIN_HEADERS)

        assert resp.status_code == 200
        data = resp.json()
        assert data["synced"] is True
        assert data["from_block"] == 101   # last_block + 1
        assert data["to_block"] == 200
        assert data["events_processed"] == 3
        ec.process_events.assert_called_once_with(101, 200)

    def test_sync_with_from_block_overrides_saved_block(self, as_admin):
        """?from_block=50 → scan from block 50, ignoring DB last_block."""
        ec = self._mock_escrow(last_block=100, current_block=200, events_processed=7)

        with patch("main._escrow_client", ec):
            resp = client.post("/admin/oracle/sync?from_block=50", headers=_ADMIN_HEADERS)

        assert resp.status_code == 200
        data = resp.json()
        assert data["from_block"] == 50
        assert data["events_processed"] == 7
        ec.process_events.assert_called_once_with(50, 200)

    def test_sync_from_block_zero_is_valid(self, as_admin):
        """from_block=0 is valid (full resync from genesis)."""
        ec = self._mock_escrow(last_block=0, current_block=500, events_processed=42)

        with patch("main._escrow_client", ec):
            resp = client.post("/admin/oracle/sync?from_block=0", headers=_ADMIN_HEADERS)

        assert resp.status_code == 200
        assert resp.json()["from_block"] == 0
        ec.process_events.assert_called_once_with(0, 500)

    def test_sync_already_up_to_date_returns_zero_events(self, as_admin):
        """scan_from > current_block → 0 events, process_events not called."""
        ec = self._mock_escrow(last_block=500, current_block=500, events_processed=0)

        with patch("main._escrow_client", ec):
            resp = client.post("/admin/oracle/sync", headers=_ADMIN_HEADERS)

        assert resp.status_code == 200
        assert resp.json()["events_processed"] == 0
        ec.process_events.assert_not_called()

    def test_requires_auth(self):
        """No token → 422."""
        resp = client.post("/admin/oracle/sync")
        assert resp.status_code == 422


# ═══════════════════════════════════════════════════════════════════════════════
# POST /admin/match/{id}/declare-winner
# ═══════════════════════════════════════════════════════════════════════════════

class TestAdminDeclareWinner:
    """POST /admin/match/{id}/declare-winner — manual winner override."""

    def _session_chain(self, match_status="in_progress", stake_currency="AT"):
        """
        Build a session whose fetchone side_effect covers:
          call 1: match SELECT → (match_status, stake_currency)
        Subsequent execute() calls (UPDATE, INSERT) don't use fetchone.
        """
        ctx, session = _make_session()
        session.execute.return_value.fetchone.side_effect = [
            (match_status, stake_currency),   # match row
        ]
        return ctx, session

    def test_at_match_declares_winner_200(self, as_admin):
        """AT match in_progress → 200, _settle_at_match called."""
        ctx, _ = self._session_chain(match_status="in_progress", stake_currency="AT")

        with patch("main.SessionLocal", return_value=ctx), \
             patch("main._settle_at_match") as mock_settle, \
             patch("main._send_system_inbox"):
            resp = client.post(
                f"/admin/match/{_MATCH_ID}/declare-winner",
                json={"winner_id": _WINNER_ID, "reason": "Admin override"},
                headers=_ADMIN_HEADERS,
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["declared"] is True
        assert data["winner_id"] == _WINNER_ID
        assert data["stake_currency"] == "AT"
        mock_settle.assert_called_once_with(_MATCH_ID, _WINNER_ID)

    def test_crypto_match_calls_declare_winner_on_chain(self, as_admin):
        """CRYPTO match → EscrowClient.declare_winner() called."""
        ctx, _ = self._session_chain(match_status="in_progress", stake_currency="CRYPTO")
        mock_escrow = MagicMock()
        mock_escrow.declare_winner.return_value = "0xTXHASH"

        with patch("main.SessionLocal", return_value=ctx), \
             patch("main._escrow_client", mock_escrow), \
             patch("main._send_system_inbox"):
            resp = client.post(
                f"/admin/match/{_MATCH_ID}/declare-winner",
                json={"winner_id": _WINNER_ID},
                headers=_ADMIN_HEADERS,
            )

        assert resp.status_code == 200
        mock_escrow.declare_winner.assert_called_once_with(_MATCH_ID, _WINNER_ID)

    def test_match_not_found_returns_404(self, as_admin):
        """Match not in DB → 404."""
        ctx, session = _make_session()
        session.execute.return_value.fetchone.return_value = None   # no match row

        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/admin/match/{_MATCH_ID}/declare-winner",
                json={"winner_id": _WINNER_ID},
                headers=_ADMIN_HEADERS,
            )

        assert resp.status_code == 404

    def test_completed_match_returns_409(self, as_admin):
        """Match already completed → 409 conflict."""
        ctx, _ = self._session_chain(match_status="completed")

        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/admin/match/{_MATCH_ID}/declare-winner",
                json={"winner_id": _WINNER_ID},
                headers=_ADMIN_HEADERS,
            )

        assert resp.status_code == 409

    def test_cancelled_match_returns_409(self, as_admin):
        """Match cancelled → 409."""
        ctx, _ = self._session_chain(match_status="cancelled")

        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/admin/match/{_MATCH_ID}/declare-winner",
                json={"winner_id": _WINNER_ID},
                headers=_ADMIN_HEADERS,
            )

        assert resp.status_code == 409

    def test_waiting_match_can_be_declared(self, as_admin):
        """Admin can declare winner on a still-waiting match (e.g. forfeit)."""
        ctx, _ = self._session_chain(match_status="waiting", stake_currency="AT")

        with patch("main.SessionLocal", return_value=ctx), \
             patch("main._settle_at_match"), \
             patch("main._send_system_inbox"):
            resp = client.post(
                f"/admin/match/{_MATCH_ID}/declare-winner",
                json={"winner_id": _WINNER_ID},
                headers=_ADMIN_HEADERS,
            )

        assert resp.status_code == 200
        assert resp.json()["declared"] is True

    def test_reason_field_optional(self, as_admin):
        """Omitting reason field is valid (defaults to empty string)."""
        ctx, _ = self._session_chain()

        with patch("main.SessionLocal", return_value=ctx), \
             patch("main._settle_at_match"), \
             patch("main._send_system_inbox"):
            resp = client.post(
                f"/admin/match/{_MATCH_ID}/declare-winner",
                json={"winner_id": _WINNER_ID},
                headers=_ADMIN_HEADERS,
            )

        assert resp.status_code == 200

    def test_on_chain_failure_non_fatal_still_returns_200(self, as_admin):
        """On-chain declare_winner error → non-fatal, route returns 200."""
        ctx, _ = self._session_chain(stake_currency="CRYPTO")
        mock_escrow = MagicMock()
        mock_escrow.declare_winner.side_effect = Exception("RPC timeout")

        with patch("main.SessionLocal", return_value=ctx), \
             patch("main._escrow_client", mock_escrow), \
             patch("main._send_system_inbox"):
            resp = client.post(
                f"/admin/match/{_MATCH_ID}/declare-winner",
                json={"winner_id": _WINNER_ID},
                headers=_ADMIN_HEADERS,
            )

        assert resp.status_code == 200
        assert resp.json()["declared"] is True

    def test_requires_auth(self):
        """No token → 422."""
        resp = client.post(
            f"/admin/match/{_MATCH_ID}/declare-winner",
            json={"winner_id": _WINNER_ID},
        )
        assert resp.status_code == 422

    def test_non_admin_cannot_declare(self):
        """Non-admin user (no admin role in DB) → 403."""
        # require_admin runs the real check — mock DB to return no admin row
        ctx, session = _make_session()
        session.execute.return_value.fetchone.return_value = None  # no admin role

        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/admin/match/{_MATCH_ID}/declare-winner",
                json={"winner_id": _WINNER_ID},
                headers=_USER_HEADERS,   # normal user token
            )

        assert resp.status_code == 403


# ═══════════════════════════════════════════════════════════════════════════════
# POST /admin/freeze  +  GET /admin/freeze/status  — M8 Kill Switch
# ═══════════════════════════════════════════════════════════════════════════════

class TestAdminFreezeKillSwitch:
    """M8 kill switch — suspend and resume all payout disbursement."""

    def setup_method(self):
        """Reset _PAYOUTS_FROZEN to False before every test."""
        import main as m
        m._PAYOUTS_FROZEN = False

    def test_freeze_payouts(self, as_admin):
        """POST /admin/freeze {freeze: true} → frozen=true."""
        resp = client.post(
            "/admin/freeze",
            json={"freeze": True},
            headers=_ADMIN_HEADERS,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["frozen"] is True
        assert "FROZEN" in data["message"]

    def test_unfreeze_payouts(self, as_admin):
        """POST /admin/freeze {freeze: false} → frozen=false."""
        import main as m
        m._PAYOUTS_FROZEN = True  # start frozen

        resp = client.post(
            "/admin/freeze",
            json={"freeze": False},
            headers=_ADMIN_HEADERS,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["frozen"] is False
        assert "RESUMED" in data["message"]

    def test_freeze_status_reflects_state(self, as_admin):
        """GET /admin/freeze/status returns current _PAYOUTS_FROZEN value."""
        import main as m

        m._PAYOUTS_FROZEN = False
        resp = client.get("/admin/freeze/status", headers=_ADMIN_HEADERS)
        assert resp.status_code == 200
        assert resp.json()["frozen"] is False

        m._PAYOUTS_FROZEN = True
        resp = client.get("/admin/freeze/status", headers=_ADMIN_HEADERS)
        assert resp.status_code == 200
        assert resp.json()["frozen"] is True

    def test_freeze_blocks_at_payout(self, as_admin):
        """When frozen, _auto_payout skips _settle_at_match entirely."""
        import main as m
        m._PAYOUTS_FROZEN = True

        with patch("main._settle_at_match") as mock_settle, \
             patch("main.SessionLocal", return_value=_make_session(
                 fetchone=("in_progress", "AT", str(uuid.uuid4()))
             )[0]):
            m._auto_payout_on_consensus(str(uuid.uuid4()), "victory")

        mock_settle.assert_not_called()

    def test_unfreeze_allows_at_payout(self, as_admin):
        """When not frozen, _auto_payout calls _settle_at_match normally."""
        import main as m
        m._PAYOUTS_FROZEN = False

        winner_id = str(uuid.uuid4())
        match_id  = str(uuid.uuid4())

        ctx, session = _make_session()
        # fetchone called multiple times — first for winner lookup, then for match
        session.execute.return_value.fetchone.side_effect = [
            (winner_id, "AT"),        # stake_currency + winner from consensus
            ("in_progress", "AT", winner_id),  # match status row
        ]
        session.execute.return_value.fetchall.return_value = [
            (winner_id, "victory"),   # consensus votes
        ]

        with patch("main._settle_at_match") as mock_settle, \
             patch("main.SessionLocal", return_value=ctx):
            m._auto_payout_on_consensus(match_id, "victory")

        mock_settle.assert_called_once_with(match_id, winner_id)

    def test_requires_admin_freeze(self):
        """Non-admin cannot toggle the kill switch — 403."""
        ctx, session = _make_session()
        session.execute.return_value.fetchone.return_value = None  # no admin role

        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/admin/freeze",
                json={"freeze": True},
                headers=_USER_HEADERS,
            )
        assert resp.status_code == 403

    def test_requires_admin_status(self):
        """Non-admin cannot read kill switch status — 403."""
        ctx, session = _make_session()
        session.execute.return_value.fetchone.return_value = None  # no admin role

        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/admin/freeze/status", headers=_USER_HEADERS)
        assert resp.status_code == 403
