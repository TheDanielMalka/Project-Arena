from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
from src.vision.matcher import detect_result, match_template
from src.vision.ocr import (extract_player_names, extract_score, extract_agents,
                             extract_agent_player_pairs)


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

    TODO: pull game from DB match record once the match API is wired up,
          so the engine always knows which game it is validating.
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
                             (CS2: Steam display names from scoreboard row;
                              Valorant: player usernames from end-screen cards)
        agents             : Valorant agent names (JETT, SAGE, …);
                             always [] for CS2 matches
        score              : score string e.g. "13-11", or None
        template_matched   : whether a reference template matched (optional)
        template_confidence: confidence of the template match (optional)
        template_location  : (x, y) pixel location of the match (optional)
        accepted           : True when result is non-None AND confidence >=
                             VisionEngineConfig.confidence_threshold
        game               : which game produced this result ("CS2" | "Valorant")

    TODO: once DB is wired, persist VisionEngineOutput as a match_evidence
          row so every submission is auditable.
    """
    result: Optional[str]
    confidence: float
    players: list[str] = field(default_factory=list)
    agents: list[str] = field(default_factory=list)    # Valorant only; [] for CS2
    score: Optional[str] = None
    template_matched: Optional[bool] = None
    template_confidence: Optional[float] = None
    template_location: Optional[tuple[int, int]] = None
    accepted: bool = False
    game: str = "CS2"


# ── Engine ────────────────────────────────────────────────────────────────────

class VisionEngine:
    """
    Processes a single screenshot frame and returns a VisionEngineOutput.

    The engine is game-aware: it reads self.config.game and routes every
    detection call (colour, OCR, template) to the correct game-specific
    implementation.

    Usage:
        engine = VisionEngine(config=VisionEngineConfig(game="Valorant"))
        output = engine.process_frame("/path/to/screenshot.png")
    """

    def __init__(self, config: Optional[VisionEngineConfig] = None):
        self.config = config or VisionEngineConfig()

    def process_frame(self, image_path: str,
                      template_path: Optional[str] = None) -> VisionEngineOutput:
        """
        Run the full detection pipeline on a single screenshot.

        Pipeline:
          1. detect_result()        — colour-based win/loss (game-routed)
          2. extract_player_names() — OCR player usernames  (game-routed)
          3. extract_score()        — OCR round score       (game-routed)
          4. extract_agents()       — OCR agent names       (Valorant only)
          5. match_template()       — optional template match (game-agnostic)
        """
        game = self.config.game

        # 1. Colour-based win/loss detection
        result, confidence = detect_result(image_path, game=game)

        # 2. Player usernames
        # CS2 scoreboard: light text on semi-transparent dark bg → invert=False
        # Valorant end-screen: white text on dark card bg → invert=True so
        # Tesseract receives black-on-white (its preferred input format)
        invert_ocr: bool = game == "Valorant"
        players = extract_player_names(image_path, invert=invert_ocr, game=game) or []

        # 3. Round score
        score = extract_score(image_path, invert=invert_ocr, game=game)

        # 4. Agent names — Valorant only (always white text → invert=True).
        #    Per-slot extraction guarantees players[i] ↔ agents[i] alignment:
        #    each of the 5 card columns is OCR'd independently so a missed
        #    word in one card never shifts the index of subsequent cards.
        agents: list[str] = []
        if game == "Valorant":
            pairs = extract_agent_player_pairs(image_path, invert=True,
                                               game="Valorant", result=result)
            if pairs:
                # Re-derive index-aligned lists from the paired result so
                # VisionEngineOutput.players[i] always matches .agents[i].
                players = [p["player"] for p in pairs]
                agents  = [p["agent"]  for p in pairs]
            else:
                # Fallback: use the full-row extractor if per-slot fails
                agents = extract_agents(image_path, invert=True) or []

        # 5. Optional template matching (anti-cheat layer; game-agnostic)
        template_matched = None
        template_confidence = None
        template_location = None
        if template_path:
            template_matched, template_confidence, template_location = match_template(
                image_path,
                template_path,
                threshold=self.config.confidence_threshold,
            )

        # Explicit bool() cast ensures a Python bool, not numpy.bool_,
        # so callers can safely use `output.accepted is True`.
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
        )
