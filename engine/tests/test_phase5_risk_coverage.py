"""
test_phase5_risk_coverage.py — Phase 5 risk & fraud coverage.

Covers:
  TestAutoPenalty       — _auto_flag_consensus escalation tiers (24h / 7d / ban + blacklist)
  TestBlacklist         — registration blocked when wallet / steam / riot in wallet_blacklist
  TestMatchPlayersNull  — NULL user_id guard in _refund_at_match + match result loop
  TestAmlFraudReport    — intentional_losing section of GET /admin/fraud/report
  TestDeletePreservesHistory — _delete_user_account anonymises (SET user_id=NULL) instead of deleting

All tests mock SessionLocal; no real DB needed.

NOTE: TestMatchPlayersNull tests require fix/engine-null-uid-guard to be merged.
      On current main (without that fix) those tests will fail — by design.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, call, patch

import pytest
from fastapi.testclient import TestClient

from main import app, _auto_flag_consensus, _refund_at_match, _settle_at_match
from main import require_admin as _require_admin
import src.auth as auth

client = TestClient(app)

# ── Shared identities ─────────────────────────────────────────────────────────

_ADMIN_ID  = str(uuid.uuid4())
_USER_ID   = str(uuid.uuid4())
_MATCH_ID  = str(uuid.uuid4())
_WALLET    = "0xDeAdBeEf000000000000000000000000DeAdBeEf"
_STEAM_ID  = "76561198000000099"
_RIOT_ID   = "TestPlayer#1234"

_ADMIN_TOKEN = auth.issue_token(_ADMIN_ID, "admin@arena.gg", "AdminUser")
_USER_TOKEN  = auth.issue_token(_USER_ID,  "user@arena.gg",  "RegUser")

_ADMIN_HEADERS = {"Authorization": f"Bearer {_ADMIN_TOKEN}"}
_USER_HEADERS  = {"Authorization": f"Bearer {_USER_TOKEN}"}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _ctx(session: MagicMock):
    ctx = MagicMock()
    ctx.__enter__ = MagicMock(return_value=session)
    ctx.__exit__ = MagicMock(return_value=False)
    return ctx


def _make_session(*, fetchone_side=None, fetchone=None, fetchall=None, scalar=None):
    session = MagicMock()
    if fetchone_side is not None:
        session.execute.return_value.fetchone.side_effect = fetchone_side
    else:
        session.execute.return_value.fetchone.return_value = fetchone
    session.execute.return_value.fetchall.return_value = fetchall or []
    session.execute.return_value.scalar.return_value = scalar
    session.execute.return_value.rowcount = 1
    return session


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def as_admin():
    app.dependency_overrides[_require_admin] = lambda: {
        "sub": _ADMIN_ID, "email": "admin@arena.gg"
    }
    yield
    app.dependency_overrides.pop(_require_admin, None)


@pytest.fixture(autouse=True)
def no_suspension_check():
    with patch("main._assert_not_suspended", return_value=None):
        yield


# ═══════════════════════════════════════════════════════════════════════════════
# TestAutoPenalty — _auto_flag_consensus escalation tiers
# ═══════════════════════════════════════════════════════════════════════════════

class TestAutoPenalty:
    """_auto_flag_consensus: 1st offense→24h, 2nd→7d, 3rd+→ban+blacklist."""

    def _session_for_offense(self, user_id: str, offense_count: int, *,
                              steam_id="76561198099", riot_id="R#9",
                              wallet_addr=_WALLET):
        """
        Build a mock session for _auto_flag_consensus with a given offense count.
        Call sequence inside the function per wallet:
          1. SELECT id FROM users WHERE wallet_address = :w  → (user_id,)
          2. SELECT COALESCE(MAX(offense_count), 0) ...      → scalar → offense_count
          3. INSERT INTO player_penalties ...                (no return value needed)
          4. (only if banned) SELECT steam_id, riot_id, wallet_address FROM users → id_row
          5. (only if banned) INSERT INTO wallet_blacklist ...
        """
        session = MagicMock()
        call_n = [0]

        def ex_side(*args, **kw):
            m = MagicMock()
            sql = str(args[0])
            call_n[0] += 1
            if "SELECT id FROM users WHERE wallet_address" in sql:
                m.fetchone.return_value = (user_id,)
            elif "SELECT COALESCE(MAX(offense_count)" in sql:
                m.scalar.return_value = offense_count
            elif "INSERT INTO player_penalties" in sql:
                m.fetchone.return_value = None
            elif "SELECT steam_id, riot_id, wallet_address" in sql:
                m.fetchone.return_value = (steam_id, riot_id, wallet_addr)
            elif "INSERT INTO wallet_blacklist" in sql:
                m.fetchone.return_value = None
            return m

        session.execute.side_effect = ex_side
        return session

    def test_first_offense_inserts_24h_suspension(self):
        """offense_count=0 → new_count=1 → suspended_until=24h, banned_at=NULL."""
        uid = str(uuid.uuid4())
        session = self._session_for_offense(uid, 0)
        ctx = _ctx(session)

        with patch("main.SessionLocal", return_value=ctx), \
             patch("main._log_audit") as mock_audit:
            _auto_flag_consensus([_WALLET])

        # Must have committed
        session.commit.assert_called_once()

        # audit log should record suspended_24h
        mock_audit.assert_called_once()
        _, kw = mock_audit.call_args
        assert "suspended_24h" in kw.get("notes", "")

        # Should NOT insert into wallet_blacklist for first offense
        insert_blacklist_calls = [
            c for c in session.execute.call_args_list
            if "INSERT INTO wallet_blacklist" in str(c.args[0])
        ]
        assert len(insert_blacklist_calls) == 0

    def test_second_offense_inserts_7d_suspension(self):
        """offense_count=1 → new_count=2 → suspended_7d, no ban."""
        uid = str(uuid.uuid4())
        session = self._session_for_offense(uid, 1)
        ctx = _ctx(session)

        with patch("main.SessionLocal", return_value=ctx), \
             patch("main._log_audit") as mock_audit:
            _auto_flag_consensus([_WALLET])

        session.commit.assert_called_once()
        mock_audit.assert_called_once()
        _, kw = mock_audit.call_args
        assert "suspended_7d" in kw.get("notes", "")

        insert_blacklist_calls = [
            c for c in session.execute.call_args_list
            if "INSERT INTO wallet_blacklist" in str(c.args[0])
        ]
        assert len(insert_blacklist_calls) == 0

    def test_third_offense_inserts_ban_and_blacklist(self):
        """offense_count=2 → new_count=3 → banned_permanent + wallet_blacklist INSERT."""
        uid = str(uuid.uuid4())
        session = self._session_for_offense(uid, 2)
        ctx = _ctx(session)

        with patch("main.SessionLocal", return_value=ctx), \
             patch("main._log_audit") as mock_audit:
            _auto_flag_consensus([_WALLET])

        session.commit.assert_called_once()
        mock_audit.assert_called_once()
        _, kw = mock_audit.call_args
        assert "banned_permanent" in kw.get("notes", "")

        # wallet_blacklist row must be inserted on permanent ban
        insert_blacklist_calls = [
            c for c in session.execute.call_args_list
            if "INSERT INTO wallet_blacklist" in str(c.args[0])
        ]
        assert len(insert_blacklist_calls) == 1

    def test_unknown_wallet_is_skipped_gracefully(self):
        """If wallet maps to no user → skip without crash, no commit."""
        session = MagicMock()
        session.execute.return_value.fetchone.return_value = None  # no user found
        ctx = _ctx(session)

        with patch("main.SessionLocal", return_value=ctx):
            _auto_flag_consensus(["0xUnknownWallet"])

        # No penalty insert should happen
        insert_penalty_calls = [
            c for c in session.execute.call_args_list
            if "INSERT INTO player_penalties" in str(c.args[0])
        ]
        assert len(insert_penalty_calls) == 0

    def test_inner_error_does_not_block_next_wallet(self):
        """
        Inner exception on first wallet must not prevent second wallet from being processed.
        _auto_flag_consensus uses ONE session for all wallets; the inner try/except
        per wallet catches failures and continues.
        """
        uid_good = str(uuid.uuid4())
        bad_wallet  = "0xBadWallet000000000000000000000000000000"
        good_wallet = _WALLET

        # All calls go through one session object
        session = MagicMock()
        call_n = [0]

        def ex_side(*args, **kw):
            m = MagicMock()
            sql = str(args[0])
            if "SELECT id FROM users WHERE wallet_address" in sql:
                params = args[1] if len(args) > 1 else {}
                w = params.get("w", "")
                if w == bad_wallet:
                    raise RuntimeError("DB exploded for bad wallet")
                # good wallet → return user id
                m.fetchone.return_value = (uid_good,)
            elif "SELECT COALESCE(MAX(offense_count)" in sql:
                m.scalar.return_value = 0
            else:
                m.fetchone.return_value = None
            return m

        session.execute.side_effect = ex_side
        ctx = _ctx(session)

        with patch("main.SessionLocal", return_value=ctx), \
             patch("main._log_audit") as mock_audit:
            _auto_flag_consensus([bad_wallet, good_wallet])

        # Good wallet commit must have happened at least once
        session.commit.assert_called()
        # audit log must fire for good wallet
        mock_audit.assert_called_once()

    def test_empty_wallets_does_nothing(self):
        """Calling with empty list → no SessionLocal opened."""
        with patch("main.SessionLocal") as mock_sl:
            _auto_flag_consensus([])
        mock_sl.assert_not_called()


# ═══════════════════════════════════════════════════════════════════════════════
# TestBlacklist — wallet_blacklist gates at registration
# ═══════════════════════════════════════════════════════════════════════════════

class TestBlacklist:
    """
    POST /auth/register → 409 when steam_id / riot_id is in wallet_blacklist.

    Note: wallet_address is NOT part of RegisterRequest (it's linked via profile
    update after registration), so the wallet_blacklist check for wallet_address
    in /auth/register is a forward-compatible guard that activates if the field
    is ever added to RegisterRequest. The live checks are steam_id and riot_id.
    """

    # Valid Steam ID and Riot ID formats required by model validators
    _VALID_STEAM = "76561198000000099"
    _VALID_RIOT  = "TestPlayer#1234"

    _BASE_PAYLOAD = {
        "username": "NewPlayer",
        "email":    "new@arena.gg",
        "password": "StrongPass123!",
    }

    def _session_with_blacklisted(self, *, steam=False, riot=False):
        """
        Session mock for /auth/register.
        Execute order (per code flow):
          1. SELECT 1 FROM users WHERE lower(email) = :e → None
          2. SELECT 1 FROM users WHERE lower(username) = lower(:u) → None
          3. SELECT 1 FROM users WHERE steam_id = :s → None (uniqueness)
          4. SELECT 1 FROM users WHERE riot_id = :r  → None (uniqueness)
          5. wallet_blacklist WHERE steam_id  → (1,) if steam=True
          6. wallet_blacklist WHERE riot_id   → (1,) if riot=True
          7. INSERT INTO users …
        """
        session = MagicMock()

        def ex_side(*args, **kw):
            m = MagicMock()
            sql = str(args[0])
            if "lower(email)" in sql or "lower(username)" in sql:
                m.fetchone.return_value = None
            elif "WHERE steam_id = :s" in sql and "wallet_blacklist" not in sql:
                m.fetchone.return_value = None  # uniqueness: free
            elif "WHERE riot_id = :r" in sql and "wallet_blacklist" not in sql:
                m.fetchone.return_value = None  # uniqueness: free
            elif "wallet_blacklist WHERE steam_id" in sql:
                m.fetchone.return_value = (1,) if steam else None
            elif "wallet_blacklist WHERE riot_id" in sql:
                m.fetchone.return_value = (1,) if riot else None
            elif "wallet_blacklist WHERE wallet_address" in sql:
                m.fetchone.return_value = None
            else:
                m.fetchone.return_value = None
                m.fetchall.return_value = []
            return m

        session.execute.side_effect = ex_side
        return session

    def test_blacklisted_steam_blocks_registration(self):
        """Steam ID in wallet_blacklist → 409 'Steam ID is banned'."""
        session = self._session_with_blacklisted(steam=True)
        ctx = _ctx(session)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/auth/register",
                json={**self._BASE_PAYLOAD, "steam_id": self._VALID_STEAM},
            )
        assert resp.status_code == 409
        assert "steam" in resp.json()["detail"].lower()

    def test_blacklisted_riot_blocks_registration(self):
        """Riot ID in wallet_blacklist → 409 'Riot ID is banned'."""
        session = self._session_with_blacklisted(riot=True)
        ctx = _ctx(session)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/auth/register",
                json={**self._BASE_PAYLOAD, "riot_id": self._VALID_RIOT},
            )
        assert resp.status_code == 409
        assert "riot" in resp.json()["detail"].lower()

    def test_clean_identifiers_allow_registration(self):
        """No blacklist match → INSERT proceeds → 200/201 returned."""
        session = MagicMock()
        new_uid = str(uuid.uuid4())

        def ex_side(*args, **kw):
            m = MagicMock()
            sql = str(args[0])
            if "INSERT INTO users" in sql:
                m.fetchone.return_value = (new_uid, "NewPlayer", "new@arena.gg", "ARENA-TEST1")
            else:
                m.fetchone.return_value = None
                m.fetchall.return_value = []
            return m

        session.execute.side_effect = ex_side
        ctx = _ctx(session)

        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/auth/register",
                json={**self._BASE_PAYLOAD, "steam_id": self._VALID_STEAM},
            )

        assert resp.status_code in (200, 201)

    def test_both_identifiers_blacklisted_steam_checked_first(self):
        """When both steam_id and riot_id are blacklisted, steam error fires first."""
        session = self._session_with_blacklisted(steam=True, riot=True)
        ctx = _ctx(session)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/auth/register",
                json={
                    **self._BASE_PAYLOAD,
                    "steam_id": self._VALID_STEAM,
                    "riot_id":  self._VALID_RIOT,
                },
            )
        assert resp.status_code == 409
        # Steam check comes before riot check in the route
        assert "steam" in resp.json()["detail"].lower()


# ═══════════════════════════════════════════════════════════════════════════════
# TestMatchPlayersNull — NULL user_id guards (fix/engine-null-uid-guard)
# ═══════════════════════════════════════════════════════════════════════════════

class TestMatchPlayersNull:
    """
    NULL user_id in match_players (migration 026 — deleted accounts) must be
    silently skipped in _refund_at_match and the match result user_stats loop.

    fix/engine-null-uid-guard (PR #408) is merged — these tests now run for real.
    """

    def test_refund_skips_null_uid_and_credits_real_uid(self):
        """
        _refund_at_match with player_rows = [(None,), (real_uid,)]:
        _credit_at must be called exactly ONCE with real_uid, never with "None".
        """
        real_uid = str(uuid.uuid4())
        session = MagicMock()

        def ex_side(*args, **kw):
            m = MagicMock()
            sql = str(args[0])
            if "SELECT stake_currency, bet_amount" in sql:
                m.fetchone.return_value = ("AT", 10)
            elif "type IN ('match_win', 'refund')" in sql:
                m.fetchone.return_value = None  # idempotency: not yet paid
            elif "SELECT user_id FROM match_players" in sql:
                m.fetchall.return_value = [(None,), (real_uid,)]
            return m

        session.execute.side_effect = ex_side
        ctx = _ctx(session)

        credit_calls: list[str] = []

        def credit_side(sess, uid, amount, mid, tx_type):
            credit_calls.append(uid)

        with patch("main.SessionLocal", return_value=ctx), \
             patch("main._credit_at", side_effect=credit_side):
            _refund_at_match(_MATCH_ID)

        assert "None" not in credit_calls, "_credit_at must not be called with str(None)"
        assert real_uid in credit_calls, "_credit_at must be called for real uid"
        assert len(credit_calls) == 1

    def test_refund_all_null_rows_does_not_crash(self):
        """All player rows NULL (e.g. everyone deleted) → no crash, no credit calls."""
        session = MagicMock()

        def ex_side(*args, **kw):
            m = MagicMock()
            sql = str(args[0])
            if "SELECT stake_currency, bet_amount" in sql:
                m.fetchone.return_value = ("AT", 10)
            elif "type IN ('match_win', 'refund')" in sql:
                m.fetchone.return_value = None  # idempotency: not yet paid
            elif "SELECT user_id FROM match_players" in sql:
                m.fetchall.return_value = [(None,), (None,)]
            return m

        session.execute.side_effect = ex_side
        ctx = _ctx(session)

        credit_mock = MagicMock()
        with patch("main.SessionLocal", return_value=ctx), \
             patch("main._credit_at", credit_mock):
            _refund_at_match(_MATCH_ID)

        credit_mock.assert_not_called()

    def test_match_result_skips_null_uid_in_stats_loop(self):
        """
        POST /match/result with player_rows containing NULL user_id:
        user_stats UPDATE must only fire for the real winner, never for NULL row.

        Route requires Bearer token authentication.
        """
        real_winner = str(uuid.uuid4())
        session = MagicMock()

        def ex_side(*args, **kw):
            m = MagicMock()
            sql = str(args[0])
            if "SELECT user_id FROM match_players" in sql:
                m.fetchall.return_value = [(None,), (real_winner,)]
            else:
                m.fetchone.return_value = None
                m.fetchall.return_value = []
            return m

        session.execute.side_effect = ex_side
        ctx = _ctx(session)

        with patch("main.SessionLocal", return_value=ctx), \
             patch("main._send_system_inbox"):
            resp = client.post(
                "/match/result",
                json={
                    "match_id":  _MATCH_ID,
                    "winner_id": real_winner,
                    "game":      "CS2",
                    "players_detected": ["Player1"],
                    "agents_detected":  [],
                    "score": "13-9",
                },
                headers=_USER_HEADERS,  # route requires auth
            )

        # Route must succeed
        assert resp.status_code == 200

        # user_stats UPDATE must have been called exactly ONCE
        # (for real_winner only — NULL row skipped)
        update_stat_calls = [
            c for c in session.execute.call_args_list
            if "UPDATE user_stats" in str(c.args[0])
        ]
        assert len(update_stat_calls) == 1
        # The UID passed must be the real winner, not "None"
        params_used = update_stat_calls[0].args[1]
        assert params_used.get("uid") == real_winner


# ═══════════════════════════════════════════════════════════════════════════════
# TestAtPayoutIdempotency — _settle_at_match / _refund_at_match double-spend guard
# ═══════════════════════════════════════════════════════════════════════════════


class TestAtPayoutIdempotency:
    """
    Guards against the double-payout CRITICAL bug (C6/C7 from 2026-04 audit):

      1. _settle_at_match called twice for the same match → second call skipped.
      2. _refund_at_match called twice for the same match → second call skipped.
      3. _settle after _refund (or reverse) → second call skipped (cross-order).

    All tests mock SessionLocal + _credit_at; no real DB.
    """

    @staticmethod
    def _session_with_existing_payout(payout_exists: bool):
        """
        Build a mocked session whose idempotency SELECT returns a row
        (payout_exists=True) or None (payout_exists=False).
        """
        session = MagicMock()

        def ex_side(*args, **kw):
            m = MagicMock()
            sql = str(args[0])
            if "SELECT stake_currency, bet_amount" in sql:
                m.fetchone.return_value = ("AT", 10)
            elif "type IN ('match_win', 'refund')" in sql:
                m.fetchone.return_value = ("exists",) if payout_exists else None
            elif "SELECT user_id FROM match_players" in sql:
                m.fetchall.return_value = [(str(uuid.uuid4()),), (str(uuid.uuid4()),)]
            return m

        session.execute.side_effect = ex_side
        return session

    def test_settle_is_noop_when_payout_already_exists(self):
        """Second _settle_at_match call must NOT credit anyone."""
        session = self._session_with_existing_payout(payout_exists=True)
        ctx = _ctx(session)
        credit_mock = MagicMock()

        with patch("main.SessionLocal", return_value=ctx), \
             patch("main._credit_at", credit_mock):
            _settle_at_match(_MATCH_ID, str(uuid.uuid4()))

        credit_mock.assert_not_called()

    def test_refund_is_noop_when_payout_already_exists(self):
        """Second _refund_at_match call must NOT credit anyone."""
        session = self._session_with_existing_payout(payout_exists=True)
        ctx = _ctx(session)
        credit_mock = MagicMock()

        with patch("main.SessionLocal", return_value=ctx), \
             patch("main._credit_at", credit_mock):
            _refund_at_match(_MATCH_ID)

        credit_mock.assert_not_called()

    def test_settle_proceeds_when_no_prior_payout(self):
        """First _settle_at_match call must credit the winner exactly once."""
        session = self._session_with_existing_payout(payout_exists=False)
        ctx = _ctx(session)
        winner = str(uuid.uuid4())
        credit_calls: list[tuple] = []

        def credit_side(sess, uid, amount, mid, tx_type):
            credit_calls.append((uid, tx_type))

        with patch("main.SessionLocal", return_value=ctx), \
             patch("main._credit_at", side_effect=credit_side):
            _settle_at_match(_MATCH_ID, winner)

        match_win_calls = [c for c in credit_calls if c[1] == "match_win"]
        assert len(match_win_calls) == 1
        assert match_win_calls[0][0] == winner

    def test_refund_proceeds_when_no_prior_payout(self):
        """First _refund_at_match call must refund all non-null players."""
        session = self._session_with_existing_payout(payout_exists=False)
        ctx = _ctx(session)
        credit_calls: list[tuple] = []

        def credit_side(sess, uid, amount, mid, tx_type):
            credit_calls.append((uid, tx_type))

        with patch("main.SessionLocal", return_value=ctx), \
             patch("main._credit_at", side_effect=credit_side):
            _refund_at_match(_MATCH_ID)

        refund_calls = [c for c in credit_calls if c[1] == "refund"]
        assert len(refund_calls) == 2  # two non-null players from the fixture

    def test_settle_uses_for_update_lock(self):
        """The match row lookup must use SELECT ... FOR UPDATE for serialization."""
        session = self._session_with_existing_payout(payout_exists=False)
        ctx = _ctx(session)

        with patch("main.SessionLocal", return_value=ctx), \
             patch("main._credit_at"):
            _settle_at_match(_MATCH_ID, str(uuid.uuid4()))

        locked_match_selects = [
            c for c in session.execute.call_args_list
            if "SELECT stake_currency, bet_amount" in str(c.args[0])
            and "FOR UPDATE" in str(c.args[0])
        ]
        assert len(locked_match_selects) == 1, \
            "settle must lock the matches row FOR UPDATE to serialize concurrent callers"

    def test_refund_uses_for_update_lock(self):
        """Same FOR UPDATE requirement on the refund path."""
        session = self._session_with_existing_payout(payout_exists=False)
        ctx = _ctx(session)

        with patch("main.SessionLocal", return_value=ctx), \
             patch("main._credit_at"):
            _refund_at_match(_MATCH_ID)

        locked_match_selects = [
            c for c in session.execute.call_args_list
            if "SELECT stake_currency, bet_amount" in str(c.args[0])
            and "FOR UPDATE" in str(c.args[0])
        ]
        assert len(locked_match_selects) == 1


# ═══════════════════════════════════════════════════════════════════════════════
# TestAmlFraudReport — intentional_losing section of /admin/fraud/report
# ═══════════════════════════════════════════════════════════════════════════════

class TestAmlFraudReport:
    """GET /admin/fraud/report — intentional_losing AML detection (Issue #57)."""

    _CREATED = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

    def _aml_session(self, *, intl_rows: list):
        """
        Fraud report endpoint executes several queries.
        We only need to return plausible shapes for each section.
        intl_rows is the intentional_losing fetchall result.
        """
        session = MagicMock()

        def ex_side(*args, **kw):
            m = MagicMock()
            sql = str(args[0])
            # intentional_losing query
            if "mp_loser.user_id" in sql and "mp_winner.user_id" in sql:
                m.fetchall.return_value = intl_rows
            else:
                m.fetchall.return_value = []
                m.fetchone.return_value = None
            return m

        session.execute.side_effect = ex_side
        return session

    def test_intentional_losing_pair_appears_in_report(self, as_admin):
        loser_id  = str(uuid.uuid4())
        winner_id = str(uuid.uuid4())
        row = (
            loser_id,  "LoserPlayer",
            winner_id, "WinnerPlayer",
            7,         self._CREATED, self._CREATED,
        )
        session = self._aml_session(intl_rows=[row])
        ctx = _ctx(session)

        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/admin/fraud/report", headers=_ADMIN_HEADERS)

        assert resp.status_code == 200
        body = resp.json()
        assert "intentional_losing" in body
        pairs = body["intentional_losing"]
        assert len(pairs) == 1

        pair = pairs[0]
        assert pair["loser_id"]       == loser_id
        assert pair["winner_id"]      == winner_id
        assert pair["loss_count"]     == 7
        assert pair["reason"]         == "intentional_losing"
        assert pair["loser_username"] == "LoserPlayer"
        assert pair["winner_username"] == "WinnerPlayer"

    def test_no_aml_pairs_returns_empty_list(self, as_admin):
        session = self._aml_session(intl_rows=[])
        ctx = _ctx(session)

        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/admin/fraud/report", headers=_ADMIN_HEADERS)

        assert resp.status_code == 200
        body = resp.json()
        assert body["intentional_losing"] == []
        assert body["summary"]["intentional_losing"] == 0

    def test_intentional_losing_counted_in_summary(self, as_admin):
        loser_id  = str(uuid.uuid4())
        winner_id = str(uuid.uuid4())
        rows = [
            (loser_id, "LP", winner_id, "WP", 6, self._CREATED, self._CREATED),
            (loser_id, "LP", winner_id, "WP", 5, self._CREATED, self._CREATED),
        ]
        session = self._aml_session(intl_rows=rows)
        ctx = _ctx(session)

        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/admin/fraud/report", headers=_ADMIN_HEADERS)

        assert resp.status_code == 200
        body = resp.json()
        assert body["summary"]["intentional_losing"] == 2
        assert body["summary"]["total_flagged"] >= 2

    def test_fraud_report_requires_admin(self):
        resp = client.get("/admin/fraud/report", headers=_USER_HEADERS)
        assert resp.status_code == 403


# ═══════════════════════════════════════════════════════════════════════════════
# TestDeletePreservesHistory — _delete_user_account anonymises with SET NULL
# ═══════════════════════════════════════════════════════════════════════════════

class TestDeletePreservesHistory:
    """
    _delete_user_account must issue UPDATE match_players SET user_id=NULL
    (anonymise) rather than DELETE FROM match_players (which loses history).
    Migration 026 makes user_id nullable; the implementation at line ~2809
    already uses SET user_id=NULL.  This test locks that contract in.
    """

    def _session_delete_preserves(self):
        uid = str(uuid.uuid4())
        session = MagicMock()

        def ex_side(*args, **kw):
            m = MagicMock()
            sql = str(args[0])
            # active match guard → None (no active match)
            if "m.status IN ('waiting','in_progress','disputed')" in sql:
                m.fetchone.return_value = None
            # user row fetch
            elif "SELECT steam_id, riot_id, wallet_address, email, username" in sql:
                m.fetchone.return_value = (
                    "76561198000000001", None, "0xABC",
                    "del@arena.gg", "DelUser",
                )
            # banned check
            elif "player_penalties" in sql and "banned_at IS NOT NULL" in sql:
                m.fetchone.return_value = None
            # support tickets list
            elif "SELECT id FROM support_tickets" in sql:
                m.fetchall.return_value = []
            else:
                m.fetchone.return_value = None
                m.fetchall.return_value = []
            return m

        session.execute.side_effect = ex_side
        return session

    def test_delete_issues_set_null_not_delete_for_match_players(self):
        """_delete_user_account must UPDATE match_players (anonymise) not DELETE."""
        from main import _delete_user_account

        session = self._session_delete_preserves()

        # Patch _cleanup_report_attachments_for_ticket to be a no-op
        with patch("main._cleanup_report_attachments_for_ticket"):
            _delete_user_account(session, str(uuid.uuid4()))

        executed_sqls = [str(c.args[0]) for c in session.execute.call_args_list]

        # Must have an UPDATE SET user_id = NULL
        has_set_null = any(
            "UPDATE match_players SET user_id = NULL" in sql
            for sql in executed_sqls
        )
        assert has_set_null, (
            "Expected 'UPDATE match_players SET user_id = NULL' but got:\n"
            + "\n".join(executed_sqls)
        )

        # Must NOT have a bare DELETE FROM match_players
        has_hard_delete = any(
            "DELETE FROM match_players" in sql
            for sql in executed_sqls
        )
        assert not has_hard_delete, (
            "Found unexpected 'DELETE FROM match_players' — "
            "history must be anonymised, not deleted."
        )
