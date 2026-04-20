"""
Audit-gap coverage for engine/src/contract/escrow_client.py.

Focuses on the three areas the audit report flagged as under-tested:
  1. Race / idempotency edges     — events arriving out of order, duplicate
                                    deliveries, missing DB state, FOR UPDATE
                                    locking of user_balances rows.
  2. Appeal / admin-override      — declare_winner + cancel_match_on_chain +
                                    pause/unpause propagating on-chain reverts
                                    cleanly instead of silent success.
  3. Cancel edges                 — match-not-found skips, depositors_only
                                    filter, null stake_per_player, empty
                                    player list.

Test scaffolding (_client, _sf) is imported from the existing suite so these
tests follow the same stubbing conventions and do NOT require web3/psycopg2.
"""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock

import pytest

# Re-use the stub scaffolding already defined in the main test module.
# This import also triggers the sys.modules["web3"] stub in the parent file.
from tests.test_escrow_client import _client, _sf  # noqa: F401


# ─────────────────────────────────────────────────────────────────────────────
# 1. Race / idempotency edges
# ─────────────────────────────────────────────────────────────────────────────

class TestRaceEventOrdering:
    """Events from the chain may arrive before the DB has caught up."""

    def test_player_deposited_before_user_row_exists(self):
        """
        Race: PlayerDeposited arrives before the wallet is registered in users.
        Handler must skip silently (no commit, no exception).
        """
        c, _, _, s = _client(fns=[None])
        c._handle_player_deposited({
            "args": {
                "matchId": 1, "player": "0xGhost", "team": 0,
                "stakePerPlayer": 10**17, "depositsTeamA": 1, "depositsTeamB": 0,
            }
        })
        s.commit.assert_not_called()

    def test_player_deposited_before_match_linked(self):
        """
        Race: PlayerDeposited arrives before MatchCreated has linked
        on_chain_match_id in the DB. Handler must skip silently.
        """
        uid = str(uuid.uuid4())
        c, _, _, s = _client(fns=[(uid,), None])
        c._handle_player_deposited({
            "args": {
                "matchId": 99, "player": "0xPlayer", "team": 1,
                "stakePerPlayer": 10**17, "depositsTeamA": 0, "depositsTeamB": 1,
            }
        })
        s.commit.assert_not_called()

    def test_winner_declared_before_players_inserted(self):
        """
        Race: WinnerDeclared arrives before match_players rows exist.
        Handler must still mark match completed (no winner_id but no crash).
        """
        mid = str(uuid.uuid4())
        c, _, _, s = _client(fns=[(mid,)], fas=[[]])  # match found, zero players
        c._handle_winner_declared({
            "args": {"matchId": 1, "winningTeam": 0,
                     "payoutPerWinner": 10**17, "fee": 10**15}
        })
        # Commit still runs (match row update + fee insert); crash would fail here.
        s.commit.assert_called_once()

    def test_duplicate_match_created_is_noop(self):
        """
        Re-org / listener restart: MatchCreated fires twice for same on_chain_id.
        C15 idempotency — second delivery must be a no-op.
        """
        c, _, _, s = _client(fns=[(str(uuid.uuid4()),)])
        c._handle_match_created({
            "args": {"matchId": 7, "creator": "0xC", "teamSize": 1,
                     "stakePerPlayer": 10**17}
        })
        s.commit.assert_not_called()


