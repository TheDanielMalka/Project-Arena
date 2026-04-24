"""
Tests for engine/src/vision/consensus.py

Sections:
  1. Pure in-memory majority-fallback tests (no team wallets, no DB).
  2. DB-backed tests — MagicMock session_factory (persist + restore).
  3. Cross-team dual-validation tests (1v1, 2v2, 5v5 with team wallets).
"""
import pytest
from unittest.mock import MagicMock
from src.vision.consensus import MatchConsensus, ConsensusStatus, PlayerSubmission, CONSENSUS_THRESHOLD
from src.vision.engine import VisionEngineOutput


# ------------------------------------------------------------------ #
#  Helpers                                                             #
# ------------------------------------------------------------------ #

def make_output(result: str, confidence: float = 0.95, players=None) -> VisionEngineOutput:
    return VisionEngineOutput(
        result=result,
        confidence=confidence,
        players=players or [],
        accepted=True,
    )

def wallet(n: int) -> str:
    return f"0x{'0' * 39}{n}"


# ------------------------------------------------------------------ #
#  Basic submission                                                    #
# ------------------------------------------------------------------ #

def test_pending_when_not_all_submitted():
    c = MatchConsensus(match_id="m1", expected_players=10)
    status = c.submit(wallet(1), make_output("CT_WIN"))
    assert status == ConsensusStatus.PENDING


def test_received_count_increments():
    c = MatchConsensus(match_id="m1", expected_players=10)
    c.submit(wallet(1), make_output("CT_WIN"))
    c.submit(wallet(2), make_output("CT_WIN"))
    assert c.received_count() == 2


def test_duplicate_submission_ignored():
    c = MatchConsensus(match_id="m1", expected_players=10)
    c.submit(wallet(1), make_output("CT_WIN"))
    c.submit(wallet(1), make_output("T_WIN"))   # duplicate
    assert c.received_count() == 1


def test_is_complete_false_before_all():
    c = MatchConsensus(match_id="m1", expected_players=3)
    c.submit(wallet(1), make_output("CT_WIN"))
    assert not c.is_complete()


def test_is_complete_true_after_all():
    c = MatchConsensus(match_id="m1", expected_players=2)
    c.submit(wallet(1), make_output("CT_WIN"))
    c.submit(wallet(2), make_output("CT_WIN"))
    assert c.is_complete()


# ------------------------------------------------------------------ #
#  Consensus reached                                                   #
# ------------------------------------------------------------------ #

def test_consensus_reached_unanimous():
    c = MatchConsensus(match_id="m1", expected_players=4)
    for i in range(4):
        c.submit(wallet(i), make_output("CT_WIN"))
    verdict = c.evaluate()
    assert verdict.status == ConsensusStatus.REACHED
    assert verdict.agreed_result == "CT_WIN"
    assert verdict.flagged_wallets == []


def test_consensus_reached_majority():
    """8 agree, 2 disagree → threshold 75% met (8/10 = 80%)."""
    c = MatchConsensus(match_id="m1", expected_players=10)
    for i in range(8):
        c.submit(wallet(i), make_output("CT_WIN"))
    for i in range(8, 10):
        c.submit(wallet(i), make_output("T_WIN"))
    verdict = c.evaluate()
    assert verdict.status == ConsensusStatus.REACHED
    assert verdict.agreed_result == "CT_WIN"
    assert verdict.agreeing_players == 8


def test_consensus_reached_flags_minority():
    c = MatchConsensus(match_id="m1", expected_players=10)
    for i in range(8):
        c.submit(wallet(i), make_output("CT_WIN"))
    for i in range(8, 10):
        c.submit(wallet(i), make_output("T_WIN"))   # cheaters
    verdict = c.evaluate()
    assert verdict.status == ConsensusStatus.REACHED
    assert set(verdict.flagged_wallets) == {wallet(8), wallet(9)}


def test_consensus_exactly_at_threshold():
    """Exactly 75% agree (9/12) → REACHED."""
    c = MatchConsensus(match_id="m1", expected_players=12)
    for i in range(9):
        c.submit(wallet(i), make_output("CT_WIN"))
    for i in range(9, 12):
        c.submit(wallet(i), make_output("T_WIN"))
    verdict = c.evaluate()
    assert verdict.status == ConsensusStatus.REACHED


# ------------------------------------------------------------------ #
#  Consensus failed                                                    #
# ------------------------------------------------------------------ #

