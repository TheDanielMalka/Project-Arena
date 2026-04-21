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


@pytest.fixture(autouse=True)
def no_high_stakes_and_loss_cap_checks():
    """Issue #40: create/join mocks here only model daily stake + suspension."""
    with patch("main._check_high_stakes_daily_cap", return_value=None), \
         patch("main._check_daily_loss_cap", return_value=None):
        yield


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
    """Daily AT stake limit — enforced in create_match via _check_daily_stake_limit.

    Architecture: limit is stored in _at_daily_limit (in-memory, loaded from
    platform_config at startup). _check_daily_stake_limit reads _at_daily_limit
    directly + makes ONE DB call to sum today's COMPLETED matches.

    Key behavior: opening and cancelling a room does NOT consume the daily limit.
    Only matches with status='completed' count against the 24h cap.

    create_match DB call order through SessionLocal:
      1. user lookup (steam_id, riot_id, wallet_address)
      2. active room check
      3. _assert_not_suspended → player_penalties
      4. _assert_at_balance → at_balance
      5. _get_daily_staked → completed matches SUM  (ONE DB call for the limit check)

    Limit is controlled by patching main._at_daily_limit.
    """

    def _user_row(self, steam=VALID_STEAM, riot=None, wallet="0xABC"):
        return (steam, riot, wallet, steam is not None, riot is not None)

    def _make_multi_session(self, today_staked: int, at_balance: int = 1000):
        """
        Build a session mock for create_match.
        Limit is controlled separately via patch("main._at_daily_limit", value).
        """
        session = MagicMock()
        session.execute.return_value.fetchone.side_effect = [
            self._user_row(),        # 1. user lookup
            None,                    # 2. no active room
            None,                    # 3. no penalty row
            (at_balance,),           # 4. AT balance
            (today_staked,),         # 5. _get_daily_staked ← transactions SUM
        ]
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__  = MagicMock(return_value=False)
        return ctx

    def test_400_at_today_plus_200_is_rejected(self):
        """400 AT staked today + 200 new → over 500 cap → 429."""
        ctx = self._make_multi_session(today_staked=400)
        with patch("main._at_daily_limit", 500), \
             patch("main.SessionLocal", return_value=ctx):
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
            self._user_row(),          # user lookup
            None,                      # no active room
            None,                      # no penalty
            (1000,),                   # AT balance
            (0,),                      # _get_daily_staked ← 0 staked today
            (str(uuid.uuid4()),),      # INSERT match RETURNING id
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
        """SUM query returns 0 (completed matches older than 24h excluded) → stake passes."""
        session = MagicMock()
        session.execute.return_value.fetchone.side_effect = [
            self._user_row(),
            None,                      # no active room
            None,                      # no penalty
            (1000,),                   # AT balance
            (0,),                      # _get_daily_staked ← 0 (old matches excluded)
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

    def test_cancelled_match_does_not_count_against_limit(self):
        """
        Opening and cancelling a room must NOT consume the daily limit.
        _get_daily_staked() only sums status='completed' matches — cancelled
        rooms return 0 even if AT was locked during the session.
        """
        # Simulate: user cancelled a 400 AT match earlier today.
        # _get_daily_staked returns 0 because that match is 'cancelled', not 'completed'.
        session = MagicMock()
        session.execute.return_value.fetchone.side_effect = [
            self._user_row(),
            None,                      # no active room
            None,                      # no penalty
            (1000,),                   # AT balance
            (0,),                      # _get_daily_staked ← 0 (cancelled match excluded)
            (str(uuid.uuid4()),),      # INSERT match RETURNING id
        ]
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__  = MagicMock(return_value=False)
        with patch("main._at_daily_limit", 500), \
             patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/matches",
                json={"game": "CS2", "stake_amount": 400, "stake_currency": "AT"},
                headers=_USER_HEADERS,
            )
        # Should succeed — cancelled match does not count
        assert resp.status_code in (201, 200), (
            f"Expected 201/200 but got {resp.status_code}: {resp.json()}"
        )


# ═══════════════════════════════════════════════════════════════════════════════
# TestPenaltySystem
# ═══════════════════════════════════════════════════════════════════════════════

class TestPenaltySystem:
    """Suspension/ban gate on create_match (1st offense) and join_match (3rd+)."""

    def _user_row(self, steam=VALID_STEAM, riot=None, wallet="0xABC"):
        return (steam, riot, wallet, steam is not None, riot is not None)

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
            # 2. user row (5 fields: steam_id, riot_id, wallet_address, steam_verified, riot_verified)
            (VALID_STEAM, None, "0xABC", True, False),
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
            (0,),                     # _get_daily_staked → 0 staked today
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