class TestRaceForUpdateLocking:
    """
    FOR UPDATE locks user_balances rows before mutation so concurrent
    handlers (event listener + API writer) cannot race on the same row.
    """

    def _locks_before_update(self, executed_sqls):
        """SELECT ... FOR UPDATE must appear before UPDATE user_balances."""
        lock_idx = next(
            (i for i, sql in enumerate(executed_sqls)
             if "FOR UPDATE" in sql and "user_balances" in sql),
            -1,
        )
        upd_idx = next(
            (i for i, sql in enumerate(executed_sqls)
             if sql.lstrip().startswith("UPDATE user_balances")),
            -1,
        )
        return lock_idx >= 0 and upd_idx > lock_idx

    def test_match_created_locks_user_balances(self):
        uid = str(uuid.uuid4()); mid = str(uuid.uuid4())
        c, _, _, s = _client(fns=[None, (uid,), (mid,)])
        c._handle_match_created({
            "args": {"matchId": 1, "creator": "0xC", "teamSize": 1,
                     "stakePerPlayer": 10**17}
        })
        sqls = [str(call.args[0]) for call in s.execute.call_args_list]
        assert self._locks_before_update(sqls), (
            "MatchCreated must SELECT FOR UPDATE user_balances before UPDATE"
        )

    def test_player_deposited_locks_user_balances(self):
        uid = str(uuid.uuid4()); mid = str(uuid.uuid4())
        c, _, _, s = _client(fns=[(uid,), (mid,)])
        c._handle_player_deposited({
            "args": {
                "matchId": 1, "player": "0xP", "team": 0,
                "stakePerPlayer": 10**17, "depositsTeamA": 1, "depositsTeamB": 0,
            }
        })
        sqls = [str(call.args[0]) for call in s.execute.call_args_list]
        assert self._locks_before_update(sqls), (
            "PlayerDeposited must SELECT FOR UPDATE before crediting in_escrow"
        )

    def test_winner_declared_locks_all_player_rows(self):
        """Both winner and loser user_balances rows must be locked."""
        mid = str(uuid.uuid4())
        winner = str(uuid.uuid4())
        loser = str(uuid.uuid4())
        c, _, _, s = _client(
            fns=[(mid,)],
            fas=[[(winner, "A"), (loser, "B")]],
        )
        c._handle_winner_declared({
            "args": {"matchId": 1, "winningTeam": 0,
                     "payoutPerWinner": 10**17, "fee": 10**15}
        })
        sqls = [str(call.args[0]) for call in s.execute.call_args_list]
        lock_count = sum(
            1 for sql in sqls if "FOR UPDATE" in sql and "user_balances" in sql
        )
        assert lock_count >= 2, (
            f"expected a FOR UPDATE per player, got {lock_count}"
        )

    def test_refund_locks_each_player_row(self):
        """_refund_all_players must lock user_balances per depositor."""
        mid = str(uuid.uuid4())
        p1 = str(uuid.uuid4()); p2 = str(uuid.uuid4())
        c, _, _, s = _client(
            fns=[(mid, 0.1, "in_progress")],        # match row (id, stake, status)
            fas=[[(p1,), (p2,)]],                   # players list
        )
        c._handle_match_cancelled({"args": {"matchId": 1}})
        sqls = [str(call.args[0]) for call in s.execute.call_args_list]
        lock_count = sum(
            1 for sql in sqls if "FOR UPDATE" in sql and "user_balances" in sql
        )
        assert lock_count >= 2, (
            f"expected one FOR UPDATE per refunded player, got {lock_count}"
        )


class TestProcessEventsPartialFailure:
    """process_events must not let one event type poison another."""

    def _setup(self, c, logs_by_name, fetch_errors=None):
        for h in ["_handle_match_created", "_handle_player_deposited",
                  "_handle_match_active", "_handle_winner_declared",
                  "_handle_match_refunded", "_handle_match_cancelled"]:
            setattr(c, h, MagicMock())
        for name in ["MatchCreated", "PlayerDeposited", "MatchActive",
                     "WinnerDeclared", "MatchRefunded", "MatchCancelled"]:
            ev = MagicMock()
            if fetch_errors and name in fetch_errors:
                ev.get_logs.side_effect = fetch_errors[name]
            else:
                ev.get_logs.return_value = logs_by_name.get(name, [])
            setattr(c._contract.events, name, ev)

    def test_one_fetch_fails_others_still_processed(self):
        """If MatchCreated.get_logs() errors, PlayerDeposited logs still process."""
        c, *_ = _client()
        self._setup(
            c,
            logs_by_name={"PlayerDeposited": [{}, {}]},
            fetch_errors={"MatchCreated": Exception("rpc glitch")},
        )
        assert c.process_events(1, 100) == 2
        assert c._handle_player_deposited.call_count == 2

    def test_one_handler_raises_sibling_logs_same_type_continue(self):
        """
        In-type resilience: if log[0] raises, log[1] in the same event type
        should still be processed.
        """
        c, *_ = _client()
        self._setup(c, logs_by_name={"WinnerDeclared": [{"i": 0}, {"i": 1}]})
        c._handle_winner_declared.side_effect = [RuntimeError("boom"), None]
        # One succeeded → count=1, one errored → skipped.
        assert c.process_events(1, 100) == 1
        assert c._handle_winner_declared.call_count == 2