def test_consensus_failed_split():
    """5 vs 5 → no majority."""
    c = MatchConsensus(match_id="m1", expected_players=10)
    for i in range(5):
        c.submit(wallet(i), make_output("CT_WIN"))
    for i in range(5, 10):
        c.submit(wallet(i), make_output("T_WIN"))
    verdict = c.evaluate()
    assert verdict.status == ConsensusStatus.FAILED
    assert verdict.agreed_result is None


def test_consensus_failed_three_way_split():
    """No single result reaches 60%."""
    c = MatchConsensus(match_id="m1", expected_players=9)
    for i in range(3):
        c.submit(wallet(i), make_output("CT_WIN"))
    for i in range(3, 6):
        c.submit(wallet(i), make_output("T_WIN"))
    for i in range(6, 9):
        c.submit(wallet(i), make_output("DRAW"))
    verdict = c.evaluate()
    assert verdict.status == ConsensusStatus.FAILED


def test_evaluate_empty_submissions():
    c = MatchConsensus(match_id="m1", expected_players=10)
    verdict = c.evaluate()
    assert verdict.status == ConsensusStatus.FAILED
    assert verdict.agreed_result is None


# ------------------------------------------------------------------ #
#  Partial evaluation (before all players submit)                      #
# ------------------------------------------------------------------ #

def test_evaluate_partial_still_works():
    """Can evaluate at any time, not only when complete."""
    c = MatchConsensus(match_id="m1", expected_players=10)
    for i in range(7):
        c.submit(wallet(i), make_output("CT_WIN"))
    verdict = c.evaluate()
    assert verdict.status == ConsensusStatus.REACHED
    assert verdict.total_players == 7


# ------------------------------------------------------------------ #
#  No-flagged on unanimous                                             #
# ------------------------------------------------------------------ #

def test_no_flagged_wallets_on_unanimous():
    c = MatchConsensus(match_id="m1", expected_players=5)
    for i in range(5):
        c.submit(wallet(i), make_output("T_WIN"))
    verdict = c.evaluate()
    assert verdict.flagged_wallets == []


# ------------------------------------------------------------------ #
#  Different match IDs are independent                                 #
# ------------------------------------------------------------------ #

def test_two_matches_independent():
    c1 = MatchConsensus(match_id="match_A", expected_players=2)
    c2 = MatchConsensus(match_id="match_B", expected_players=2)

    c1.submit(wallet(1), make_output("CT_WIN"))
    c1.submit(wallet(2), make_output("CT_WIN"))

    c2.submit(wallet(3), make_output("T_WIN"))
    c2.submit(wallet(4), make_output("T_WIN"))

    assert c1.evaluate().agreed_result == "CT_WIN"
    assert c2.evaluate().agreed_result == "T_WIN"


# ================================================================== #
#  DB-backed tests (Step 3 — session_factory)                        #
# ================================================================== #

# ── Helpers ──────────────────────────────────────────────────────── #

def _make_db_session(fetchall_return=None):
    """
    Returns (session_factory, session_mock).

    session_factory is a callable that returns a context-manager-compatible
    mock whose .execute().fetchall() returns fetchall_return.
    """
    session = MagicMock()
    session.execute.return_value.fetchall.return_value = fetchall_return or []
    session.execute.return_value.fetchone.return_value = None

    ctx = MagicMock()
    ctx.__enter__ = MagicMock(return_value=session)
    ctx.__exit__  = MagicMock(return_value=False)

    session_factory = MagicMock(return_value=ctx)
    return session_factory, session


def _db_row(wallet_str, result="CT_WIN", confidence=0.95, players=None,
            agents=None, score=None, submitted_at=None):
    """Build a tuple that matches the SELECT in _restore_from_db."""
    from datetime import datetime, timezone
    return (
        wallet_str,
        result,
        confidence,
        list(players or []),
        list(agents or []),
        score,
        submitted_at or datetime.now(timezone.utc),
    )


# ── _restore_from_db ─────────────────────────────────────────────── #

