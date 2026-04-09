"""
test_risk_fraud.py — Risk & Fraud coverage for M8 features.

Covers:
  TestKillSwitch    — POST /admin/freeze toggle + 403 gate + payout block
  TestDailyStakeLimit — 500 AT/24h cap via create_match
  TestPenaltySystem   — suspension/ban gates on create_match and join_match
  TestFraudReport     — GET /admin/fraud/report structure + 403 gate

All tests mock SessionLocal; no real DB or blockchain needed.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app
from main import require_admin as _require_admin
import src.auth as auth

client = TestClient(app)

# ── Shared test identities ────────────────────────────────────────────────────

_ADMIN_ID    = str(uuid.uuid4())
_USER_ID     = str(uuid.uuid4())
_TARGET_ID   = str(uuid.uuid4())

_ADMIN_TOKEN   = auth.issue_token(_ADMIN_ID, "admin@arena.gg")
_USER_TOKEN    = auth.issue_token(_USER_ID,  "user@arena.gg")
_ADMIN_HEADERS = {"Authorization": f"Bearer {_ADMIN_TOKEN}"}
_USER_HEADERS  = {"Authorization": f"Bearer {_USER_TOKEN}"}


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def as_admin():
    """Override require_admin so tests skip the real DB admin check."""
    app.dependency_overrides[_require_admin] = lambda: {
        "sub": _ADMIN_ID, "email": "admin@arena.gg"
    }
    yield
    app.dependency_overrides.pop(_require_admin, None)


def _make_session(fetchone=None, fetchall=None):
    session = MagicMock()
    session.execute.return_value.fetchone.return_value = fetchone
    session.execute.return_value.fetchall.return_value = fetchall or []
    session.execute.return_value.rowcount = 1
    ctx = MagicMock()
    ctx.__enter__ = MagicMock(return_value=session)
    ctx.__exit__  = MagicMock(return_value=False)
    return ctx, session


# ═══════════════════════════════════════════════════════════════════════════════
# TestKillSwitch
# ═══════════════════════════════════════════════════════════════════════════════

class TestKillSwitch:
    """M8 kill switch — POST /admin/freeze + GET /admin/freeze/status."""

    def setup_method(self):
        import main as m
        m._PAYOUTS_FROZEN = False

    def test_freeze_true_sets_frozen(self, as_admin):
        """POST /admin/freeze {"freeze": true} → frozen: true."""
        resp = client.post(
            "/admin/freeze",
            json={"freeze": True},
            headers=_ADMIN_HEADERS,
        )
        assert resp.status_code == 200
        assert resp.json()["frozen"] is True

    def test_freeze_twice_returns_false(self, as_admin):
        """POST freeze=true then freeze=false → frozen: false."""
        client.post("/admin/freeze", json={"freeze": True},  headers=_ADMIN_HEADERS)
        resp = client.post("/admin/freeze", json={"freeze": False}, headers=_ADMIN_HEADERS)
        assert resp.status_code == 200
        assert resp.json()["frozen"] is False

    def test_freeze_requires_admin_token(self):
        """No admin token → 403."""
        ctx, session = _make_session(fetchone=None)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/admin/freeze",
                json={"freeze": True},
                headers=_USER_HEADERS,
            )
        assert resp.status_code == 403

    def test_settle_blocked_when_frozen(self, as_admin):
        """_settle_at_match is not called when _PAYOUTS_FROZEN=True."""
        import main as m
        m._PAYOUTS_FROZEN = True

        with patch("main._settle_at_match") as mock_settle, \
             patch("main.SessionLocal", return_value=_make_session(
                 fetchone=("in_progress", "AT", str(uuid.uuid4()))
             )[0]):
            m._auto_payout_on_consensus(str(uuid.uuid4()), "victory")

        mock_settle.assert_not_called()


# ═══════════════════════════════════════════════════════════════════════════════
# TestDailyStakeLimit
# ═══════════════════════════════════════════════════════════════════════════════

VALID_STEAM = "76561198000000001"


class TestDailyStakeLimit:
    """M8 daily 500 AT stake limit — enforced in create_match and join_match."""

    def _user_row(self, steam=VALID_STEAM, riot=None, wallet="0xABC"):
        return (steam, riot, wallet)

    def _make_multi_session(self, today_staked: int, at_balance: int = 1000):
        """
        Build a session mock that returns, in order:
          1. user row (steam_id, riot_id, wallet_address)
          2. None (no active room)
          3. None (no penalty / not suspended)
          4. (at_balance,) — AT balance
          5. (today_staked,) — SUM from transactions for daily limit check
        """
        session = MagicMock()
        session.execute.return_value.fetchone.side_effect = [
            self._user_row(),                # 1. user lookup
            None,                            # 2. no active room
            None,                            # 3. no penalty row
            (at_balance,),                   # 4. AT balance
            (today_staked,),                 # 5. daily stake sum
        ]
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__  = MagicMock(return_value=False)
        return ctx

    def test_400_at_today_plus_200_is_rejected(self):
        """400 AT staked today + 200 new → over 500 cap → 429."""
        ctx = self._make_multi_session(today_staked=400)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/matches",
                json={"game": "CS2", "stake_amount": 200, "stake_currency": "AT"},
                headers=_USER_HEADERS,
            )
        assert resp.status_code == 429
        assert "limit" in resp.json()["detail"].lower()

    def test_0_at_today_plus_200_is_accepted(self):
        """0 AT staked today + 200 AT → under cap → match created."""
        session = MagicMock()
        session.execute.return_value.fetchone.side_effect = [
            self._user_row(),   # user lookup
            None,               # no active room
            None,               # no penalty
            (1000,),            # AT balance
            (0,),               # daily staked = 0
            (str(uuid.uuid4()),),  # INSERT match RETURNING id
        ]
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__  = MagicMock(return_value=False)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/matches",
                json={"game": "CS2", "stake_amount": 200, "stake_currency": "AT"},
                headers=_USER_HEADERS,
            )
        assert resp.status_code in (201, 200)

    def test_limit_resets_after_24h(self):
        """If today_staked query returns 0 (old txns outside window), new stake passes."""
        session = MagicMock()
        session.execute.return_value.fetchone.side_effect = [
            self._user_row(),
            None,
            None,
            (1000,),
            (0,),               # SUM = 0 (all txns older than 24h, excluded by SQL)
            (str(uuid.uuid4()),),
        ]
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__  = MagicMock(return_value=False)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/matches",
                json={"game": "CS2", "stake_amount": 400, "stake_currency": "AT"},
                headers=_USER_HEADERS,
            )
        assert resp.status_code in (201, 200)


# ═══════════════════════════════════════════════════════════════════════════════
# TestPenaltySystem
# ═══════════════════════════════════════════════════════════════════════════════

class TestPenaltySystem:
    """Suspension/ban gate on create_match (1st offense) and join_match (3rd+)."""

    def _user_row(self, steam=VALID_STEAM, riot=None, wallet="0xABC"):
        return (steam, riot, wallet)

    def _suspended_session(self, suspended_until_offset_hours: int = 24):
        """User whose suspended_until is in the future."""
        suspended_until = datetime.now(timezone.utc) + timedelta(hours=suspended_until_offset_hours)
        session = MagicMock()
        session.execute.return_value.fetchone.side_effect = [
            self._user_row(),                        # user lookup
            None,                                    # no active room
            (suspended_until, None),                 # penalty row: suspended
        ]
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__  = MagicMock(return_value=False)
        return ctx

    def _banned_session_join(self, match_row):
        """User who is permanently banned — for join_match."""
        session = MagicMock()
        session.execute.return_value.fetchone.side_effect = [
            self._user_row(),        # user lookup in join_match
            match_row,               # match status row
            (None, datetime.now(timezone.utc)),   # penalty: banned_at set
        ]
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__  = MagicMock(return_value=False)
        return ctx

    def test_suspended_user_cannot_create_match(self):
        """1st offense → suspended 24h → create_match returns 403."""
        ctx = self._suspended_session(24)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/matches",
                json={"game": "CS2", "stake_amount": 10, "stake_currency": "AT"},
                headers=_USER_HEADERS,
            )
        assert resp.status_code == 403
        assert "suspended" in resp.json()["detail"].lower()

    def test_suspended_7d_user_cannot_create_match(self):
        """2nd offense → suspended 7d → create_match returns 403."""
        ctx = self._suspended_session(7 * 24)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/matches",
                json={"game": "CS2", "stake_amount": 10, "stake_currency": "AT"},
                headers=_USER_HEADERS,
            )
        assert resp.status_code == 403

    def test_banned_user_cannot_join_match(self):
        """3rd offense → banned → join_match returns 403."""
        match_id = str(uuid.uuid4())
        session = MagicMock()
        session.execute.return_value.fetchone.side_effect = [
            # 1. match lookup (7 fields: game, status, bet_amount, stake_currency, password, max_players, max_per_team)
            ("CS2", "waiting", 10, "AT", None, 2, 1),
            # 2. user row (3 fields: steam_id, riot_id, wallet_address)
            (VALID_STEAM, None, "0xABC"),
            # 3. penalty row → permanently banned
            (None, datetime.now(timezone.utc)),
        ]
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__  = MagicMock(return_value=False)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{match_id}/join",
                json={"game": "CS2"},
                headers=_USER_HEADERS,
            )
        assert resp.status_code == 403
        assert "banned" in resp.json()["detail"].lower()

    def test_user_without_penalty_is_not_blocked(self):
        """User with no penalty row → not blocked → proceeds normally."""
        session = MagicMock()
        session.execute.return_value.fetchone.side_effect = [
            self._user_row(),         # user lookup
            None,                     # no active room
            None,                     # no penalty row
            (1000,),                  # AT balance
            (0,),                     # daily staked
            (str(uuid.uuid4()),),     # INSERT RETURNING id
        ]
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__  = MagicMock(return_value=False)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/matches",
                json={"game": "CS2", "stake_amount": 10, "stake_currency": "AT"},
                headers=_USER_HEADERS,
            )
        assert resp.status_code in (201, 200)

    def test_penalty_requires_admin_token(self):
        """Non-admin POST /admin/users/{id}/penalty → 403."""
        ctx, session = _make_session(fetchone=None)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/admin/users/{_TARGET_ID}/penalty",
                json={"offense_type": "fraud"},
                headers=_USER_HEADERS,
            )
        assert resp.status_code == 403


# ═══════════════════════════════════════════════════════════════════════════════
# TestFraudReport
# ═══════════════════════════════════════════════════════════════════════════════

class TestFraudReport:
    """GET /admin/fraud/report — anomaly detection output structure."""

    def _empty_session(self):
        session = MagicMock()
        session.execute.return_value.fetchall.return_value = []
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__  = MagicMock(return_value=False)
        return ctx

    def test_report_returns_flagged_players_and_suspicious_pairs(self, as_admin):
        """GET /admin/fraud/report returns flagged_players + suspicious_pairs keys."""
        with patch("main.SessionLocal", return_value=self._empty_session()):
            resp = client.get("/admin/fraud/report", headers=_ADMIN_HEADERS)
        assert resp.status_code == 200
        data = resp.json()
        assert "flagged_players"  in data
        assert "suspicious_pairs" in data

    def test_fraud_report_requires_admin(self):
        """Non-admin cannot access fraud report → 403."""
        ctx = self._empty_session()
        ctx.__enter__.return_value.execute.return_value.fetchone.return_value = None
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/admin/fraud/report", headers=_USER_HEADERS)
        assert resp.status_code == 403