# ─────────────────────────────────────────────────────────────────────────────
# 2. Appeal / admin-override edges
# ─────────────────────────────────────────────────────────────────────────────

class TestOnChainRevertPropagation:
    """
    declare_winner / cancel_match_on_chain / pause_contract must propagate
    _send_tx errors so main.py can surface them in admin responses. Silent
    success on revert would leave the DB inconsistent with chain state.
    """

    def test_declare_winner_propagates_contract_revert(self):
        """Oracle calls declareWinner but contract reverts — error bubbles up."""
        c, *_ = _client(fns=[(42,), ("A",)])
        c._send_tx = MagicMock(
            side_effect=RuntimeError("Transaction reverted: Match not active")
        )
        with pytest.raises(RuntimeError, match="Match not active"):
            c.declare_winner(str(uuid.uuid4()), str(uuid.uuid4()))

    def test_cancel_match_propagates_contract_revert(self):
        """Admin cancels but chain says match already ACTIVE — revert bubbles up."""
        c, *_ = _client(fns=[(9,)])
        c._send_tx = MagicMock(
            side_effect=RuntimeError("Transaction reverted: Match already started")
        )
        with pytest.raises(RuntimeError, match="already started"):
            c.cancel_match_on_chain(str(uuid.uuid4()))

    def test_pause_with_owner_key_propagates_double_pause_revert(self):
        """pause() on already-paused contract reverts — caller must see it."""
        c, *_ = _client(with_owner=True)
        c._send_tx = MagicMock(
            side_effect=RuntimeError("Transaction reverted: EnforcedPause")
        )
        with pytest.raises(RuntimeError, match="EnforcedPause"):
            c.pause_contract()

    def test_unpause_with_owner_key_propagates_revert(self):
        """unpause() when not paused reverts — caller must see it."""
        c, *_ = _client(with_owner=True)
        c._send_tx = MagicMock(
            side_effect=RuntimeError("Transaction reverted: ExpectedPause")
        )
        with pytest.raises(RuntimeError, match="ExpectedPause"):
            c.unpause_contract()


class TestAdminOverrideAccountIsolation:
    """
    Oracle account (_account) vs owner account (_owner_account) must not
    be swapped. Swapping would let a compromised oracle key pause the
    contract, or the owner key sign declareWinner calls the oracle expects.
    """

    def test_declare_winner_uses_oracle_account_not_owner(self):
        """declare_winner defaults _send_tx's account=None → oracle."""
        c, *_ = _client(fns=[(42,), ("A",)], with_owner=True)
        captured = {}

        def capture(fn, gas, account=None):
            captured["account"] = account
            return "0xTX"

        c._send_tx = capture
        c.declare_winner(str(uuid.uuid4()), str(uuid.uuid4()))
        # None means "use default (oracle) signer inside _send_tx".
        assert captured["account"] is None, (
            "declare_winner must NOT pass the owner account to _send_tx"
        )

    def test_cancel_match_uses_oracle_account_not_owner(self):
        """cancel_match_on_chain defaults to oracle signer."""
        c, *_ = _client(fns=[(9,)], with_owner=True)
        captured = {}

        def capture(fn, gas, account=None):
            captured["account"] = account
            return "0xTX"

        c._send_tx = capture
        c.cancel_match_on_chain(str(uuid.uuid4()))
        assert captured["account"] is None


# ─────────────────────────────────────────────────────────────────────────────
# 3. Cancel / refund edges
# ─────────────────────────────────────────────────────────────────────────────

