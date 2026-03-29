import os
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Depends, Header, UploadFile, File
from pydantic import BaseModel
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from src.config import DATABASE_URL, ENVIRONMENT
from src.vision.capture import capture_screen, crop_roi
from src.vision.engine import VisionEngine, VisionEngineConfig

# ── Config ────────────────────────────────────────────────────────────────────
DB_URL = DATABASE_URL or "postgresql://arena_admin:arena_secret_change_me@arena-db:5432/arena"
API_SECRET = os.getenv("API_SECRET", "change_me_in_production")
SCREENSHOT_DIR = os.getenv("SCREENSHOT_DIR", "/app/screenshots")
EVIDENCE_DIR = os.getenv("EVIDENCE_DIR", "/app/evidence")

os.makedirs(SCREENSHOT_DIR, exist_ok=True)
os.makedirs(EVIDENCE_DIR, exist_ok=True)

logger = logging.getLogger("arena.engine")

db_engine = create_engine(DB_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=db_engine)


@asynccontextmanager
async def lifespan(app: FastAPI):
    with db_engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    logger.info("✅ Arena Engine connected to DB")
    yield


app = FastAPI(
    title="Arena Engine",
    version="2.0.0",
    description="OCR + Vision match validator for Arena platform",
    lifespan=lifespan,
)


# ── Auth dependency ───────────────────────────────────────────────────────────
async def verify_token(authorization: str = Header(...)):
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Invalid token format")
    token = authorization.removeprefix("Bearer ")
    # TODO: validate JWT from your auth system
    return token


# ── Request / Response models ─────────────────────────────────────────────────

class MatchResult(BaseModel):
    """
    Validated match result submitted by the desktop client after the local
    StateMachine reaches CONFIRMED.

    TODO:
    - validate match_id against DB before accepting
    - cross-reference players_detected with registered match participants
    - trigger escrow release once winner_id is confirmed
    """
    match_id: str
    winner_id: str
    game: str = "CS2"                    # "CS2" | "Valorant"
    screenshot_path: str | None = None
    ocr_confidence: float = 0.0
    players_detected: list[str] = []
    agents_detected: list[str] = []      # Valorant agent names; [] for CS2
    score: str | None = None


class HealthResponse(BaseModel):
    status: str
    db: str
    environment: str


class ValidationResponse(BaseModel):
    """
    Response returned by POST /validate/screenshot.

    TODO:
    - persist this as a match_evidence row in DB once schema is ready
    - add match_id foreign key once matches table exists
    """
    match_id: str
    game: str                            # "CS2" | "Valorant"
    result: str | None
    confidence: float
    players: list[str]
    agents: list[str] = []              # Valorant agent names; [] for CS2
    score: str | None
    evidence_path: str | None


class CaptureResponse(BaseModel):
    filepath: str
    message: str


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse)
async def health():
    try:
        with db_engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"status": "ok", "db": "connected", "environment": ENVIRONMENT or "development"}
    except Exception:
        return {"status": "ok", "db": "disconnected", "environment": ENVIRONMENT or "development"}


@app.post("/capture", response_model=CaptureResponse)
async def take_capture(monitor: int = 1, token: str = Depends(verify_token)):
    """Take a screenshot from the desktop client."""
    filepath = capture_screen(output_dir=SCREENSHOT_DIR, monitor_num=monitor)
    if not filepath:
        raise HTTPException(500, "Failed to capture screen")
    return {"filepath": filepath, "message": "Screenshot captured"}


@app.post("/capture/crop", response_model=CaptureResponse)
async def crop_capture(
    image_path: str, x: int, y: int, w: int, h: int,
    token: str = Depends(verify_token)
):
    """Crop a region of interest from a screenshot."""
    filepath = crop_roi(image_path, x, y, w, h, output_dir=SCREENSHOT_DIR)
    if not filepath:
        raise HTTPException(404, "Image not found or crop failed")
    return {"filepath": filepath, "message": "ROI cropped"}


@app.post("/validate/screenshot", response_model=ValidationResponse)
async def validate_screenshot(
    match_id: str,
    game: str = "CS2",
    file: UploadFile = File(...),
    token: str = Depends(verify_token),
):
    """
    Upload a screenshot → run the full vision pipeline → return match result.

    The `game` query parameter ("CS2" | "Valorant") determines which colour
    detector and OCR regions are used.  All routing goes through VisionEngine
    so this endpoint always stays in sync with the watcher pipeline.

    Pipeline: save → VisionEngine.process_frame() → save evidence → respond

    TODO:
    - validate `game` against ACTIVE_GAMES from DB config
    - validate `match_id` exists in DB before processing
    - store ValidationResponse as match_evidence row in DB
    - enforce per-match submission limits (1 submission per wallet per match)
    """
    import shutil
    from datetime import datetime

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    save_path = os.path.join(SCREENSHOT_DIR, f"match_{match_id}_{timestamp}.png")

    with open(save_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    # Route through game-aware VisionEngine — single source of truth for
    # all detection logic (colour + OCR + agents), identical to the watcher.
    vision = VisionEngine(config=VisionEngineConfig(game=game))
    output = vision.process_frame(save_path)

    # Evidence is already saved inside detect_result() via save_evidence().
    # Store the path here for the API response so the caller can reference it.
    evidence_path = None
    if output.result:
        from src.vision.matcher import save_evidence
        evidence_path = save_evidence(save_path, output.result, output.confidence)

    return ValidationResponse(
        match_id=match_id,
        game=game,
        result=output.result,
        confidence=output.confidence,
        players=output.players,
        agents=output.agents,
        score=output.score,
        evidence_path=evidence_path,
    )


@app.post("/match/result")
async def submit_result(result: MatchResult, token: str = Depends(verify_token)):
    """
    Receives a validated match result from the desktop client after local
    consensus is reached.

    TODO:
    - validate match_id against DB
    - verify winner_id is a registered participant
    - cross-reference players_detected / agents_detected with DB records
    - update match status to "completed" in DB
    - trigger ArenaEscrow release to winner_id
    """
    return {
        "accepted": True,
        "match_id": result.match_id,
        "message": "Result queued for validation",
    }


@app.get("/match/{match_id}/status")
async def match_status(match_id: str):
    """
    Check match validation status from DB.

    TODO: return full match record once schema is finalised.
    """
    try:
        with SessionLocal() as session:
            row = session.execute(
                text("SELECT status FROM matches WHERE id = :mid"),
                {"mid": match_id},
            ).fetchone()
            if row:
                return {"match_id": match_id, "status": row[0]}
    except Exception:
        pass
    return {"match_id": match_id, "status": "pending"}
