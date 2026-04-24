"""
Tests for DisconnectMonitor — two-phase grace-period state machine
(replaces RageQuitDetector / test_rage_quit.py).

Covers:
  1. _team_alive()           — heartbeat threshold helper
  2. _process() transitions  — NORMAL → WARNING → FORFEIT / HOLDING / NORMAL
  3. _execute_forfeit()      — DB update + AT/CRYPTO payout forks
  4. _execute_holding()      — DB update + AT refund / CRYPTO transfer
  5. _active_matches_with_players() — DB fetch + graceful fallback
  6. forfeit_committed guard — DB filter prevents double-forfeit
  7. Warning cleared on return
"""
from __future__ import annotations

import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, call, patch

import pytest

from src.vision.disconnect_monitor import DisconnectMonitor, _Phase, _MatchState, _team_alive

# ── Constants ─────────────────────────────────────────────────────────────────

NOW    = datetime(2026, 4, 5, 12, 0, 0, tzinfo=timezone.utc)
FRESH  = NOW - timedelta(seconds=10)   # well within warn threshold
STALE  = NOW - timedelta(seconds=200)  # past both warn (30s) and grace (120s)
WARN   = NOW - timedelta(seconds=35)   # past warn (30s) but within grace

MATCH_ID = str(uuid.uuid4())
USER_A   = str(uuid.uuid4())
USER_B   = str(uuid.uuid4())

