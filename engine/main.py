import os
import logging
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Depends, Header, Query, UploadFile, File
from pydantic import BaseModel
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

import jwt as _jwt

from src.config import DATABASE_URL, ENVIRONMENT, MIN_CLIENT_VERSION
from src.vision.capture import capture_screen, crop_roi
from src.vision.engine import VisionEngine, VisionEngineConfig
import src.auth as auth

# ── Config ────────────────────────────────────────────────────────────────────
DB_URL = DATABASE_URL or "postgresql://arena_admin:arena_secret_change_me@arena-db:5432/arena"
API_SECRET = os.getenv("API_SECRET", "change_me_in_production")
SCREENSHOT_DIR = os.getenv("SCREENSHOT_DIR", "/app/screenshots")
EVIDENCE_DIR = os.getenv("EVIDENCE_DIR", "/app/evidence")

logger = logging.getLogger("arena.engine")

db_engine = create_engine(DB_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=db_engine)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create runtime directories at startup, not at import time.
    # Gracefully skipped in CI / restricted environments (tests still run).
    for d in (SCREENSHOT_DIR, EVIDENCE_DIR):
        try:
            os.makedirs(d, exist_ok=True)
        except PermissionError:
            logger.warning("⚠️  Cannot create dir %s (restricted env — skipping)", d)

    # DB connectivity check + schema migrations — non-fatal so tests still run.
    try:
        with db_engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            # Ensure match_evidence table exists (idempotent migration).
            # DB-ready: stores VisionEngine output per screenshot submission.
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS match_evidence (
                    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    match_id        UUID NOT NULL REFERENCES matches(id),
                    submitted_by    UUID REFERENCES users(id),
                    result          VARCHAR(20),
                    confidence      NUMERIC(5,4),
                    accepted        BOOLEAN NOT NULL DEFAULT FALSE,
                    players         TEXT[],
                    agents          TEXT[],
                    score           VARCHAR(20),
                    evidence_path   TEXT,
                    game            VARCHAR(20),
                    created_at      TIMESTAMPTZ DEFAULT NOW()
                )
            """))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_match_evidence_match "
                "ON match_evidence (match_id)"
            ))
            conn.commit()
        logger.info("✅ Arena Engine connected to DB")
    except Exception as exc:
        logger.warning("⚠️  DB not available at startup: %s", exc)
    yield


app = FastAPI(
    title="Arena Engine",
    version="2.0.0",
    description="OCR + Vision match validator for Arena platform",
    lifespan=lifespan,
)


# ── Auth dependency ───────────────────────────────────────────────────────────
async def verify_token(authorization: str = Header(...)) -> dict:
    """Decode and validate a JWT Bearer token. Returns the decoded payload."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Invalid token format")
    token = authorization.removeprefix("Bearer ")
    try:
        return auth.decode_token(token)
    except _jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except _jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")


# ── Auth models ───────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str


class LoginRequest(BaseModel):
    identifier: str   # email OR username
    password: str


class AuthResponse(BaseModel):
    # DB-ready: user_id maps to users.id (UUID)
    access_token: str
    token_type: str = "bearer"
    user_id: str
    username: str
    email: str
    arena_id: str | None = None
    wallet_address: str | None = None   # DB-ready: from users.wallet_address


class UserProfile(BaseModel):
    # DB-ready: joins users + user_stats
    user_id: str
    username: str
    email: str
    arena_id: str | None = None
    rank: str | None = None
    wallet_address: str | None = None
    xp: int = 0
    wins: int = 0
    losses: int = 0
    # Identity / Forge fields (from users table)
    avatar: str | None = None
    avatar_bg: str | None = None
    equipped_badge_icon: str | None = None
    forge_unlocked_item_ids: list[str] = []
    vip_expires_at: str | None = None


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


class ReadinessResponse(BaseModel):
    """
    Response returned by GET /ready.

    DB-ready: maps to client_sessions.status = 'ready' | 'connected'.
    When WebSocket is live this becomes a push event instead of a poll.
    """
    ready: bool
    reason: str = ""     # human-readable when ready=False