class TestRestoreFromDb:
    """MatchConsensus restores state from match_consensus on __init__."""

    def test_restore_empty_db_starts_fresh(self):
        """No rows in DB → consensus starts with 0 submissions."""
        sf, _ = _make_db_session(fetchall_return=[])
        c = MatchConsensus(match_id="m1", expected_players=2, session_factory=sf)
        assert c.received_count() == 0

    def test_restore_single_vote_from_db(self):
        """One persisted row → MatchConsensus has 1 submission after init."""
        row = _db_row(wallet(1), result="CT_WIN", confidence=0.9)
        sf, _ = _make_db_session(fetchall_return=[row])
        c = MatchConsensus(match_id="m1", expected_players=2, session_factory=sf)
        assert c.received_count() == 1

    def test_restore_two_votes_reaches_consensus(self):
        """Two restored rows for a 2-player match → is_complete() True."""
        rows = [
            _db_row(wallet(1), result="CT_WIN"),
            _db_row(wallet(2), result="CT_WIN"),
        ]
        sf, _ = _make_db_session(fetchall_return=rows)
        c = MatchConsensus(match_id="m1", expected_players=2, session_factory=sf)
        assert c.is_complete()
        verdict = c.evaluate()
        assert verdict.status == ConsensusStatus.REACHED
        assert verdict.agreed_result == "CT_WIN"

    def test_restore_skips_duplicate_wallet_in_db(self):
        """If DB somehow returns two rows for the same wallet, only one is kept."""
        rows = [
            _db_row(wallet(1), result="CT_WIN"),
            _db_row(wallet(1), result="T_WIN"),   # duplicate
        ]
        sf, _ = _make_db_session(fetchall_return=rows)
        c = MatchConsensus(match_id="m1", expected_players=2, session_factory=sf)
        assert c.received_count() == 1

    def test_restore_db_error_starts_fresh(self):
        """DB failure during restore → gracefully falls back to empty state."""
        sf = MagicMock(side_effect=Exception("DB down"))
        c = MatchConsensus(match_id="m1", expected_players=2, session_factory=sf)
        assert c.received_count() == 0


# ── _persist_submission ──────────────────────────────────────────── #

class TestPersistSubmission:
    """submit() calls _persist_submission() when session_factory is set."""

    def test_submit_triggers_db_insert(self):
        """submit() with session_factory executes an INSERT on the DB session."""
        sf, session = _make_db_session(fetchall_return=[])
        c = MatchConsensus(match_id="m1", expected_players=2, session_factory=sf)
        c.submit(wallet(1), make_output("CT_WIN"))
        # execute should have been called at least once for the INSERT
        assert session.execute.called

    def test_submit_commits_after_insert(self):
        """After a successful insert, session.commit() is called."""
        sf, session = _make_db_session(fetchall_return=[])
        c = MatchConsensus(match_id="m1", expected_players=2, session_factory=sf)
        c.submit(wallet(1), make_output("CT_WIN"))
        assert session.commit.called

    def test_duplicate_submit_not_persisted_again(self):
        """Second submit for same wallet is blocked in-memory; no second DB write."""
        sf, session = _make_db_session(fetchall_return=[])
        c = MatchConsensus(match_id="m1", expected_players=2, session_factory=sf)

        # First submit (restore call + persist call)
        c.submit(wallet(1), make_output("CT_WIN"))
        call_count_after_first = session.execute.call_count

        # Second submit (duplicate) — should not trigger another DB write
        c.submit(wallet(1), make_output("T_WIN"))
        assert session.execute.call_count == call_count_after_first

    def test_persist_db_error_does_not_break_consensus(self):
        """If the DB write fails, the in-memory submission is still recorded."""
        # session_factory returns a context whose execute raises on first call
        session = MagicMock()
        session.execute.side_effect = [
            MagicMock(fetchall=MagicMock(return_value=[])),  # restore SELECT
            Exception("DB write error"),                      # persist INSERT fails
        ]
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__  = MagicMock(return_value=False)
        sf = MagicMock(return_value=ctx)

        c = MatchConsensus(match_id="m1", expected_players=2, session_factory=sf)
        status = c.submit(wallet(1), make_output("CT_WIN"))

        # In-memory state is correct despite DB failure
        assert c.received_count() == 1
        # Status is still PENDING (only 1 of 2 players)
        assert status == ConsensusStatus.PENDING


# ── Full round-trip: submit + restore across "restart" ───────────── #

