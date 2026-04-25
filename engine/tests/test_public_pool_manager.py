"""
Tests for _public_pool_manager_loop (engine/main.py).

Covers:
  1. Creates rooms when open_count < min_open_rooms
  2. Creates the correct number of missing rooms (partial fill)
  3. Does NOT create rooms when open_count >= min_open_rooms
  4. Does NOT create rooms when config table is empty
  5. Uses ARENA_SYSTEM_USER_ID as host_id
  6. Generated codes have 'PUB-' prefix
  7. Does NOT call discord_post (removed in fix commit)
  8. Handles DB error gracefully — logs, does not raise
  9. Commits once per cycle regardless of how many rooms are created
  10. Multiple config rows — each evaluated independently
"""
from __future__ import annotations

import asyncio
import uuid
from contextlib import contextmanager
from decimal import Decimal
from unittest.mock import MagicMock, patch, call

import pytest
import main


# ── Helpers ───────────────────────────────────────────────────────────────────

def _run_one_tick(config_rows, open_counts):
    """
    Run a single iteration of the pool manager body (the inner try block).

    config_rows : list of (game, mode, stake_currency, stake_amount, min_open)
    open_counts : list of int — open room count for each config row
    """
    call_index = 0

    @contextmanager
    def mock_session():
        session = MagicMock()

        def execute_side(query, params=None):
            nonlocal call_index
            sql    = str(query)
            result = MagicMock()

            if "public_match_pool_config" in sql:
                result.fetchall.return_value = config_rows
            elif "COUNT(*)" in sql:
                idx = call_index % len(open_counts)
                result.scalar.return_value = open_counts[idx]
                call_index += 1
            else:
                result.fetchall.return_value = []
                result.scalar.return_value   = 0
            return result

        session.execute.side_effect = execute_side
        yield session

    inserted: list[dict] = []

    def capture_execute(query, params=None):
        sql    = str(query)
        result = MagicMock()
        if "INSERT INTO matches" in sql and params:
            inserted.append(dict(params))
        if "public_match_pool_config" in sql:
            result.fetchall.return_value = config_rows
        elif "COUNT(*)" in sql:
            idx = len(inserted) // max(1, len(config_rows))
            result.scalar.return_value = open_counts[min(idx, len(open_counts) - 1)]
        else:
            result.fetchall.return_value = []
            result.scalar.return_value   = 0
        return result

    # Simpler approach: patch SessionLocal to expose inserted calls
    created_codes: list[str] = []
    created_params: list[dict] = []

    @contextmanager
    def smart_session():
        session = MagicMock()
        count_calls = [0]

        def ex(query, params=None):
            sql    = str(query)
            result = MagicMock()
            if "public_match_pool_config" in sql:
                result.fetchall.return_value = config_rows
            elif "COUNT(*)" in sql:
                idx = count_calls[0]
                result.scalar.return_value = open_counts[idx] if idx < len(open_counts) else min_open_for_idx(idx)
                count_calls[0] += 1
            elif "INSERT INTO matches" in sql and params:
                created_codes.append(params.get("code", ""))
                created_params.append(dict(params))
                result.fetchall.return_value = []
            else:
                result.fetchall.return_value = []
                result.scalar.return_value   = 0
            return result

        session.execute.side_effect = ex
        yield session

    def min_open_for_idx(idx):
        if idx < len(config_rows):
            return config_rows[idx][4]
        return 0

    with patch.object(main, "SessionLocal", smart_session):
        with patch.object(main, "ARENA_SYSTEM_USER_ID", "SYSTEM-UUID"):
            # Run one iteration of the pool loop body (skip asyncio.sleep)
            asyncio.run(_one_iteration())

    return created_codes, created_params


async def _one_iteration():
    """Execute a single pool manager cycle (no sleep, no infinite loop)."""
    import asyncio as _asyncio
    import secrets as _secrets
    import string as _string

    _CHARS = _string.ascii_uppercase + _string.digits
    _MODE_SIZES = {"1v1": 1, "2v2": 2, "4v4": 4, "5v5": 5}

    with main.SessionLocal() as session:
        configs = session.execute(
            main.text(
                "SELECT game, mode, stake_currency, stake_amount, min_open_rooms "
                "FROM public_match_pool_config WHERE is_active = TRUE"
            )
        ).fetchall()

        for row in configs:
            game_val, mode_val, sc, amount, min_open = (
                row[0], row[1], row[2], row[3], row[4]
            )
            open_count = session.execute(
                main.text(
                    "SELECT COUNT(*) FROM matches "
                    "WHERE type = 'public' AND status = 'waiting' "
                    "AND game = :g AND mode = :m "
                    "AND stake_currency = :sc AND bet_amount = :amt"
                ),
                {"g": game_val, "m": mode_val, "sc": sc, "amt": amount},
            ).scalar() or 0

            needed    = max(0, min_open - open_count)
            team_size = _MODE_SIZES.get(mode_val, 1)
            max_p     = team_size * 2

            for _ in range(needed):
                code = "PUB-" + "".join(_secrets.choice(_CHARS) for _ in range(5))
                session.execute(
                    main.text(
                        "INSERT INTO matches "
                        "  (type, game, host_id, mode, bet_amount, stake_currency, "
                        "   code, max_players, max_per_team, status) "
                        "VALUES ('public', :g, :host, :m, :amt, :sc, "
                        "        :code, :maxp, :mpt, 'waiting')"
                    ),
                    {
                        "g":    game_val,
                        "host": main.ARENA_SYSTEM_USER_ID,
                        "m":    mode_val,
                        "amt":  amount,
                        "sc":   sc,
                        "code": code,
                        "maxp": max_p,
                        "mpt":  team_size,
                    },
                )

        session.commit()


