"""
Tests for Step 4 — Admin routes:

  GET  /admin/oracle/status                   — listener health
  POST /admin/oracle/sync?from_block=N        — recovery sync with optional from_block
  POST /admin/freeze                          — M8 kill switch (suspend/resume payouts)
  GET  /admin/freeze/status                   — current kill switch state
  POST /admin/match/{id}/declare-winner       — manual winner declaration
  POST /admin/alerts/test-slack               — Slack webhook smoke test (admin)

All tests mock SessionLocal; no real DB / blockchain needed.
FastAPI dependency overrides are used instead of unittest.mock.patch for
require_admin, because FastAPI holds a reference to the original function
in Depends() and patching the module attribute has no effect at runtime.
"""
from __future__ import annotations

import os
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
# POST /admin/alerts/test-slack
# ═══════════════════════════════════════════════════════════════════════════════

class TestAdminAlertsTestSlack:
    """POST /admin/alerts/test-slack — verify Slack webhook wiring."""

    def test_requires_admin(self):
        resp = client.post("/admin/alerts/test-slack", headers=_USER_HEADERS)
        assert resp.status_code == 403

    def test_no_webhook_returns_503(self, as_admin):
        with patch.dict(os.environ, {"SLACK_ALERTS_WEBHOOK_URL": ""}):
            resp = client.post("/admin/alerts/test-slack", headers=_ADMIN_HEADERS)
        assert resp.status_code == 503

    def test_ok_calls_slack_post(self, as_admin):
        with patch.dict(
            os.environ,
            {"SLACK_ALERTS_WEBHOOK_URL": "https://hooks.slack.com/services/TEST/FAKE"},
        ):
            with patch("main.slack_post") as m:
                resp = client.post("/admin/alerts/test-slack", headers=_ADMIN_HEADERS)
        assert resp.status_code == 200
        assert resp.json() == {"ok": True, "sent": True}
        m.assert_called_once()


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


# ═══════════════════════════════════════════════════════════════════════════════
# POST /admin/users/{id}/penalty  — M8 Penalty System
# ═══════════════════════════════════════════════════════════════════════════════

class TestAdminPenalty:
    """Admin penalty endpoint — escalation logic."""

    _TARGET_ID = str(uuid.uuid4())

    def _session_with_count(self, prior_count: int, user_exists: bool = True):
        session = MagicMock()
        responses = []
        if user_exists:
            responses.append((self._TARGET_ID,))   # user exists
        else:
            responses.append(None)                  # user not found
        responses.append((prior_count,))            # COUNT(*) from player_penalties
        if user_exists and prior_count >= 2:        # 3rd+ offense → SELECT steam_id/riot_id/wallet_address
            responses.append((None, None, None))    # id_row for wallet_blacklist insert
        session.execute.return_value.fetchone.side_effect = responses
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__  = MagicMock(return_value=False)
        return ctx

    def test_first_offense_suspended_24h(self, as_admin):
        """1st offense → suspended_24h action."""
        ctx = self._session_with_count(0)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/admin/users/{self._TARGET_ID}/penalty",
                json={"offense_type": "rage_quit"},
                headers=_ADMIN_HEADERS,
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["action"] == "suspended_24h"
        assert data["offense_count"] == 1
        assert data["suspended_until"] is not None
        assert data["banned_at"] is None

    def test_second_offense_suspended_7d(self, as_admin):
        """2nd offense → suspended_7d action."""
        ctx = self._session_with_count(1)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/admin/users/{self._TARGET_ID}/penalty",
                json={"offense_type": "kick_abuse"},
                headers=_ADMIN_HEADERS,
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["action"] == "suspended_7d"
        assert data["offense_count"] == 2

    def test_third_offense_permanent_ban(self, as_admin):
        """3rd+ offense → banned_permanent action."""
        ctx = self._session_with_count(2)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/admin/users/{self._TARGET_ID}/penalty",
                json={"offense_type": "fraud"},
                headers=_ADMIN_HEADERS,
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["action"] == "banned_permanent"
        assert data["banned_at"] is not None
        assert data["suspended_until"] is None

    def test_user_not_found_returns_404(self, as_admin):
        """Unknown user_id → 404."""
        ctx = self._session_with_count(0, user_exists=False)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/admin/users/{uuid.uuid4()}/penalty",
                json={"offense_type": "rage_quit"},
                headers=_ADMIN_HEADERS,
            )
        assert resp.status_code == 404

    def test_requires_admin(self):
        """Non-admin cannot issue penalties — 403."""
        ctx, _ = _make_session(fetchone=None)  # no admin role row
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/admin/users/{self._TARGET_ID}/penalty",
                json={"offense_type": "fraud"},
                headers=_USER_HEADERS,
            )
        assert resp.status_code == 403