class TestDbRoundTrip:
    """Simulate an engine restart: submit → new MatchConsensus re-reads from DB."""

    def test_round_trip_single_vote(self):
        """
        Player 1 submits a vote (persisted to DB).
        Engine restarts: new MatchConsensus for same match restores that vote.
        Player 2 can then submit and trigger consensus.
        """
        # ── Engine instance 1: player 1 submits ──────────────────────────
        sf1, session1 = _make_db_session(fetchall_return=[])
        c1 = MatchConsensus(match_id="round_trip_m1", expected_players=2, session_factory=sf1)
        c1.submit(wallet(1), make_output("CT_WIN"))
        assert c1.received_count() == 1

        # ── Engine "restarts": instance 2 restores player 1's vote from DB ─
        restored_row = _db_row(wallet(1), result="CT_WIN", confidence=0.95)
        sf2, session2 = _make_db_session(fetchall_return=[restored_row])
        c2 = MatchConsensus(match_id="round_trip_m1", expected_players=2, session_factory=sf2)
        assert c2.received_count() == 1

        # Player 2 submits on the new instance
        c2.submit(wallet(2), make_output("CT_WIN"))
        assert c2.is_complete()
        verdict = c2.evaluate()
        assert verdict.status == ConsensusStatus.REACHED
        assert verdict.agreed_result == "CT_WIN"

    def test_no_session_factory_still_works(self):
        """
        Omitting session_factory → purely in-memory, no DB calls.
        All original tests continue to pass unchanged.
        """
        c = MatchConsensus(match_id="mem_only", expected_players=2)
        c.submit(wallet(1), make_output("T_WIN"))
        c.submit(wallet(2), make_output("T_WIN"))
        verdict = c.evaluate()
        assert verdict.status == ConsensusStatus.REACHED
        assert verdict.agreed_result == "T_WIN"


# ================================================================== #
#  Cross-team dual-validation (1v1, 2v2, 5v5 with team wallets)      #
# ================================================================== #

def _cross(match_id, team_a_size, team_b_size):
    """Return a MatchConsensus configured for cross-team mode."""
    a = [wallet(i)               for i in range(1, team_a_size + 1)]
    b = [wallet(i + team_a_size) for i in range(1, team_b_size + 1)]
    c = MatchConsensus(
        match_id=match_id,
        expected_players=team_a_size + team_b_size,
        team_a_wallets=a,
        team_b_wallets=b,
    )
    return c, a, b


def test_cross_1v1_team_a_wins():
    """1v1: Team A → victory, Team B → defeat → REACHED, winning_team=team_a."""
    c, a, b = _cross("1v1", 1, 1)
    c.submit(a[0], make_output("victory"))
    verdict_status = c.submit(b[0], make_output("defeat"))

    assert verdict_status == ConsensusStatus.REACHED
    verdict = c.evaluate()
    assert verdict.status == ConsensusStatus.REACHED
    assert verdict.winning_team == "team_a"
    assert verdict.is_cross_validated is True
    assert verdict.flagged_wallets == []


def test_cross_1v1_team_b_wins():
    """1v1: Team A → defeat, Team B → victory → REACHED, winning_team=team_b."""
    c, a, b = _cross("1v1_b", 1, 1)
    c.submit(a[0], make_output("defeat"))
    c.submit(b[0], make_output("victory"))
    verdict = c.evaluate()
    assert verdict.status == ConsensusStatus.REACHED
    assert verdict.winning_team == "team_b"
    assert verdict.is_cross_validated is True


def test_cross_2v2_team_a_wins():
    """2v2: both Team A say victory, both Team B say defeat → REACHED."""
    c, a, b = _cross("2v2", 2, 2)
    for w in a:
        c.submit(w, make_output("victory"))
    for w in b:
        c.submit(w, make_output("defeat"))
    verdict = c.evaluate()
    assert verdict.status == ConsensusStatus.REACHED
    assert verdict.winning_team == "team_a"
    assert verdict.is_cross_validated is True
    assert verdict.flagged_wallets == []


def test_cross_5v5_team_a_wins():
    """5v5: all ten players submit correctly → REACHED."""
    c, a, b = _cross("5v5", 5, 5)
    for w in a:
        c.submit(w, make_output("victory"))
    for w in b:
        c.submit(w, make_output("defeat"))
    verdict = c.evaluate()
    assert verdict.status == ConsensusStatus.REACHED
    assert verdict.winning_team == "team_a"
    assert verdict.is_cross_validated is True


def test_cross_5v5_with_one_disconnect_still_reaches():
    """5v5 where one Team B player never submits — 5/5 Team A + 4/5 Team B (80% > 50%)."""
    c, a, b = _cross("5v5_disc", 5, 5)
    for w in a:
        c.submit(w, make_output("victory"))
    for w in b[:4]:            # only 4 of 5 Team B players submit
        c.submit(w, make_output("defeat"))
    verdict = c.evaluate()
    assert verdict.status == ConsensusStatus.REACHED
    assert verdict.winning_team == "team_a"
    assert verdict.is_cross_validated is True