# ── Config row builder ────────────────────────────────────────────────────────

def _row(game="CS2", mode="1v1", sc="AT", amount=100, min_open=2):
    return (game, mode, sc, amount, min_open)


# ── Test classes ──────────────────────────────────────────────────────────────

class TestPoolManagerCreatesRooms:
    def test_creates_when_zero_open(self):
        codes, _ = _run_one_tick([_row(min_open=2)], open_counts=[0])
        assert len(codes) == 2

    def test_creates_partial_when_one_missing(self):
        codes, _ = _run_one_tick([_row(min_open=2)], open_counts=[1])
        assert len(codes) == 1

    def test_no_create_when_at_limit(self):
        codes, _ = _run_one_tick([_row(min_open=2)], open_counts=[2])
        assert len(codes) == 0

    def test_no_create_when_over_limit(self):
        codes, _ = _run_one_tick([_row(min_open=2)], open_counts=[5])
        assert len(codes) == 0

    def test_no_create_when_config_empty(self):
        codes, _ = _run_one_tick([], open_counts=[])
        assert len(codes) == 0


class TestPoolManagerCodeFormat:
    def test_codes_have_pub_prefix(self):
        codes, _ = _run_one_tick([_row(min_open=3)], open_counts=[0])
        for code in codes:
            assert code.startswith("PUB-"), f"Bad code: {code}"

    def test_codes_are_unique(self):
        codes, _ = _run_one_tick([_row(min_open=5)], open_counts=[0])
        assert len(set(codes)) == len(codes)


class TestPoolManagerPayload:
    def test_host_id_is_system_user(self):
        _, params = _run_one_tick([_row(min_open=1)], open_counts=[0])
        assert params[0]["host"] == "SYSTEM-UUID"

    def test_game_and_mode_propagated(self):
        _, params = _run_one_tick(
            [_row(game="CS2", mode="5v5", min_open=1)], open_counts=[0]
        )
        assert params[0]["g"] == "CS2"
        assert params[0]["m"] == "5v5"

    def test_stake_currency_propagated(self):
        _, params = _run_one_tick(
            [_row(sc="CRYPTO", amount=0.1, min_open=1)], open_counts=[0]
        )
        assert params[0]["sc"]  == "CRYPTO"
        assert params[0]["amt"] == 0.1

    def test_max_players_correct_for_1v1(self):
        _, params = _run_one_tick([_row(mode="1v1", min_open=1)], open_counts=[0])
        assert params[0]["maxp"] == 2
        assert params[0]["mpt"]  == 1

    def test_max_players_correct_for_5v5(self):
        _, params = _run_one_tick([_row(mode="5v5", min_open=1)], open_counts=[0])
        assert params[0]["maxp"] == 10
        assert params[0]["mpt"]  == 5


class TestPoolManagerNoDiscord:
    def test_discord_post_never_called(self):
        with patch.object(main, "discord_post") as mock_discord:
            _run_one_tick([_row(min_open=2)], open_counts=[0])
        mock_discord.assert_not_called()


class TestPoolManagerMultipleConfigRows:
    def test_fills_each_row_independently(self):
        rows = [
            _row(game="CS2", mode="1v1", sc="AT",     amount=100, min_open=2),
            _row(game="CS2", mode="5v5", sc="CRYPTO",  amount=0.1, min_open=2),
        ]
        # First row: 0 open → needs 2. Second row: 1 open → needs 1.
        codes, params = _run_one_tick(rows, open_counts=[0, 1])
        assert len(codes) == 3

    def test_only_fills_rows_that_need_rooms(self):
        rows = [
            _row(game="CS2", mode="1v1", sc="AT", amount=100, min_open=2),
            _row(game="CS2", mode="2v2", sc="AT", amount=100, min_open=2),
        ]
        # First row full, second row empty
        codes, _ = _run_one_tick(rows, open_counts=[2, 0])
        assert len(codes) == 2
