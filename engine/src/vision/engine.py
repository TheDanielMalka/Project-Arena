from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
from src.vision.matcher import detect_result, match_template
from src.vision.ocr import (extract_player_names, extract_score, extract_agents,
                             extract_agent_player_pairs)
from src.vision.score_detector import detect_live_score, detect_round_start


# ── Config ────────────────────────────────────────────────────────────────────

@dataclass
class VisionEngineConfig:
    """
    Configuration for a VisionEngine instance.

    Fields:
        confidence_threshold : minimum confidence to accept a result (0-1).
        cooldown_seconds     : minimum seconds between processed frames.
        game                 : "CS2" | "Valorant"  — controls which color
                               detector and OCR regions are used.
                               Default is "CS2" for backward compatibility.
    """
    confidence_threshold: float = 0.8
    cooldown_seconds: int = 3
    game: str = "CS2"          # "CS2" | "Valorant"


# ── Output ────────────────────────────────────────────────────────────────────

@dataclass
class VisionEngineOutput:
    """
    Result returned by VisionEngine.process_frame().

    Fields:
        result             : "victory" | "defeat" | None
        confidence         : detection confidence in [0, 1]
        players            : usernames extracted by OCR
        agents             : Valorant agent names; always [] for CS2
        score              : end-screen score string e.g. "13-11", or None
        template_matched   : whether a reference template matched (optional)
        template_confidence: confidence of the template match (optional)
        template_location  : (x, y) pixel location of the match (optional)
        accepted           : True when result is non-None AND confidence >=
                             VisionEngineConfig.confidence_threshold
        game               : which game produced this result ("CS2" | "Valorant")

        screen_type        : classification of what the screenshot shows:
                               "victory"  — end-screen with VICTORY banner
                               "defeat"   — end-screen with DEFEAT banner
                               "live"     — in-game HUD (score visible, no banner)
                               "unknown"  — neither end-screen nor readable HUD
        live_score         : dict {"ct": int, "t": int} when screen_type=="live",
                             None otherwise.
        is_round_start     : True when live_score is exactly {"ct":0,"t":0} — the
                             first detectable frame of a new match (all players in).
    """
    result: Optional[str]
    confidence: float
    players: list[str] = field(default_factory=list)
    agents: list[str] = field(default_factory=list)
    score: Optional[str] = None
    template_matched: Optional[bool] = None
    template_confidence: Optional[float] = None
    template_location: Optional[tuple[int, int]] = None
    accepted: bool = False
    game: str = "CS2"

    # Live-score fields (new)
    screen_type: str = "unknown"         # "victory"|"defeat"|"live"|"unknown"
    live_score: Optional[dict] = None    # {"ct": int, "t": int} | None
    is_round_start: bool = False


# ── Engine ────────────────────────────────────────────────────────────────────

class VisionEngine:
    """
    Processes a single screenshot frame and returns a VisionEngineOutput.

    Pipeline (per frame):
      1. detect_result()        — colour-based win/loss (game-routed)
         If result found → screen_type = "victory" or "defeat"
         If no result   → try live HUD score detector
      2. detect_live_score()    — CS2 HUD digit OCR (only when step 1 = None)
         If score found → screen_type = "live"
      3. extract_player_names() — OCR player usernames (end-screen only)
      4. extract_score()        — OCR end-screen score  (end-screen only)
      5. extract_agents()       — Valorant agent names  (Valorant end-screen only)
      6. match_template()       — optional anti-cheat template match

    Steps 3-5 are skipped for "live" frames to avoid wasting OCR time on
    gameplay screenshots that contain no scoreboard or player cards.
    """

    def __init__(self, config: Optional[VisionEngineConfig] = None):
        self.config = config or VisionEngineConfig()

    def process_frame(self, image_path: str,
                      template_path: Optional[str] = None) -> VisionEngineOutput:
        game = self.config.game

        # ── 1. End-screen colour detection ────────────────────────────────────
        result, confidence = detect_result(image_path, game=game)

        if result == "victory":
            screen_type = "victory"
        elif result == "defeat":
            screen_type = "defeat"
        elif result == "tie":
            screen_type = "tie"
        else:
            screen_type = "unknown"

        # ── 2. Live HUD score (only when no end-screen detected) ──────────────
        live_score: Optional[dict] = None
        is_round_start = False

        if result is None and game in ("CS2", "Valorant"):
            live_score = detect_live_score(image_path, game=game)
            if live_score is not None:
                screen_type    = "live"
                is_round_start = (live_score["ct"] == 0 and live_score["t"] == 0)

        # ── 3-5. OCR (end-screen only — skip for live gameplay frames) ────────
        players: list[str] = []
        agents:  list[str] = []
        score:   Optional[str] = None

        if screen_type in ("victory", "defeat", "tie"):
            invert_ocr: bool = game == "Valorant"
            players = extract_player_names(image_path, invert=invert_ocr, game=game) or []
            score   = extract_score(image_path, invert=invert_ocr, game=game)

            if game == "Valorant":
                pairs = extract_agent_player_pairs(image_path, invert=True,
                                                   game="Valorant", result=result)
                if pairs:
                    players = [p["player"] for p in pairs]
                    agents  = [p["agent"]  for p in pairs]
                else:
                    agents = extract_agents(image_path, invert=True) or []

        # ── 6. Optional template match (anti-cheat, game-agnostic) ────────────
        template_matched = None
        template_confidence = None
        template_location = None
        if template_path:
            template_matched, template_confidence, template_location = match_template(
                image_path,
                template_path,
                threshold=self.config.confidence_threshold,
            )

        accepted = bool(result) and bool(confidence >= self.config.confidence_threshold)

        return VisionEngineOutput(
            result=result,
            confidence=confidence,
            players=players,
            agents=agents,
            score=score,
            template_matched=template_matched,
            template_confidence=template_confidence,
            template_location=template_location,
            accepted=accepted,
            game=game,
            screen_type=screen_type,
            live_score=live_score,
            is_round_start=is_round_start,
        )