class ValidationResponse(BaseModel):
    """
    Response returned by POST /validate/screenshot.

    Fields match CLAUDE.md naming contract exactly:
      result, confidence, accepted, game, players, agents, score

    TODO:
    - persist this as a match_evidence row in DB once schema is ready
    - add match_id foreign key once matches table exists
    """
    match_id: str
    game: str                            # "CS2" | "Valorant"
    result: str | None
    confidence: float
    accepted: bool                       # True when result is non-None AND confidence >= threshold
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


@app.get("/ready", response_model=ReadinessResponse)
async def ready():
    """
    Secondary readiness check — confirms the capture subsystem is operational.

    Returns ready=True when:
      - The engine HTTP server is running (implied by responding)
      - The screenshot directory is accessible for writing

    DB-ready: will additionally check client_sessions.status once DB is wired.
    WS-ready: replace polling with a "client:ready" WebSocket push event.
    """
    try:
        os.makedirs(SCREENSHOT_DIR, exist_ok=True)
        # Quick write-access probe
        probe = os.path.join(SCREENSHOT_DIR, ".ready_probe")
        with open(probe, "w") as f:
            f.write("")
        os.remove(probe)
        return ReadinessResponse(ready=True)
    except Exception as exc:
        return ReadinessResponse(ready=False, reason=f"Capture dir not writable: {exc}")


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
        accepted=output.accepted,
        players=output.players,
        agents=output.agents,
        score=output.score,
        evidence_path=evidence_path,
    )


@app.post("/match/result")
async def submit_result(result: MatchResult, token: dict = Depends(verify_token)):
    """
    Receives a validated match result from the desktop client after local
    consensus is reached.

    Writes to match_evidence and updates matches.status/winner_id.
    CONTRACT-ready: winner_id → ArenaEscrow.declareWinner() (Phase 6).
    """
    submitted_by: str | None = token.get("sub") if isinstance(token, dict) else None

    # ── Persist evidence ───────────────────────────────────────────────────────
    try:
        with SessionLocal() as session:
            session.execute(
                text("""
                    INSERT INTO match_evidence
                        (match_id, submitted_by, result, confidence, accepted,
                         players, agents, score, game)
                    VALUES
                        (:match_id, :submitted_by, :result, :confidence, :accepted,
                         :players, :agents, :score, :game)
                """),
                {
                    "match_id":     result.match_id,
                    "submitted_by": submitted_by,
                    "result":       None,               # CLIENT-ready: pass VisionOutput.result
                    "confidence":   result.ocr_confidence,
                    "accepted":     True,
                    "players":      result.players_detected,
                    "agents":       result.agents_detected,
                    "score":        result.score,
                    "game":         result.game,
                },
            )
            # Update match status to completed + set winner if provided
            if result.winner_id:
                session.execute(
                    text("""
                        UPDATE matches
                        SET status = 'completed', winner_id = :winner_id, ended_at = NOW()
                        WHERE id = :match_id
                    """),
                    {"winner_id": result.winner_id, "match_id": result.match_id},
                )
            else:
                session.execute(
                    text("UPDATE matches SET status = 'completed', ended_at = NOW() WHERE id = :match_id"),
                    {"match_id": result.match_id},
                )
            session.commit()
        logger.info("match_evidence saved: match=%s winner=%s", result.match_id, result.winner_id)
    except Exception as exc:
        logger.error("submit_result db error: %s", exc)
        # Non-fatal: return accepted so client doesn't retry endlessly
        # CONTRACT-ready: retry queue for escrow release

    return {
        "accepted": True,
        "match_id": result.match_id,
        "message": "Result recorded",
    }


# ── Client Status — in-memory store ──────────────────────────────────────────
# DB-ready: replace with UPSERT on client_sessions table
#   Columns: wallet_address, status, game, session_id, match_id,
#            client_version, last_heartbeat
# Each connected desktop client sends a heartbeat every HEARTBEAT_INTERVAL
# seconds; the web UI polls GET /client/status to display the connection badge.

_client_store_lock = threading.Lock()
_client_statuses: dict[str, dict] = {}   # wallet_address → latest heartbeat payload

