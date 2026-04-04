"""
Tests for RageQuitDetector (Issue #56).

Covers:
  1. _team_alive()         — heartbeat threshold logic
  2. _check_match()        — rage-quit vs server-crash vs normal detection
  3. _forfeit()            — DB update + EscrowClient.declare_winner() call
  4. _tick()               — full scan loop, skip already-forfeited matches
  5. _get_active_matches() — DB unavailable graceful fallback
"""
from __future__ import annotations

import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch, call

import pytest

from src.vision.rage_quit import RageQuitDetector, RAGE_QUIT_THRESHOLD

# ── Helpers ───────────────────────────────────────────────────────────────────

NOW  = datetime(2026, 4, 5, 12, 0, 0, tzinfo=timezone.utc)
FRESH = NOW - timedelta(seconds=30)                         # well within threshold
STALE = NOW - timedelta(seconds=RAGE_QUIT_THRESHOLD + 60)  # exceeded threshold
MATCH_ID  = str(uuid.uuid4())
USER_A    = str(uuid.uuid4())
USER_B    = str(uuid.uuid4())

def _make_session_factory(rows_by_query: dict | None = None):
    """
    Returns a context-manager session factory whose execute().fetchall()
    returns different rows depending on the SQL query text.
    rows_by_query: { substring_of_sql: [rows] }
    """
    rows_by_query = rows_by_query or {}

    @contextmanager
    def factory():
        session = MagicMock()

        def execute_side_effect(query, params=None):
            sql = str(query)
            result = MagicMock()
            for key, rows in rows_by_query.items():
                if key in sql:
                    result.fetchall.return_value = rows
                    result.fetchone.return_value = rows[0] if rows else None
                    return result
            result.fetchall.return_value = []
            result.fetchone.return_value = None
            return result

        session.execute.side_effect = execute_side_effect
        yield session

    return factory


def _detector(rows_by_query=None, escrow_client=None):
    return RageQuitDetector(
        session_factory=_make_session_factory(rows_by_query),
        escrow_client=escrow_client,
    )


# ── 1. _team_alive ────────────────────────────────────────────────────────────

class TestTeamAlive:
    _threshold = NOW - timedelta(seconds=RAGE_QUIT_THRESHOLD)

    def test_fresh_heartbeat_is_alive(self):
        assert RageQuitDetector._team_alive([(USER_A, FRESH)], self._threshold) is True

    def test_stale_heartbeat_is_not_alive(self):
        assert RageQuitDetector._team_alive([(USER_A, STALE)], self._threshold) is False

    def test_none_heartbeat_is_not_alive(self):
        assert RageQuitDetector._team_alive([(USER_A, None)], self._threshold) is False

    def test_at_least_one_fresh_makes_team_alive(self):
        players = [(USER_A, STALE), (USER_B, FRESH)]
        assert RageQuitDetector._team_alive(players, self._threshold) is True

    def test_all_stale_team_is_dead(self):
        players = [(USER_A, STALE), (USER_B, STALE)]
        assert RageQuitDetector._team_alive(players, self._threshold) is False

    def test_naive_datetime_treated_as_utc(self):
        naive_fresh = NOW.replace(tzinfo=None) - timedelta(seconds=30)
        assert RageQuitDetector._team_alive([(USER_A, naive_fresh)], self._threshold) is True

    def test_empty_player_list_is_dead(self):
        assert RageQuitDetector._team_alive([], self._threshold) is False


# ── 2. _check_match ───────────────────────────────────────────────────────────

class TestCheckMatch:

    def _rows(self, a_hb, b_hb):
        """Build match_players + client_sessions rows for a 1v1."""
        return {
            "match_players": [
                (USER_A, "A", a_hb),
                (USER_B, "B", b_hb),
            ]
        }

    def test_team_b_silent_returns_team_a_winner(self):
        d = _detector(self._rows(FRESH, STALE))
        result = d._check_match(MATCH_ID, NOW)
        assert result is not None
        winner_id, losing_team = result
        assert winner_id == USER_A
        assert losing_team == "B"

    def test_team_a_silent_returns_team_b_winner(self):
        d = _detector(self._rows(STALE, FRESH))
        result = d._check_match(MATCH_ID, NOW)
        assert result is not None
        winner_id, losing_team = result
        assert winner_id == USER_B
        assert losing_team == "A"

    def test_both_alive_returns_none(self):
        d = _detector(self._rows(FRESH, FRESH))
        assert d._check_match(MATCH_ID, NOW) is None

    def test_both_silent_returns_none_server_crash(self):
        """Both teams offline → likely server crash, do NOT forfeit."""
        d = _detector(self._rows(STALE, STALE))
        assert d._check_match(MATCH_ID, NOW) is None

    def test_no_rows_returns_none(self):
        d = _detector({"match_players": []})
        assert d._check_match(MATCH_ID, NOW) is None

    def test_missing_team_b_returns_none(self):
        """Incomplete match data — only team A present."""
        rows = {"match_players": [(USER_A, "A", FRESH)]}
        d = _detector(rows)
        assert d._check_match(MATCH_ID, NOW) is None

    def test_db_error_returns_none(self):
        @contextmanager
        def broken_factory():
            session = MagicMock()
            session.execute.side_effect = Exception("DB down")
            yield session

        d = RageQuitDetector(broken_factory)
        assert d._check_match(MATCH_ID, NOW) is None