# ═══════════════════════════════════════════════════════════════════════════════
# GET /admin/fraud/report  — M8 Anomaly Detection
# ═══════════════════════════════════════════════════════════════════════════════

class TestAdminFraudReport:
    """Fraud report returns correct structure."""

    def _empty_session(self):
        session = MagicMock()
        session.execute.return_value.fetchall.return_value = []
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__  = MagicMock(return_value=False)
        return ctx

    def test_report_structure(self, as_admin):
        """Response contains all expected keys."""
        with patch("main.SessionLocal", return_value=self._empty_session()):
            resp = client.get("/admin/fraud/report", headers=_ADMIN_HEADERS)
        assert resp.status_code == 200
        data = resp.json()
        assert "generated_at"    in data
        assert "flagged_players"  in data
        assert "suspicious_pairs" in data
        assert "repeat_offenders" in data
        assert "recently_banned"  in data
        assert "summary"          in data
        assert "total_flagged"    in data["summary"]

    def test_empty_db_returns_zeros(self, as_admin):
        """With no data, all lists are empty and total_flagged=0."""
        with patch("main.SessionLocal", return_value=self._empty_session()):
            resp = client.get("/admin/fraud/report", headers=_ADMIN_HEADERS)
        data = resp.json()
        assert data["summary"]["total_flagged"] == 0
        assert data["flagged_players"] == []
        assert data["suspicious_pairs"] == []

    def test_requires_admin(self):
        """Non-admin cannot access fraud report — 403."""
        ctx = self._empty_session()
        ctx.__enter__.return_value.execute.return_value.fetchone.return_value = None
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/admin/fraud/report", headers=_USER_HEADERS)
        assert resp.status_code == 403


# ═══════════════════════════════════════════════════════════════════════════════
# GET /admin/users  — live user list with risk data
# ═══════════════════════════════════════════════════════════════════════════════


class TestAdminListUsers:
    """GET /admin/users — paginated users with suspension/penalty data."""

    def _make_user_row(
        self,
        uid=None,
        username="player1",
        email="p1@arena.gg",
        status="active",
        rank="Gold",
        created_at=None,
        at_balance=100,
        wallet_address="0xABC",
        matches=10,
        wins=6,
        win_rate=60.0,
        penalty_count=0,
        suspended_until=None,
        banned_at=None,
    ):
        from datetime import datetime, timezone
        return (
            uid or _USER_ID,
            username,
            email,
            status,
            rank,
            created_at or datetime(2025, 1, 1, tzinfo=timezone.utc),
            at_balance,
            wallet_address,
            matches,
            wins,
            win_rate,
            penalty_count,
            suspended_until,
            banned_at,
        )

    def test_returns_user_list(self, as_admin):
        """Basic call returns users array and total."""
        ctx, session = _make_session()
        session.execute.return_value.fetchall.return_value = [self._make_user_row()]
        session.execute.return_value.fetchone.return_value = (1,)

        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/admin/users", headers=_ADMIN_HEADERS)

        assert resp.status_code == 200
        data = resp.json()
        assert "users" in data
        assert "total" in data
        assert len(data["users"]) == 1

    def test_user_fields_present(self, as_admin):
        """Each user row has all required fields including at_balance, wallet_address."""
        ctx, session = _make_session()
        session.execute.return_value.fetchall.return_value = [self._make_user_row()]
        session.execute.return_value.fetchone.return_value = (1,)

        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/admin/users", headers=_ADMIN_HEADERS)

        u = resp.json()["users"][0]
        for field in ("user_id", "username", "email", "status", "rank",
                      "at_balance", "wallet_address",
                      "matches", "wins", "win_rate",
                      "penalty_count", "is_suspended", "is_banned"):
            assert field in u, f"Missing field: {field}"

    def test_is_banned_true_when_banned_at_set(self, as_admin):
        """User with banned_at → is_banned=True, is_suspended=False."""
        from datetime import datetime, timezone
        banned_at = datetime(2025, 6, 1, tzinfo=timezone.utc)
        ctx, session = _make_session()
        session.execute.return_value.fetchall.return_value = [
            self._make_user_row(banned_at=banned_at)
        ]
        session.execute.return_value.fetchone.return_value = (1,)

        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/admin/users", headers=_ADMIN_HEADERS)

        u = resp.json()["users"][0]
        assert u["is_banned"] is True
        assert u["is_suspended"] is False

    def test_is_suspended_true_when_active_suspension(self, as_admin):
        """User with suspended_until in future → is_suspended=True."""
        from datetime import datetime, timezone, timedelta
        future = datetime.now(timezone.utc) + timedelta(hours=12)
        ctx, session = _make_session()
        session.execute.return_value.fetchall.return_value = [
            self._make_user_row(suspended_until=future)
        ]
        session.execute.return_value.fetchone.return_value = (1,)

        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/admin/users", headers=_ADMIN_HEADERS)

        u = resp.json()["users"][0]
        assert u["is_suspended"] is True
        assert u["is_banned"] is False

    def test_empty_db_returns_empty_list(self, as_admin):
        """No users → empty list, total=0."""
        ctx, session = _make_session()
        session.execute.return_value.fetchall.return_value = []
        session.execute.return_value.fetchone.return_value = (0,)

        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/admin/users", headers=_ADMIN_HEADERS)

        data = resp.json()
        assert data["users"] == []
        assert data["total"] == 0

    def test_requires_admin(self):
        """Non-admin cannot list users — 403."""
        ctx, session = _make_session(fetchone=None)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/admin/users", headers=_USER_HEADERS)
        assert resp.status_code == 403