# A heartbeat older than this threshold is treated as "offline".
# Client sends every 4s; 10s = ~2 missed beats before marking offline.
_CLIENT_TIMEOUT_SECONDS = 10


def _version_ok(ver: str | None) -> bool:
    """Return True if *ver* meets the minimum client version requirement."""
    if not ver or ver == "unknown":
        return False
    try:
        def _t(v: str) -> tuple:
            return tuple(int(x) for x in v.split(".")[:3])
        return _t(ver) >= _t(MIN_CLIENT_VERSION)
    except Exception:
        return False


class HeartbeatRequest(BaseModel):
    """
    Payload sent by the desktop client every HEARTBEAT_INTERVAL seconds.

    DB-ready: maps to client_sessions row —
      wallet_address, status, game, session_id, match_id,
      client_version, user_id, last_heartbeat (server-stamped)
    """
    wallet_address: str
    client_version: str = "unknown"
    status: str = "idle"            # "idle" | "in_game" | "in_match"
    game: str | None = None         # "CS2" | "Valorant" | None
    session_id: str | None = None   # DB-ready: FK → client_sessions.id
    match_id: str | None = None     # DB-ready: FK → matches.id
    user_id: str | None = None      # DB-ready: FK → users.id; sent after client login


class ClientStatusResponse(BaseModel):
    """
    Canonical client status — Phase 4 contract.
    This is the single endpoint UI uses to gate Join / Escrow / Match actions.
    DB-ready: sourced from client_sessions table.
    """
    online: bool                   # True if last heartbeat < _CLIENT_TIMEOUT_SECONDS ago
    status: str                    # "disconnected"|"idle"|"in_game"|"in_match"
    session_id: str | None         # UUID from client config.json
    user_id: str | None            # FK → users.id; set via POST /client/bind
    wallet_address: str
    match_id: str | None
    version: str | None            # client_version string
    version_ok: bool               # True if version >= MIN_CLIENT_VERSION
    last_seen: str                 # ISO-8601 UTC; "" when never seen
    game: str | None


class BindRequest(BaseModel):
    """POST /client/bind payload — links a client session to an authenticated user."""
    session_id: str