# ── 3. _forfeit ───────────────────────────────────────────────────────────────

class TestForfeit:

    def _make_factory(self):
        """Returns factory + session mock for capturing execute calls."""
        session_mock = MagicMock()

        @contextmanager
        def factory():
            yield session_mock

        return factory, session_mock

    def test_db_updated_on_forfeit(self):
        factory, session = self._make_factory()
        d = RageQuitDetector(factory)
        d._forfeit(MATCH_ID, USER_A, "B")
        session.execute.assert_called_once()
        sql = str(session.execute.call_args[0][0])
        assert "completed" in sql
        session.commit.assert_called_once()

    def test_declare_winner_called_when_escrow_available(self):
        factory, _ = self._make_factory()
        escrow = MagicMock()
        escrow.declare_winner.return_value = "0xdeadbeef"
        d = RageQuitDetector(factory, escrow_client=escrow)
        d._forfeit(MATCH_ID, USER_A, "B")
        escrow.declare_winner.assert_called_once_with(MATCH_ID, USER_A)

    def test_declare_winner_skipped_when_no_escrow(self):
        factory, _ = self._make_factory()
        d = RageQuitDetector(factory, escrow_client=None)
        # Should not raise
        d._forfeit(MATCH_ID, USER_A, "B")

    def test_declare_winner_skipped_if_db_fails(self):
        """If DB update fails, contract must NOT be called."""
        @contextmanager
        def broken_factory():
            session = MagicMock()
            session.execute.side_effect = Exception("DB down")
            yield session

        escrow = MagicMock()
        d = RageQuitDetector(broken_factory, escrow_client=escrow)
        d._forfeit(MATCH_ID, USER_A, "B")
        escrow.declare_winner.assert_not_called()

    def test_contract_error_does_not_raise(self):
        """Contract failure is logged but must not crash the detector."""
        factory, _ = self._make_factory()
        escrow = MagicMock()
        escrow.declare_winner.side_effect = Exception("tx failed")
        d = RageQuitDetector(factory, escrow_client=escrow)
        # Should not raise
        d._forfeit(MATCH_ID, USER_A, "B")


# ── 4. _tick ─────────────────────────────────────────────────────────────────

class TestTick:

    def test_tick_forfeits_rage_quit_match(self):
        rows = {
            "matches": [(MATCH_ID,)],
            "match_players": [
                (USER_A, "A", FRESH),
                (USER_B, "B", STALE),
            ],
        }
        escrow = MagicMock()
        escrow.declare_winner.return_value = "0xabc"
        d = _detector(rows, escrow_client=escrow)

        with patch.object(d, "_forfeit", wraps=d._forfeit) as mock_forfeit:
            d._tick(_now=NOW)   # inject frozen time so FRESH/STALE are evaluated correctly
            mock_forfeit.assert_called_once_with(MATCH_ID, USER_A, "B")

    def test_tick_skips_already_forfeited_match(self):
        rows = {
            "matches": [(MATCH_ID,)],
            "match_players": [
                (USER_A, "A", FRESH),
                (USER_B, "B", STALE),
            ],
        }
        d = _detector(rows)
        d._forfeited.add(MATCH_ID)

        with patch.object(d, "_forfeit") as mock_forfeit:
            d._tick(_now=NOW)
            mock_forfeit.assert_not_called()

    def test_tick_does_nothing_when_no_active_matches(self):
        d = _detector({"matches": []})
        with patch.object(d, "_forfeit") as mock_forfeit:
            d._tick(_now=NOW)
            mock_forfeit.assert_not_called()

    def test_tick_does_nothing_when_both_teams_alive(self):
        rows = {
            "matches": [(MATCH_ID,)],
            "match_players": [
                (USER_A, "A", FRESH),
                (USER_B, "B", FRESH),
            ],
        }
        d = _detector(rows)
        with patch.object(d, "_forfeit") as mock_forfeit:
            d._tick(_now=NOW)
            mock_forfeit.assert_not_called()


# ── 5. _get_active_matches ────────────────────────────────────────────────────

class TestGetActiveMatches:

    def test_returns_match_ids(self):
        rows = {"matches": [(MATCH_ID,)]}
        d = _detector(rows)
        result = d._get_active_matches()
        assert result == [MATCH_ID]

    def test_returns_empty_list_on_db_error(self):
        @contextmanager
        def broken_factory():
            session = MagicMock()
            session.execute.side_effect = Exception("DB down")
            yield session

        d = RageQuitDetector(broken_factory)
        assert d._get_active_matches() == []

    def test_returns_empty_when_no_active_matches(self):
        d = _detector({"matches": []})
        assert d._get_active_matches() == []