CFG = {
    "warn":           30,
    "grace":          120,
    "interval":       15,
    "holding_wallet": "0xHoldingWallet",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_session_factory(rows_by_key: dict | None = None, fetchone_map: dict | None = None):
    rows_by_key  = rows_by_key  or {}
    fetchone_map = fetchone_map or {}

    @contextmanager
    def factory():
        session = MagicMock()

        def execute_side(query, params=None):
            sql = str(query)
            result = MagicMock()
            for key, rows in rows_by_key.items():
                if key in sql:
                    result.fetchall.return_value = rows
                    result.fetchone.return_value = (
                        fetchone_map.get(key, rows[0] if rows else None)
                    )
                    return result
            # Default: return a non-None fetchone (simulates UPDATE RETURNING id)
            result.fetchall.return_value = []
            result.fetchone.return_value = (MATCH_ID,)
            return result

        session.execute.side_effect = execute_side
        yield session

    return factory


def _monitor(rows_by_key=None, fetchone_map=None, escrow=None, settle_at=None, refund_at=None):
    return DisconnectMonitor(
        session_factory=_make_session_factory(rows_by_key, fetchone_map),
        escrow_client=escrow,
        settle_at_fn=settle_at,
        refund_at_fn=refund_at,
    )


def _players(a_hb=FRESH, b_hb=FRESH):
    return [
        {"user_id": USER_A, "team": "A", "last_heartbeat": a_hb},
        {"user_id": USER_B, "team": "B", "last_heartbeat": b_hb},
    ]


# ── 1. _team_alive ────────────────────────────────────────────────────────────

class TestTeamAlive:
    CUTOFF = NOW - timedelta(seconds=30)

    def test_fresh_heartbeat_alive(self):
        assert _team_alive([{"last_heartbeat": FRESH}], self.CUTOFF) is True

    def test_stale_heartbeat_dead(self):
        assert _team_alive([{"last_heartbeat": STALE}], self.CUTOFF) is False

    def test_none_heartbeat_dead(self):
        assert _team_alive([{"last_heartbeat": None}], self.CUTOFF) is False

    def test_at_least_one_fresh_makes_alive(self):
        players = [
            {"last_heartbeat": STALE},
            {"last_heartbeat": FRESH},
        ]
        assert _team_alive(players, self.CUTOFF) is True

    def test_all_stale_dead(self):
        players = [
            {"last_heartbeat": STALE},
            {"last_heartbeat": STALE},
        ]
        assert _team_alive(players, self.CUTOFF) is False

    def test_empty_list_dead(self):
        assert _team_alive([], self.CUTOFF) is False

    def test_naive_datetime_treated_as_utc(self):
        naive = FRESH.replace(tzinfo=None)
        assert _team_alive([{"last_heartbeat": naive}], self.CUTOFF) is True


# ── 2. _process() transitions ─────────────────────────────────────────────────

class TestProcessTransitions:

    def _state(self, phase=_Phase.NORMAL, warning_team=None, warning_at=None):
        return _MatchState(
            match_id=MATCH_ID,
            phase=phase,
            warning_team=warning_team,
            warning_at=warning_at,
        )

    def test_both_alive_no_change(self):
        m = _monitor()
        state = self._state()
        m._process(state, _players(FRESH, FRESH), "AT", CFG, NOW)
        assert state.phase == _Phase.NORMAL

    def test_both_alive_clears_warning(self):
        warning_start = NOW - timedelta(seconds=50)
        m = _monitor()
        state = self._state(_Phase.WARNING, "B", warning_start)
        with patch.object(m, "_clear_warning_db"):
            m._process(state, _players(FRESH, FRESH), "AT", CFG, NOW)
        assert state.phase == _Phase.NORMAL
        assert state.warning_team is None

    def test_one_gone_enters_warning(self):
        m = _monitor()
        state = self._state()
        with patch.object(m, "_enter_warning") as mock_warn, \
             patch.object(m, "_notify_disconnect"):
            m._process(state, _players(FRESH, STALE), "AT", CFG, NOW)
            mock_warn.assert_called_once_with(state, "B", NOW)

    def test_both_gone_enters_warning_both(self):
        m = _monitor()
        state = self._state()
        with patch.object(m, "_enter_warning") as mock_warn, \
             patch.object(m, "_notify_both_gone"):
            m._process(state, _players(STALE, STALE), "AT", CFG, NOW)
            mock_warn.assert_called_once_with(state, "BOTH", NOW)

    def test_grace_expired_one_gone_triggers_forfeit(self):
        warning_start = NOW - timedelta(seconds=CFG["grace"] + 1)
        m = _monitor()
        state = self._state(_Phase.WARNING, "B", warning_start)
        with patch.object(m, "_execute_forfeit") as mock_forfeit, \
             patch.object(m, "_resolve_winner", return_value=USER_A):
            m._process(state, _players(FRESH, STALE), "AT", CFG, NOW)
            mock_forfeit.assert_called_once()
            assert state.phase == _Phase.DONE

    def test_grace_not_expired_no_forfeit(self):
        warning_start = NOW - timedelta(seconds=CFG["grace"] - 30)
        m = _monitor()
        state = self._state(_Phase.WARNING, "B", warning_start)
        with patch.object(m, "_execute_forfeit") as mock_forfeit:
            m._process(state, _players(FRESH, STALE), "AT", CFG, NOW)
            mock_forfeit.assert_not_called()
        assert state.phase == _Phase.WARNING

    def test_grace_expired_both_gone_triggers_holding(self):
        warning_start = NOW - timedelta(seconds=CFG["grace"] + 1)
        m = _monitor()
        state = self._state(_Phase.WARNING, "BOTH", warning_start)
        with patch.object(m, "_execute_holding") as mock_hold:
            m._process(state, _players(STALE, STALE), "AT", CFG, NOW)
            mock_hold.assert_called_once_with(MATCH_ID, "AT", CFG["holding_wallet"])
            assert state.phase == _Phase.DONE

    def test_done_phase_skipped(self):
        m = _monitor()
        state = self._state(_Phase.DONE)
        with patch.object(m, "_execute_forfeit") as mf, \
             patch.object(m, "_execute_holding") as mh:
            # _process is not called for DONE in _tick; verify no side-effects here anyway
            # If called directly it does nothing because of phase guard in _tick
            pass  # covered by _tick tests below


# ── 3. _execute_forfeit ───────────────────────────────────────────────────────

class TestExecuteForfeit:

    def _factory_with_session(self):
        session_mock = MagicMock()
        result = MagicMock()
        result.fetchone.return_value = (MATCH_ID,)
        session_mock.execute.return_value = result

        @contextmanager
        def factory():
            yield session_mock

        return factory, session_mock

    def test_db_updated_and_committed(self):
        factory, session = self._factory_with_session()
        m = DisconnectMonitor(session_factory=factory)
        m._execute_forfeit(MATCH_ID, "AT", USER_A, "B", _players(STALE, STALE), _players(FRESH, FRESH))
        session.execute.assert_called()
        # First execute call is the UPDATE — check SQL template
        first_sql = str(session.execute.call_args_list[0][0][0])
        assert "completed" in first_sql
        session.commit.assert_called()

    def test_at_forfeit_calls_settle_fn(self):
        factory, _ = self._factory_with_session()
        settle = MagicMock()
        m = DisconnectMonitor(session_factory=factory, settle_at_fn=settle)
        with patch.object(m, "_notify_forfeit_result"):
            m._execute_forfeit(MATCH_ID, "AT", USER_A, "B", [], [])
        settle.assert_called_once_with(MATCH_ID, USER_A)

    def test_crypto_forfeit_calls_declare_winner(self):
        factory, _ = self._factory_with_session()
        escrow = MagicMock()
        escrow.declare_winner.return_value = "0xtxhash"
        m = DisconnectMonitor(session_factory=factory, escrow_client=escrow)
        with patch.object(m, "_notify_forfeit_result"):
            m._execute_forfeit(MATCH_ID, "CRYPTO", USER_A, "B", [], [])
        escrow.declare_winner.assert_called_once_with(MATCH_ID, USER_A)

    def test_at_forfeit_does_not_call_escrow(self):
        factory, _ = self._factory_with_session()
        escrow = MagicMock()
        settle = MagicMock()
        m = DisconnectMonitor(session_factory=factory, escrow_client=escrow, settle_at_fn=settle)
        with patch.object(m, "_notify_forfeit_result"):
            m._execute_forfeit(MATCH_ID, "AT", USER_A, "B", [], [])
        escrow.declare_winner.assert_not_called()

    def test_contract_error_does_not_raise(self):
        factory, _ = self._factory_with_session()
        escrow = MagicMock()
        escrow.declare_winner.side_effect = Exception("tx reverted")
        m = DisconnectMonitor(session_factory=factory, escrow_client=escrow)
        with patch.object(m, "_notify_forfeit_result"):
            m._execute_forfeit(MATCH_ID, "CRYPTO", USER_A, "B", [], [])

    def test_db_failure_prevents_contract_call(self):
        session_mock = MagicMock()
        result = MagicMock()
        result.fetchone.return_value = None   # UPDATE matched nothing
        session_mock.execute.return_value = result

        @contextmanager
        def factory():
            yield session_mock

        escrow = MagicMock()
        m = DisconnectMonitor(session_factory=factory, escrow_client=escrow)
        m._execute_forfeit(MATCH_ID, "CRYPTO", USER_A, "B", [], [])
        escrow.declare_winner.assert_not_called()


# ── 4. _execute_holding ───────────────────────────────────────────────────────

class TestExecuteHolding:

    def _factory_returning(self, fetchone_val):
        session_mock = MagicMock()
        result = MagicMock()
        result.fetchone.return_value = fetchone_val
        session_mock.execute.return_value = result

        @contextmanager
        def factory():
            yield session_mock

        return factory, session_mock

    def test_db_marks_disputed(self):
        factory, session = self._factory_returning((MATCH_ID,))
        m = DisconnectMonitor(session_factory=factory)
        m._execute_holding(MATCH_ID, "AT", "")
        # SQL uses :status placeholder — check params dict
        params = session.execute.call_args_list[0][0][1]
        assert params.get("status") == "disputed"
        session.commit.assert_called()

    def test_at_holding_calls_refund_fn(self):
        factory, _ = self._factory_returning((MATCH_ID,))
        refund = MagicMock()
        m = DisconnectMonitor(session_factory=factory, refund_at_fn=refund)
        m._execute_holding(MATCH_ID, "AT", "")
        refund.assert_called_once_with(MATCH_ID)

    def test_crypto_holding_calls_transfer_to_holding(self):
        factory, _ = self._factory_returning((MATCH_ID,))
        escrow = MagicMock()
        escrow.transfer_to_holding.return_value = "0xtxhash"
        m = DisconnectMonitor(session_factory=factory, escrow_client=escrow)
        m._execute_holding(MATCH_ID, "CRYPTO", "0xWallet")
        escrow.transfer_to_holding.assert_called_once_with(MATCH_ID, "0xWallet", "both_disconnected")

    def test_crypto_holding_no_wallet_skips_transfer(self):
        factory, _ = self._factory_returning((MATCH_ID,))
        escrow = MagicMock()
        m = DisconnectMonitor(session_factory=factory, escrow_client=escrow)
        m._execute_holding(MATCH_ID, "CRYPTO", "")
        escrow.transfer_to_holding.assert_not_called()

    def test_crypto_not_implemented_does_not_raise(self):
        factory, _ = self._factory_returning((MATCH_ID,))
        escrow = MagicMock()
        escrow.transfer_to_holding.side_effect = NotImplementedError("not deployed")
        m = DisconnectMonitor(session_factory=factory, escrow_client=escrow)
        m._execute_holding(MATCH_ID, "CRYPTO", "0xWallet")

    def test_db_no_update_skips_callbacks(self):
        factory, _ = self._factory_returning(None)
        refund = MagicMock()
        escrow = MagicMock()
        m = DisconnectMonitor(session_factory=factory, escrow_client=escrow, refund_at_fn=refund)
        m._execute_holding(MATCH_ID, "AT", "")
        refund.assert_not_called()
        escrow.transfer_to_holding.assert_not_called()


# ── 5. _active_matches_with_players ──────────────────────────────────────────

class TestActiveMatchesWithPlayers:

    def test_returns_match_with_players(self):
        hb = NOW - timedelta(seconds=5)
        rows = [
            (MATCH_ID, "CRYPTO", USER_A, "A", hb),
            (MATCH_ID, "CRYPTO", USER_B, "B", hb),
        ]
        m = _monitor(rows_by_key={"in_progress": rows})
        result = m._active_matches_with_players()
        assert len(result) == 1
        mid, currency, players = result[0]
        assert mid == MATCH_ID
        assert currency == "CRYPTO"
        assert len(players) == 2

    def test_returns_empty_on_db_error(self):
        @contextmanager
        def broken():
            session = MagicMock()
            session.execute.side_effect = Exception("DB down")
            yield session

        m = DisconnectMonitor(session_factory=broken)
        assert m._active_matches_with_players() == []

    def test_naive_heartbeat_gets_utc_tz(self):
        naive_hb = (NOW - timedelta(seconds=5)).replace(tzinfo=None)
        rows = [(MATCH_ID, "AT", USER_A, "A", naive_hb)]
        m = _monitor(rows_by_key={"in_progress": rows})
        result = m._active_matches_with_players()
        _, _, players = result[0]
        assert players[0]["last_heartbeat"].tzinfo is not None

    def test_no_active_matches_returns_empty(self):
        m = _monitor(rows_by_key={"in_progress": []})
        assert m._active_matches_with_players() == []


# ── 6. forfeit_committed guard ────────────────────────────────────────────────

class TestForfeitCommittedGuard:
    """forfeit_committed=TRUE matches are excluded by the WHERE clause in the DB query.
       Verify that a DONE state in memory is also skipped by _tick."""

    def test_done_state_not_processed(self):
        rows = [(MATCH_ID, "AT", USER_A, "A", FRESH), (MATCH_ID, "AT", USER_B, "B", STALE)]
        m = _monitor(rows_by_key={"in_progress": rows})
        m._states[MATCH_ID] = _MatchState(match_id=MATCH_ID, phase=_Phase.DONE)

        with patch.object(m, "_execute_forfeit") as mf:
            m._tick(CFG)
            mf.assert_not_called()


# ── 7. Warning cleared on team return ─────────────────────────────────────────

class TestWarningClearedOnReturn:

    def test_warning_cleared_when_silent_team_returns(self):
        # Test _process directly to avoid datetime.now() drift in _tick
        warning_start = NOW - timedelta(seconds=50)
        m = _monitor()
        state = _MatchState(
            match_id=MATCH_ID,
            phase=_Phase.WARNING,
            warning_team="B",
            warning_at=warning_start,
        )

        with patch.object(m, "_clear_warning_db") as mock_clear:
            m._process(state, _players(FRESH, FRESH), "AT", CFG, NOW)
            mock_clear.assert_called_once_with(MATCH_ID)

        assert state.phase == _Phase.NORMAL
        assert state.warning_team is None