# ═══════════════════════════════════════════════════════════════════════════════
# GET /admin/disputes  — live disputes list
# ═══════════════════════════════════════════════════════════════════════════════


class TestAdminListDisputes:
    """GET /admin/disputes — paginated disputes with player usernames."""

    def _make_dispute_row(self):
        from datetime import datetime, timezone
        return (
            _MATCH_ID,                                   # id
            _MATCH_ID,                                   # match_id
            _USER_ID,                                    # raised_by (player_a)
            "alice",                                     # raised_by_username
            "screenshot differs",                        # reason
            "open",                                      # status
            "pending",                                   # resolution
            None,                                        # admin_notes
            datetime(2025, 1, 1, tzinfo=timezone.utc),  # created_at
            None,                                        # resolved_at
            "CS2",                                       # game
            50.0,                                        # bet_amount
            "AT",                                        # stake_currency
        )

    def test_returns_disputes_list(self, as_admin):
        """Basic call returns disputes array and total."""
        ctx, session = _make_session()
        session.execute.return_value.fetchall.return_value = [self._make_dispute_row()]
        session.execute.return_value.fetchone.return_value = (1,)

        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/admin/disputes", headers=_ADMIN_HEADERS)

        assert resp.status_code == 200
        data = resp.json()
        assert "disputes" in data
        assert len(data["disputes"]) == 1

    def test_dispute_fields_present(self, as_admin):
        """Each dispute has raised_by_username (not username_a/username_b)."""
        ctx, session = _make_session()
        session.execute.return_value.fetchall.return_value = [self._make_dispute_row()]
        session.execute.return_value.fetchone.return_value = (1,)

        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/admin/disputes", headers=_ADMIN_HEADERS)

        d = resp.json()["disputes"][0]
        for field in ("id", "match_id", "raised_by", "raised_by_username",
                      "reason", "status", "resolution", "game", "bet_amount"):
            assert field in d, f"Missing field: {field}"
        assert "username_a" not in d
        assert "username_b" not in d

    def test_empty_db_returns_empty_list(self, as_admin):
        """No disputes → empty list, total=0."""
        ctx, session = _make_session()
        session.execute.return_value.fetchall.return_value = []
        session.execute.return_value.fetchone.return_value = (0,)

        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/admin/disputes", headers=_ADMIN_HEADERS)

        data = resp.json()
        assert data["disputes"] == []
        assert data["total"] == 0

    def test_requires_admin(self):
        """Non-admin cannot list disputes — 403."""
        ctx, session = _make_session(fetchone=None)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/admin/disputes", headers=_USER_HEADERS)
        assert resp.status_code == 403


# ═══════════════════════════════════════════════════════════════════════════════
# GET /platform/config  +  PUT /platform/config
# ═══════════════════════════════════════════════════════════════════════════════


