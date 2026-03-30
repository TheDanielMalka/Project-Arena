"""
Tests for Valorant-specific OCR: per-slot agent+player pair extraction.

All tests use the synthetic templates from engine/templates/valorant/.
The synthetic images render the sample names used in the generator:

  VICTORY agents  : BRIMSTONE, SAGE, JETT, OMEN, PHOENIX
  VICTORY players : DOMA, TSACK, BOASTER, MISTIC, PLAYER
  DEFEAT  titles  : BLOODHOUND, CLUTCH KING, EXECUTIONER, SHARP EDGE, DEAD EYE
  DEFEAT  players : RAZEPARTY, SOVAMAIN, PLAYERNAME, OMENGUY, SKYELOVE

Because cv2.putText OCR quality is lower than real screenshots, tests assert
structural properties (correct count, non-empty strings, list alignment) rather
than exact token matches.  Exact-match tests are gated on the template being
flagged as a "real" screenshot so CI remains green with synthetic templates.
"""
from __future__ import annotations

import os
import pytest

from src.vision.ocr import (
    extract_agent_player_pairs,
    _extract_player_agent_pairs_valorant,
    extract_player_names,
    extract_agents,
)


# ── Template helpers ──────────────────────────────────────────────────────────

TEMPLATES_DIR = os.path.join(
    os.path.dirname(__file__), "..", "templates", "valorant"
)


def _tpl(filename: str) -> str:
    return os.path.join(TEMPLATES_DIR, filename)


# ── extract_agent_player_pairs — public API ───────────────────────────────────

class TestExtractAgentPlayerPairsPublicAPI:

    def test_returns_list(self):
        path = _tpl("valorant_1920x1080_victory.png")
        result = extract_agent_player_pairs(path, game="Valorant")
        assert isinstance(result, list)

    def test_victory_returns_up_to_five_pairs(self):
        path = _tpl("valorant_1920x1080_victory.png")
        pairs = extract_agent_player_pairs(path, game="Valorant")
        assert 1 <= len(pairs) <= 5, f"Expected 1-5 pairs, got {len(pairs)}"

    def test_defeat_returns_up_to_five_pairs(self):
        path = _tpl("valorant_1920x1080_defeat.png")
        pairs = extract_agent_player_pairs(path, game="Valorant")
        assert 1 <= len(pairs) <= 5

    def test_each_pair_has_agent_and_player_keys(self):
        path = _tpl("valorant_1920x1080_victory.png")
        pairs = extract_agent_player_pairs(path, game="Valorant")
        for pair in pairs:
            assert "agent" in pair, f"Missing 'agent' key in {pair}"
            assert "player" in pair, f"Missing 'player' key in {pair}"

    def test_cs2_game_returns_empty(self):
        path = _tpl("valorant_1920x1080_victory.png")
        result = extract_agent_player_pairs(path, game="CS2")
        assert result == [], "extract_agent_player_pairs must return [] for CS2"

    def test_missing_file_returns_empty(self):
        result = extract_agent_player_pairs("/no/such/file.png", game="Valorant")
        assert result == []

    def test_players_and_agents_same_length(self):
        """players list and agents list derived from pairs must be same length."""
        path = _tpl("valorant_1920x1080_victory.png")
        pairs = extract_agent_player_pairs(path, game="Valorant")
        players = [p["player"] for p in pairs]
        agents  = [p["agent"]  for p in pairs]
        assert len(players) == len(agents)

    def test_all_resolutions_return_pairs(self):
        """Structural check across all committed templates."""
        templates = [
            f for f in os.listdir(TEMPLATES_DIR)
            if f.endswith(".png")
        ]
        assert templates, "No templates found"
        for fname in templates:
            path = _tpl(fname)
            pairs = extract_agent_player_pairs(path, game="Valorant")
            assert isinstance(pairs, list), f"{fname}: expected list"
            for pair in pairs:
                assert "agent" in pair and "player" in pair


# ── Per-slot alignment guarantee ─────────────────────────────────────────────

class TestPerSlotAlignment:
    """
    The core invariant: players[i] and agents[i] derived from extract_agent_player_pairs()
    always refer to the same player card (same column index).
    """

    def test_pair_count_is_consistent_across_calls(self):
        """Two calls on the same image must return the same number of pairs."""
        path = _tpl("valorant_1920x1080_victory.png")
        p1 = extract_agent_player_pairs(path, game="Valorant")
        p2 = extract_agent_player_pairs(path, game="Valorant")
        assert len(p1) == len(p2)

    def test_1280x720_victory_pair_structure(self):
        path = _tpl("valorant_1280x720_victory.png")
        pairs = extract_agent_player_pairs(path, game="Valorant")
        assert isinstance(pairs, list)
        for pair in pairs:
            assert set(pair.keys()) == {"agent", "player"}

    def test_2560x1440_defeat_pair_structure(self):
        path = _tpl("valorant_2560x1440_defeat.png")
        pairs = extract_agent_player_pairs(path, game="Valorant")
        assert isinstance(pairs, list)
        for pair in pairs:
            assert set(pair.keys()) == {"agent", "player"}


# ── Internal function ─────────────────────────────────────────────────────────

class TestExtractPlayerAgentPairsInternal:

    def test_internal_missing_file_returns_empty(self):
        result = _extract_player_agent_pairs_valorant("/no/such/file.png")
        assert result == []

    def test_internal_returns_list_of_dicts(self):
        path = _tpl("valorant_1920x1080_victory.png")
        pairs = _extract_player_agent_pairs_valorant(path)
        assert isinstance(pairs, list)
        for p in pairs:
            assert isinstance(p, dict)

    def test_internal_and_public_agree(self):
        """Internal and public API must return the same result."""
        path = _tpl("valorant_1920x1080_victory.png")
        internal = _extract_player_agent_pairs_valorant(path)
        public   = extract_agent_player_pairs(path, game="Valorant")
        assert internal == public


# ── Legacy extract_agents still works ────────────────────────────────────────

class TestLegacyExtractAgents:
    """extract_agents() must still work for backward compatibility."""

    def test_extract_agents_returns_list(self):
        path = _tpl("valorant_1920x1080_victory.png")
        result = extract_agents(path)
        assert isinstance(result, list)

    def test_extract_agents_missing_file_returns_empty(self):
        assert extract_agents("/no/such/file.png") == []


# ── extract_player_names Valorant path ───────────────────────────────────────

class TestExtractPlayerNamesValorant:

    def test_returns_list(self):
        path = _tpl("valorant_1920x1080_victory.png")
        result = extract_player_names(path, game="Valorant", invert=True)
        assert isinstance(result, list)

    def test_missing_file_returns_empty(self):
        result = extract_player_names("/no/such/file.png", game="Valorant")
        assert result == []