def test_cross_eager_fires_before_all_players_submitted():
    """
    In cross-team mode evaluate() fires as soon as each team's majority is clear,
    even before is_complete(). Test 2v2: after just 1 from each team, both majorities
    are 100% → REACHED without waiting for the 2nd player of each team.
    """
    c, a, b = _cross("2v2_eager", 2, 2)
    s1 = c.submit(a[0], make_output("victory"))   # Team A: 1/1 in so far
    s2 = c.submit(b[0], make_output("defeat"))    # Team B: 1/1 in so far
    # At this point a_victory=1/1>0.5, b_defeat=1/1>0.5 → REACHED eagerly
    assert s1 == ConsensusStatus.PENDING   # Team B hasn't submitted yet
    assert s2 == ConsensusStatus.REACHED   # Both teams' majorities confirmed


def test_cross_cheat_team_b_split_gives_pending():
    """
    2v2: Team B is split 1-defeat / 1-victory (one cheater).
    Cross-team: b_defeat = 1/2 = 50%, NOT > 50% → cannot confirm Team A wins.
    Result: PENDING (admin must resolve dispute manually).
    """
    c, a, b = _cross("2v2_cheat", 2, 2)
    for w in a:
        c.submit(w, make_output("victory"))
    c.submit(b[0], make_output("defeat"))    # honest loser
    c.submit(b[1], make_output("victory"))   # cheater
    verdict = c.evaluate()
    # Team B is evenly split — cross-team cannot resolve
    assert verdict.status == ConsensusStatus.PENDING


def test_cross_cheat_3v3_majority_still_flagged():
    """
    3v3: Team B has 2 honest losers + 1 cheater (2/3 = 67% say defeat > 50%).
    Cross-team resolves: Team A wins. The cheating Team B player is flagged.
    """
    c, a, b = _cross("3v3_cheat", 3, 3)
    for w in a:
        c.submit(w, make_output("victory"))
    c.submit(b[0], make_output("defeat"))    # honest loser
    c.submit(b[1], make_output("defeat"))    # honest loser
    c.submit(b[2], make_output("victory"))   # cheater
    verdict = c.evaluate()
    assert verdict.status == ConsensusStatus.REACHED
    assert verdict.winning_team == "team_a"
    assert verdict.is_cross_validated is True
    assert b[2] in verdict.flagged_wallets


def test_cross_both_claim_victory_stays_pending():
    """
    Both 1v1 players submit 'victory' (lying cheater scenario).
    Neither team majority is 'defeat' for the other side → PENDING / unresolvable.
    """
    c, a, b = _cross("1v1_both_win", 1, 1)
    c.submit(a[0], make_output("victory"))
    c.submit(b[0], make_output("victory"))
    verdict = c.evaluate()
    # Cross-team can't confirm a winner — neither condition is satisfied.
    assert verdict.status == ConsensusStatus.PENDING


def test_cross_team_b_only_never_submits_single_team_fallback():
    """If Team B never submits, Team A majority alone is enough (weak signal)."""
    c, a, b = _cross("fallback", 1, 1)
    c.submit(a[0], make_output("victory"))
    verdict = c.evaluate()
    # expected_per_team = 1, len(a_subs) = 1 >= 1, len(b_subs) = 0
    assert verdict.status == ConsensusStatus.REACHED
    assert verdict.winning_team == "team_a"
    assert verdict.is_cross_validated is False  # weak — only one team submitted


def test_cs2_both_claim_victory_majority_fallback():
    """Without team wallets: both claim victory → 100% majority → REACHED."""
    c = MatchConsensus(match_id="no_teams_both_win", expected_players=2)
    c.submit(wallet(1), make_output("victory"))
    c.submit(wallet(2), make_output("victory"))
    verdict = c.evaluate()
    assert verdict.status == ConsensusStatus.REACHED
    assert verdict.agreed_result == "victory"


def test_cs2_partial_without_teams_stays_pending():
    """Without team wallets: partial set stays PENDING until expected_players is met."""
    c = MatchConsensus(match_id="partial_no_teams", expected_players=4)
    c.submit(wallet(1), make_output("victory"))
    c.submit(wallet(2), make_output("defeat"))
    assert c._current_status() == ConsensusStatus.PENDING