@app.post("/client/heartbeat", status_code=200)
async def client_heartbeat(payload: HeartbeatRequest):
    """
    Receive a liveness heartbeat from the Arena desktop client.

    Always updates the in-memory store (fast, test-safe).
    Also UPSERT into client_sessions when session_id is provided.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    record = {**payload.model_dump(), "last_seen": now_iso}

    # ── In-memory update (always) ─────────────────────────────
    with _client_store_lock:
        existing = _client_statuses.get(payload.wallet_address, {})
        # user_id: prefer the heartbeat-provided value; fall back to a prior bind
        record["user_id"] = payload.user_id or existing.get("user_id")
        _client_statuses[payload.wallet_address] = record

    # ── DB UPSERT (best-effort, only when session_id is present) ─
    if payload.session_id:
        try:
            with SessionLocal() as session:
                # Disconnect any OTHER active sessions for this wallet
                session.execute(
                    text(
                        "UPDATE client_sessions "
                        "SET status = 'disconnected', disconnected_at = NOW() "
                        "WHERE wallet_address = :w "
                        "  AND id != :sid "
                        "  AND disconnected_at IS NULL"
                    ),
                    {"w": payload.wallet_address, "sid": payload.session_id},
                )
                # Upsert current session; write user_id when the client is logged in
                session.execute(
                    text(
                        "INSERT INTO client_sessions "
                        "  (id, wallet_address, status, game, client_version, match_id, user_id, last_heartbeat) "
                        "VALUES (:sid, :w, :s, :g, :v, :m, :uid, NOW()) "
                        "ON CONFLICT (id) DO UPDATE SET "
                        "  status         = EXCLUDED.status, "
                        "  game           = EXCLUDED.game, "
                        "  client_version = EXCLUDED.client_version, "
                        "  match_id       = EXCLUDED.match_id, "
                        "  user_id        = COALESCE(EXCLUDED.user_id, client_sessions.user_id), "
                        "  last_heartbeat = NOW(), "
                        "  disconnected_at = NULL"
                    ),
                    {
                        "sid": payload.session_id,
                        "w":   payload.wallet_address,
                        "s":   payload.status,
                        "g":   payload.game,
                        "v":   payload.client_version,
                        "m":   payload.match_id,
                        "uid": payload.user_id,
                    },
                )
                session.commit()
        except Exception as exc:
            logger.debug("heartbeat DB write skipped: %s", exc)

    return {"accepted": True}


@app.get("/client/status", response_model=ClientStatusResponse)
async def client_status(
    wallet_address: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    """
    Canonical client status endpoint — single source of truth for UI gating.

    Accepts either:
      • ?wallet_address=0x...        — desktop client / direct lookup
      • Authorization: Bearer <jwt>  — website: resolved to user_id → wallet_address via DB

    Priority: DB row (has user_id, authoritative) → in-memory fallback.
    UI rule: allow Join/Escrow/Match only when
      online=True AND version_ok=True AND status matches requirement.
    """
    resolved_wallet = wallet_address

    # ── Resolve wallet from JWT when wallet_address not provided ──────────────
    if not resolved_wallet and authorization and authorization.startswith("Bearer "):
        try:
            payload = auth.decode_token(authorization.removeprefix("Bearer "))
            uid = payload.get("sub")
            if uid:
                try:
                    with SessionLocal() as session:
                        row = session.execute(
                            text(
                                "SELECT wallet_address FROM client_sessions "
                                "WHERE user_id = :uid AND disconnected_at IS NULL "
                                "ORDER BY last_heartbeat DESC LIMIT 1"
                            ),
                            {"uid": uid},
                        ).fetchone()
                    if row:
                        resolved_wallet = row[0]
                    else:
                        # Authenticated user has no active bound session yet
                        return ClientStatusResponse(
                            online=False, status="disconnected",
                            session_id=None, user_id=uid,
                            wallet_address="", match_id=None,
                            version=None, version_ok=False,
                            last_seen="", game=None,
                        )
                except Exception as exc:
                    logger.debug("client_status JWT wallet lookup failed: %s", exc)
        except Exception:
            pass  # Invalid/expired token — fall through to 422

    if not resolved_wallet:
        raise HTTPException(
            status_code=422,
            detail="wallet_address query param or Authorization header required",
        )

    # ── DB-first lookup ───────────────────────────────────────────────────────
    db_row = None
    try:
        with SessionLocal() as session:
            db_row = session.execute(
                text(
                    "SELECT id, wallet_address, status, game, client_version, "
                    "       match_id, last_heartbeat, user_id "
                    "FROM client_sessions "
                    "WHERE wallet_address = :w AND disconnected_at IS NULL "
                    "ORDER BY last_heartbeat DESC LIMIT 1"
                ),
                {"w": resolved_wallet},
            ).fetchone()
    except Exception as exc:
        logger.debug("client_status DB read skipped: %s", exc)

    if db_row:
        last_seen_str = db_row[6].isoformat() if db_row[6] else ""
        try:
            elapsed = (datetime.now(timezone.utc) - db_row[6]).total_seconds()
            online = elapsed < _CLIENT_TIMEOUT_SECONDS
        except Exception:
            online = False
        ver = db_row[4]
        return ClientStatusResponse(
            online=online,
            status=db_row[2],
            session_id=str(db_row[0]),
            user_id=str(db_row[7]) if db_row[7] else None,
            wallet_address=db_row[1],
            match_id=str(db_row[5]) if db_row[5] else None,
            version=ver,
            version_ok=_version_ok(ver),
            last_seen=last_seen_str,
            game=db_row[3],
        )

    # ── Fallback: in-memory ───────────────────────────────────────────────────
    with _client_store_lock:
        record = _client_statuses.get(resolved_wallet)

    if record is None:
        return ClientStatusResponse(
            online=False,
            status="disconnected",
            session_id=None,
            user_id=None,
            wallet_address=resolved_wallet,
            match_id=None,
            version=None,
            version_ok=False,
            last_seen="",
            game=None,
        )

    last_seen_str = record.get("last_seen", "")
    try:
        last_seen_dt = datetime.fromisoformat(last_seen_str)
        elapsed = (datetime.now(timezone.utc) - last_seen_dt).total_seconds()
        online = elapsed < _CLIENT_TIMEOUT_SECONDS
    except (ValueError, TypeError):
        online = False

    ver = record.get("client_version")
    return ClientStatusResponse(
        online=online,
        status=record.get("status", "idle"),
        session_id=record.get("session_id"),
        user_id=record.get("user_id"),
        wallet_address=record["wallet_address"],
        match_id=record.get("match_id"),
        version=ver,
        version_ok=_version_ok(ver),
        last_seen=last_seen_str,
        game=record.get("game"),
    )


@app.get("/client/match")
async def client_active_match(wallet_address: str):
    """
    Return the active match_id for a given wallet address.

    The desktop client polls this every few seconds while monitoring.
    When a match_id is returned the client starts uploading screenshots.

    Lookup strategy: join match_players (wallet_address) → matches (status).
    'in_progress' = escrow is locked and the game is live.

    DB-ready: matches JOIN match_players ON mp.wallet_address = :w
              WHERE m.status = 'in_progress'
    CONTRACT-ready: active match = escrow locked; client captures & uploads
                    until match transitions to 'completed'.
    """
    try:
        with SessionLocal() as session:
            row = session.execute(
                text(
                    "SELECT m.id FROM matches m "
                    "JOIN match_players mp ON mp.match_id = m.id "
                    "WHERE mp.wallet_address = :w "
                    "  AND m.status = 'in_progress' "
                    "ORDER BY m.created_at DESC LIMIT 1"
                ),
                {"w": wallet_address},
            ).fetchone()
            if row:
                return {"match_id": str(row[0]), "wallet_address": wallet_address}
    except Exception:
        pass
    # DB not available or no active match found
    return {"match_id": None, "wallet_address": wallet_address}


@app.get("/match/{match_id}/status")
async def match_status(match_id: str):
    """
    Check match validation status from DB.

    Returns status + winner_id so the frontend can trigger escrow release
    without guessing.  winner_id is null until the engine writes a confirmed
    result — callers must treat null as "not yet decided".

    DB-ready: SELECT status, winner_id FROM matches WHERE id = :mid
    CONTRACT-ready: winner_id → escrow.release(winner_id)
    """
    try:
        with SessionLocal() as session:
            row = session.execute(
                text("SELECT status, winner_id FROM matches WHERE id = :mid"),
                {"mid": match_id},
            ).fetchone()
            if row:
                return {
                    "match_id":  match_id,
                    "status":    row[0],
                    "winner_id": row[1],   # None until match is completed
                }
    except Exception:
        pass
    return {"match_id": match_id, "status": "pending", "winner_id": None}


# ── Auth routes ───────────────────────────────────────────────────────────────

@app.post("/auth/register", response_model=AuthResponse, status_code=201)
async def register(req: RegisterRequest):
    """
    Register a new Arena user.

    Creates rows in: users, user_stats, user_balances, user_roles.
    DB-ready: all inserts use the users table from infra/sql/init.sql.
    """
    try:
        with SessionLocal() as session:
            # ── Duplicate check ───────────────────────────────────────
            existing = session.execute(
                text("SELECT id FROM users WHERE email = :e OR username = :u"),
                {"e": req.email, "u": req.username},
            ).fetchone()
            if existing:
                raise HTTPException(409, "Email or username already registered")

            # ── Create user ───────────────────────────────────────────
            pw_hash = auth.hash_password(req.password)
            arena_id = auth.generate_arena_id()
            row = session.execute(
                text(
                    "INSERT INTO users (username, email, password_hash, arena_id) "
                    "VALUES (:u, :e, :h, :a) "
                    "RETURNING id, username, email, arena_id"
                ),
                {"u": req.username, "e": req.email, "h": pw_hash, "a": arena_id},
            ).fetchone()

            user_id = str(row[0])

            # ── Seed companion rows ───────────────────────────────────
            session.execute(
                text("INSERT INTO user_stats (user_id) VALUES (:uid)"),
                {"uid": user_id},
            )
            session.execute(
                text("INSERT INTO user_balances (user_id) VALUES (:uid)"),
                {"uid": user_id},
            )
            session.execute(
                text("INSERT INTO user_roles (user_id, role) VALUES (:uid, 'user')"),
                {"uid": user_id},
            )
            session.commit()

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("register error: %s", exc)
        raise HTTPException(500, "Registration failed")

    token = auth.issue_token(user_id, req.email)
    return AuthResponse(
        access_token=token,
        user_id=user_id,
        username=req.username,
        email=req.email,
        arena_id=arena_id,
    )


@app.post("/auth/login", response_model=AuthResponse)
async def login(req: LoginRequest):
    """
    Login with email OR username + password.

    DB-ready: SELECT from users table; verifies bcrypt hash.
    """
    try:
        with SessionLocal() as session:
            row = session.execute(
                text(
                    "SELECT id, username, email, password_hash, arena_id, wallet_address "
                    "FROM users "
                    "WHERE email = :id OR username = :id"
                ),
                {"id": req.identifier},
            ).fetchone()
    except Exception as exc:
        logger.error("login db error: %s", exc)
        raise HTTPException(500, "Login failed")

    if not row or not auth.verify_password(req.password, row[3]):
        raise HTTPException(401, "Invalid credentials")

    user_id = str(row[0])
    token = auth.issue_token(user_id, row[2])
    return AuthResponse(
        access_token=token,
        user_id=user_id,
        username=row[1],
        email=row[2],
        arena_id=row[4],
        wallet_address=row[5],
    )


@app.get("/auth/me", response_model=UserProfile)
async def me(payload: dict = Depends(verify_token)):
    """
    Return the authenticated user's profile from DB.

    Joins users + user_stats; returns all identity fields
    (avatar, badge, forge_unlocked_item_ids, vip_expires_at).
    """
    user_id: str = payload["sub"]
    try:
        with SessionLocal() as session:
            row = session.execute(
                text(
                    "SELECT u.id, u.username, u.email, u.arena_id, "
                    "       u.rank, u.wallet_address, "
                    "       COALESCE(s.xp, 0), COALESCE(s.wins, 0), COALESCE(s.losses, 0), "
                    "       u.avatar, u.avatar_bg, u.equipped_badge_icon, "
                    "       u.forge_unlocked_item_ids, u.vip_expires_at "
                    "FROM users u "
                    "LEFT JOIN user_stats s ON s.user_id = u.id "
                    "WHERE u.id = :uid"
                ),
                {"uid": user_id},
            ).fetchone()
    except Exception as exc:
        logger.error("me db error: %s", exc)
        raise HTTPException(500, "Profile fetch failed")

    if not row:
        raise HTTPException(404, "User not found")

    return UserProfile(
        user_id=str(row[0]),
        username=row[1],
        email=row[2],
        arena_id=row[3],
        rank=row[4],
        wallet_address=row[5],
        xp=int(row[6]),
        wins=int(row[7]),
        losses=int(row[8]),
        avatar=row[9],
        avatar_bg=row[10],
        equipped_badge_icon=row[11],
        forge_unlocked_item_ids=list(row[12]) if row[12] else [],
        vip_expires_at=row[13].isoformat() if row[13] else None,
    )


class PatchUserRequest(BaseModel):
    """
    PATCH /users/me payload — partial update of identity fields.
    All fields optional; only provided fields are written to DB.
    DB-ready: maps to users table columns.
    """
    avatar: str | None = None
    avatar_bg: str | None = None
    equipped_badge_icon: str | None = None
    forge_unlocked_item_ids: list[str] | None = None


@app.patch("/users/me", response_model=UserProfile)
async def patch_user_me(req: PatchUserRequest, payload: dict = Depends(verify_token)):
    """
    Persist avatar, badge, and forge item changes to the users table.

    Only fields explicitly provided in the request body are updated.
    Returns the full updated UserProfile.
    DB-ready: writes to users table columns avatar, avatar_bg,
              equipped_badge_icon, forge_unlocked_item_ids.
    """
    user_id: str = payload["sub"]
    fields: dict = {}
    if req.avatar                is not None: fields["avatar"]                = req.avatar
    if req.avatar_bg             is not None: fields["avatar_bg"]             = req.avatar_bg
    if req.equipped_badge_icon   is not None: fields["equipped_badge_icon"]   = req.equipped_badge_icon
    if req.forge_unlocked_item_ids is not None:
        # Postgres TEXT[] — pass as Python list; SQLAlchemy handles the cast
        fields["forge_unlocked_item_ids"] = req.forge_unlocked_item_ids

    if fields:
        set_clause = ", ".join(f"{col} = :{col}" for col in fields)
        fields["user_id"] = user_id
        try:
            with SessionLocal() as session:
                session.execute(
                    text(
                        f"UPDATE users SET {set_clause}, updated_at = NOW() "
                        "WHERE id = :user_id"
                    ),
                    fields,
                )
                session.commit()
        except Exception as exc:
            logger.error("patch_user_me error: %s", exc)
            raise HTTPException(500, "Profile update failed")

    # Return fresh profile
    return await me(payload)


@app.post("/auth/logout", status_code=200)
async def logout(payload: dict = Depends(verify_token)):
    """
    Logout — invalidates the client session for the authenticated user.

    JWTs are stateless, so true invalidation requires a blocklist (Phase 6).
    For now: marks all active client_sessions for this user as disconnected.
    The client should discard its stored token on receipt of 200.
    """
    user_id: str = payload["sub"]
    try:
        with SessionLocal() as session:
            session.execute(
                text(
                    "UPDATE client_sessions "
                    "SET status = 'disconnected', disconnected_at = NOW() "
                    "WHERE user_id = :uid AND disconnected_at IS NULL"
                ),
                {"uid": user_id},
            )
            session.commit()
    except Exception as exc:
        logger.debug("logout DB update skipped: %s", exc)

    # Clean in-memory records for this user
    with _client_store_lock:
        to_clear = [
            w for w, r in _client_statuses.items()
            if r.get("user_id") == user_id
        ]
        for w in to_clear:
            _client_statuses.pop(w, None)

    return {"logged_out": True}


@app.post("/client/bind", status_code=200)
async def client_bind(req: BindRequest, payload: dict = Depends(verify_token)):
    """
    Bind a desktop client session to an authenticated user.

    Called by the website after login when it detects a client is online.
    Writes user_id into client_sessions so GET /client/status returns user_id.

    Flow:
      1. User logs in on website → receives JWT
      2. Website calls GET /client/status → gets session_id
      3. Website calls POST /client/bind {session_id} + Bearer <token>
      4. Engine writes user_id → client_sessions row
    """
    user_id: str = payload["sub"]
    session_id: str = req.session_id

    # ── DB write ──────────────────────────────────────────────
    try:
        with SessionLocal() as session:
            row = session.execute(
                text(
                    "SELECT id, user_id FROM client_sessions "
                    "WHERE id = :sid AND disconnected_at IS NULL"
                ),
                {"sid": session_id},
            ).fetchone()

            if not row:
                raise HTTPException(404, "Session not found or already disconnected")

            existing_user = str(row[1]) if row[1] else None
            if existing_user and existing_user != user_id:
                raise HTTPException(403, "Session already bound to a different user")

            session.execute(
                text(
                    "UPDATE client_sessions SET user_id = :uid "
                    "WHERE id = :sid"
                ),
                {"uid": user_id, "sid": session_id},
            )
            session.commit()

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("client_bind error: %s", exc)
        raise HTTPException(500, "Bind failed")

    # ── Mirror into in-memory ────────────────────────────────
    with _client_store_lock:
        for record in _client_statuses.values():
            if record.get("session_id") == session_id:
                record["user_id"] = user_id
                break

    return {"bound": True, "user_id": user_id, "session_id": session_id}