class TestCancelRefundEdges:
    """Edge cases for _handle_match_cancelled / _handle_match_refunded."""

    def test_cancelled_event_for_unknown_match_is_noop(self):
        """Match isn't in DB (race with cleanup?) → skip, no crash."""
        c, _, _, s = _client(fns=[None])
        c._handle_match_cancelled({"args": {"matchId": 999}})
        s.commit.assert_not_called()

    def test_refunded_event_for_unknown_match_is_noop(self):
        """Refund event for match not in DB → skip, no crash."""
        c, _, _, s = _client(fns=[None])
        c._handle_match_refunded({"args": {"matchId": 999}})
        s.commit.assert_not_called()

    def test_cancel_depositors_only_filter_in_query(self):
        """
        _handle_match_cancelled must filter to has_deposited=TRUE so
        non-depositors (who never put money in escrow) don't get "refunded".
        """
        mid = str(uuid.uuid4())
        c, _, _, s = _client(fns=[(mid, 0.1, "in_progress")], fas=[[]])
        c._handle_match_cancelled({"args": {"matchId": 1}})
        sqls = [str(call.args[0]) for call in s.execute.call_args_list]
        assert any("has_deposited = TRUE" in sql for sql in sqls), (
            "MatchCancelled refunds must filter by has_deposited=TRUE"
        )

    def test_refund_does_not_filter_by_has_deposited(self):
        """
        _handle_match_refunded (timeout) refunds ALL match_players — the
        contract already enforced that only depositors could stake, so the
        query does not need the has_deposited filter here.
        """
        mid = str(uuid.uuid4())
        c, _, _, s = _client(fns=[(mid, 0.1, "in_progress")], fas=[[]])
        c._handle_match_refunded({"args": {"matchId": 1}})
        sqls = [str(call.args[0]) for call in s.execute.call_args_list]
        # The refund path must at least SELECT user_id FROM match_players,
        # but it should NOT apply the depositors-only predicate.
        player_query = [
            sql for sql in sqls
            if "SELECT user_id FROM match_players" in sql
        ]
        assert player_query, "refund must fetch match_players"
        assert not any(
            "has_deposited = TRUE" in sql for sql in player_query
        ), "MatchRefunded (timeout) must refund ALL players, not only depositors"

    def test_null_stake_defaults_to_zero(self):
        """
        Defensive: if matches.stake_per_player is NULL, refund amount is 0
        (no crash from float(None)). This can happen if MatchCreated event
        was missed but cancel still fires.
        """
        mid = str(uuid.uuid4())
        p1 = str(uuid.uuid4())
        c, _, _, s = _client(fns=[(mid, None, "in_progress")], fas=[[(p1,)]])
        c._handle_match_cancelled({"args": {"matchId": 1}})
        # Find the INSERT ... transactions refund row params.
        refund_calls = [
            call for call in s.execute.call_args_list
            if "'refund'" in str(call.args[0])
        ]
        assert refund_calls, "refund tx must be recorded"
        assert refund_calls[0].args[1]["amount"] == 0.0

    def test_empty_players_still_marks_match_cancelled(self):
        """
        Cancel before anyone deposits → zero players to refund, but the
        match row must still transition to status='cancelled'.
        """
        mid = str(uuid.uuid4())
        c, _, _, s = _client(fns=[(mid, 0.1, "in_progress")], fas=[[]])
        c._handle_match_cancelled({"args": {"matchId": 1}})
        sqls = [str(call.args[0]) for call in s.execute.call_args_list]
        assert any(
            "UPDATE matches" in sql and "'cancelled'" in sql for sql in sqls
        ), "match row must still be marked cancelled even with zero players"
        s.commit.assert_called_once()

    def test_cancel_match_on_chain_preserves_id_in_tx(self):
        """on_chain_id parsed from DB row must reach cancelMatch() intact."""
        c, _, ct, _ = _client(fns=[(12345,)])
        c._send_tx = MagicMock(return_value="0xCX")
        c.cancel_match_on_chain(str(uuid.uuid4()))
        ct.functions.cancelMatch.assert_called_once_with(12345)
