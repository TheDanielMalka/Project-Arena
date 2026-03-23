"""
Tests for engine/src/vision/consensus.py
"""
import pytest
from src.vision.consensus import MatchConsensus, ConsensusStatus, CONSENSUS_THRESHOLD
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
    """7 agree, 3 disagree → threshold 60% met."""
    c = MatchConsensus(match_id="m1", expected_players=10)
    for i in range(7):
        c.submit(wallet(i), make_output("CT_WIN"))
    for i in range(7, 10):
        c.submit(wallet(i), make_output("T_WIN"))
    verdict = c.evaluate()
    assert verdict.status == ConsensusStatus.REACHED
    assert verdict.agreed_result == "CT_WIN"
    assert verdict.agreeing_players == 7


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
    """Exactly 60% agree (6/10) → REACHED."""
    c = MatchConsensus(match_id="m1", expected_players=10)
    for i in range(6):
        c.submit(wallet(i), make_output("CT_WIN"))
    for i in range(6, 10):
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
