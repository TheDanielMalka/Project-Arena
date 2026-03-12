from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
from src.vision.matcher import detect_result, match_template
from src.vision.ocr import extract_player_names, extract_score

@dataclass
class VisionEngineConfig:

    confidence_threshold: float = 0.8
    cooldown_seconds: int = 3

@dataclass
class VisionEngineOutput:

    result: Optional[str]
    confidence: float
    players: list[str] = field(default_factory=list)
    score: Optional[str] = None
    template_matched: Optional[bool] = None
    template_confidence: Optional[float] = None
    template_location: Optional[tuple[int, int]] = None
    accepted: bool = False


class VisionEngine:

    def __init__(self, config: Optional[VisionEngineConfig] = None):
        self.config = config or VisionEngineConfig()

    def process_frame(self, image_path: str, template_path: Optional[str] = None) -> VisionEngineOutput:

        result, confidence = detect_result(image_path)
        players = extract_player_names(image_path) or []
        score = extract_score(image_path)

        template_matched = None
        template_confidence = None
        template_location = None
        if template_path:
            template_matched, template_confidence, template_location = match_template(
                image_path,
                template_path,
                threshold=self.config.confidence_threshold,
            )

        accepted = bool(result) and confidence >= self.config.confidence_threshold

        return VisionEngineOutput(
            result=result,
            confidence=confidence,
            players=players,
            score=score,
            template_matched=template_matched,
            template_confidence=template_confidence,
            template_location=template_location,
            accepted=accepted,
        )