class TestPlatformConfig:
    """Platform config read + update — key-value table (platform_config)."""

    def _kv_rows(self):
        """Simulate SELECT key, value FROM platform_config."""
        return [
            ("fee_pct",                "5"),
            ("daily_bet_max_at",       "500"),
            ("maintenance_mode",       "false"),
            ("new_registrations",      "true"),
            ("auto_escalate_disputes", "false"),
        ]

    def test_get_returns_all_fields(self, as_admin):
        """GET /platform/config returns all known config keys."""
        ctx, session = _make_session()
        session.execute.return_value.fetchall.return_value = self._kv_rows()
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/platform/config", headers=_ADMIN_HEADERS)

        assert resp.status_code == 200
        data = resp.json()
        for field in ("fee_pct", "daily_bet_max_at", "maintenance_mode",
                      "new_registrations", "auto_escalate_disputes"):
            assert field in data, f"Missing field: {field}"

    def test_get_fee_pct_value(self, as_admin):
        """fee_pct is returned as string '5'."""
        ctx, session = _make_session()
        session.execute.return_value.fetchall.return_value = self._kv_rows()
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/platform/config", headers=_ADMIN_HEADERS)
        assert resp.json()["fee_pct"] == "5"

    def test_put_updates_fields(self, as_admin):
        """PUT with valid fields → 200, updated=True, correct field names."""
        ctx, session = _make_session()
        with patch("main.SessionLocal", return_value=ctx), \
             patch("main._log_audit"):
            resp = client.put(
                "/platform/config",
                json={"fee_pct": "7", "maintenance_mode": "true"},
                headers=_ADMIN_HEADERS,
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["updated"] is True
        assert "fee_pct" in data["fields"]
        assert "maintenance_mode" in data["fields"]

    def test_put_invalid_fee_returns_400(self, as_admin):
        """fee_pct > 50 → 400."""
        ctx, session = _make_session()
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.put(
                "/platform/config",
                json={"fee_pct": "99"},
                headers=_ADMIN_HEADERS,
            )
        assert resp.status_code == 400

    def test_put_negative_daily_max_returns_400(self, as_admin):
        """daily_bet_max_at <= 0 → 400."""
        ctx, session = _make_session()
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.put(
                "/platform/config",
                json={"daily_bet_max_at": "-10"},
                headers=_ADMIN_HEADERS,
            )
        assert resp.status_code == 400

    def test_put_no_fields_returns_400(self, as_admin):
        """Empty body → 400."""
        ctx, session = _make_session()
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.put(
                "/platform/config",
                json={},
                headers=_ADMIN_HEADERS,
            )
        assert resp.status_code == 400

    def test_get_requires_admin(self):
        """Non-admin cannot GET config — 403."""
        ctx, session = _make_session(fetchone=None)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/platform/config", headers=_USER_HEADERS)
        assert resp.status_code == 403

    def test_put_requires_admin(self):
        """Non-admin cannot PUT config — 403."""
        ctx, session = _make_session(fetchone=None)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.put(
                "/platform/config",
                json={"fee_pct": "5"},
                headers=_USER_HEADERS,
            )
        assert resp.status_code == 403


# ═══════════════════════════════════════════════════════════════════════════════
# GET /admin/audit-log
# ═══════════════════════════════════════════════════════════════════════════════


class TestAdminAuditLog:
    """GET /admin/audit-log — paginated audit trail."""

    def _make_entry_row(self):
        from datetime import datetime, timezone
        return (
            _MATCH_ID,          # id
            _ADMIN_ID,          # admin_id
            "arena_admin",      # admin_username
            "SUSPEND_USER",     # action (UPPERCASE)
            _USER_ID,           # target_id
            "offense=rage_quit count=1",  # notes
            datetime(2025, 1, 1, tzinfo=timezone.utc),  # created_at
        )

    def test_returns_entries_list(self, as_admin):
        """GET /admin/audit-log returns entries array and total."""
        ctx, session = _make_session()
        session.execute.return_value.fetchall.return_value = [self._make_entry_row()]
        session.execute.return_value.fetchone.return_value = (1,)

        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/admin/audit-log", headers=_ADMIN_HEADERS)

        assert resp.status_code == 200
        data = resp.json()
        assert "entries" in data
        assert "total" in data
        assert len(data["entries"]) == 1

    def test_entry_fields_present(self, as_admin):
        """Each entry has target_id + notes (not target/detail)."""
        ctx, session = _make_session()
        session.execute.return_value.fetchall.return_value = [self._make_entry_row()]
        session.execute.return_value.fetchone.return_value = (1,)

        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/admin/audit-log", headers=_ADMIN_HEADERS)

        e = resp.json()["entries"][0]
        for field in ("id", "admin_id", "admin_username", "action",
                      "target_id", "notes", "created_at"):
            assert field in e, f"Missing field: {field}"
        assert "target" not in e or "target_id" in e  # new schema
        assert e["action"] == "SUSPEND_USER"           # UPPERCASE

    def test_empty_db_returns_empty_list(self, as_admin):
        """No audit entries → empty list, total=0."""
        ctx, session = _make_session()
        session.execute.return_value.fetchall.return_value = []
        session.execute.return_value.fetchone.return_value = (0,)

        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/admin/audit-log", headers=_ADMIN_HEADERS)

        data = resp.json()
        assert data["entries"] == []
        assert data["total"] == 0

    def test_requires_admin(self):
        """Non-admin cannot access audit log — 403."""
        ctx, session = _make_session(fetchone=None)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/admin/audit-log", headers=_USER_HEADERS)
        assert resp.status_code == 403


# ═══════════════════════════════════════════════════════════════════════════════
# _log_audit  — audit wiring on existing admin actions
# ═══════════════════════════════════════════════════════════════════════════════


class TestAuditWiring:
    """Verify _log_audit is called (non-fatal) when admin actions succeed."""

    def setup_method(self):
        """Reset _PAYOUTS_FROZEN before every test to avoid state leakage."""
        import main as m
        m._PAYOUTS_FROZEN = False

    def teardown_method(self):
        """Ensure _PAYOUTS_FROZEN is always reset after each test."""
        import main as m
        m._PAYOUTS_FROZEN = False

    def test_freeze_calls_log_audit(self, as_admin):
        """POST /admin/freeze → _log_audit called once."""
        import main as m
        m._PAYOUTS_FROZEN = False

        with patch("main._log_audit") as mock_audit:
            resp = client.post(
                "/admin/freeze",
                json={"freeze": True},
                headers=_ADMIN_HEADERS,
            )

        assert resp.status_code == 200
        mock_audit.assert_called_once()
        assert mock_audit.call_args[0][1] == "FREEZE_PAYOUT"  # UPPERCASE

    def test_unfreeze_calls_log_audit_with_unfreeze_action(self, as_admin):
        """POST /admin/freeze {freeze:false} → action='UNFREEZE_PAYOUT'."""
        import main as m
        m._PAYOUTS_FROZEN = True

        with patch("main._log_audit") as mock_audit:
            resp = client.post(
                "/admin/freeze",
                json={"freeze": False},
                headers=_ADMIN_HEADERS,
            )

        assert resp.status_code == 200
        assert mock_audit.call_args[0][1] == "UNFREEZE_PAYOUT"

    def test_penalty_calls_log_audit(self, as_admin):
        """POST /admin/users/{id}/penalty → _log_audit called with BAN_USER or SUSPEND_USER."""
        target_id = str(uuid.uuid4())
        session = MagicMock()
        session.execute.return_value.fetchone.side_effect = [
            (target_id,),  # user exists
            (0,),          # prior_count = 0 → 1st offense → SUSPEND_USER
        ]
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__  = MagicMock(return_value=False)

        with patch("main.SessionLocal", return_value=ctx), \
             patch("main._log_audit") as mock_audit:
            resp = client.post(
                f"/admin/users/{target_id}/penalty",
                json={"offense_type": "rage_quit"},
                headers=_ADMIN_HEADERS,
            )

        assert resp.status_code == 200
        mock_audit.assert_called_once()
        assert mock_audit.call_args[0][1] == "SUSPEND_USER"

    def test_third_offense_logs_ban_user(self, as_admin):
        """3rd offense → _log_audit called with 'BAN_USER'."""
        target_id = str(uuid.uuid4())
        session = MagicMock()
        session.execute.return_value.fetchone.side_effect = [
            (target_id,),      # user exists
            (2,),              # prior_count = 2 → 3rd offense → BAN_USER
            (None, None, None),  # SELECT steam_id, riot_id, wallet_address for blacklist
        ]
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__  = MagicMock(return_value=False)

        with patch("main.SessionLocal", return_value=ctx), \
             patch("main._log_audit") as mock_audit:
            resp = client.post(
                f"/admin/users/{target_id}/penalty",
                json={"offense_type": "fraud"},
                headers=_ADMIN_HEADERS,
            )

        assert resp.status_code == 200
        assert mock_audit.call_args[0][1] == "BAN_USER"

    def test_declare_winner_calls_log_audit(self, as_admin):
        """POST /admin/match/{id}/declare-winner → _log_audit called with 'DECLARE_WINNER'."""
        session = MagicMock()
        session.execute.return_value.fetchone.side_effect = [
            ("in_progress", "AT"),  # match row
        ]
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__  = MagicMock(return_value=False)

        with patch("main.SessionLocal", return_value=ctx), \
             patch("main._settle_at_match"), \
             patch("main._send_system_inbox"), \
             patch("main._log_audit") as mock_audit:
            resp = client.post(
                f"/admin/match/{_MATCH_ID}/declare-winner",
                json={"winner_id": _WINNER_ID},
                headers=_ADMIN_HEADERS,
            )

        assert resp.status_code == 200
        mock_audit.assert_called_once()
        assert mock_audit.call_args[0][1] == "DECLARE_WINNER"
