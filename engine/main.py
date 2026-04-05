import os
import logging
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Depends, Header, Query, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, model_validator
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

import jwt as _jwt

from src.config import DATABASE_URL, ENVIRONMENT, MIN_CLIENT_VERSION
from src.vision.capture import capture_screen, crop_roi
from src.vision.engine import VisionEngine, VisionEngineConfig
from src.vision.rage_quit import RageQuitDetector
try:
    from src.contract import build_escrow_client
except ImportError:
    # web3 C extensions not available in this environment (e.g. Windows without MSVC).
    # Engine runs without escrow client — build_escrow_client returns None gracefully.
    def build_escrow_client(_session_factory):  # type: ignore[misc]
        return None
import src.auth as auth

# ── Config ────────────────────────────────────────────────────────────────────
DB_URL = DATABASE_URL or "postgresql://arena_admin:arena_secret_change_me@arena-db:5432/arena"
API_SECRET = os.getenv("API_SECRET", "change_me_in_production")
SCREENSHOT_DIR = os.getenv("SCREENSHOT_DIR", "/app/screenshots")
EVIDENCE_DIR = os.getenv("EVIDENCE_DIR", "/app/evidence")

logger = logging.getLogger("arena.engine")

db_engine = create_engine(DB_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=db_engine)

# ── Escrow client (Phase 6) ───────────────────────────────────────────────────
# Initialised in lifespan after DB check. None when env vars are missing
# (local dev / CI without blockchain config) — engine runs without escrow.
# CONTRACT-ready: EscrowClient.declare_winner() releases payout on-chain.
_escrow_client = None
_listener_task = None  # background thread task — EscrowClient.listen()


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
            # Safety-net: create client_sessions if init.sql hasn't been applied yet.
            # On a DB initialised from infra/sql/init.sql this is a harmless no-op.
            # All other tables (matches, match_evidence, users, …) are owned by
            # init.sql — never duplicated here to avoid schema drift.
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS client_sessions (
                    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    wallet_address  VARCHAR UNIQUE NOT NULL,
                    status          VARCHAR DEFAULT 'connected',
                    game            VARCHAR,
                    client_version  VARCHAR,
                    match_id        UUID,
                    last_heartbeat  TIMESTAMPTZ DEFAULT NOW(),
                    user_id         UUID REFERENCES users(id),
                    disconnected_at TIMESTAMPTZ
                )
            """))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_cs_wallet ON client_sessions(wallet_address)"
            ))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_cs_user ON client_sessions(user_id)"
            ))
            conn.commit()
        logger.info("✅ Arena Engine connected to DB")
    except Exception as exc:
        logger.warning("⚠️  DB not available at startup: %s", exc)

    # Escrow client — optional, requires BLOCKCHAIN_RPC_URL + CONTRACT_ADDRESS + PRIVATE_KEY
    global _escrow_client
    _escrow_client = build_escrow_client(SessionLocal)
    if _escrow_client:
        logger.info("✅ EscrowClient initialised (contract=%s)", _escrow_client.contract.address)
    else:
        logger.info("ℹ️  EscrowClient disabled — blockchain env vars not set")

    # Rage-quit detector — runs as background task; works with or without EscrowClient
    _rage_quit_detector = RageQuitDetector(SessionLocal, _escrow_client)
    import asyncio
    _rq_task = asyncio.create_task(_rage_quit_detector.run())
    logger.info("✅ RageQuitDetector started")

    # EscrowClient event listener — only when escrow is available.
    # listen() is a blocking loop (time.sleep) so it runs in a thread pool.
    # Resumes from oracle_sync_state.last_block on restart — no missed events.
    global _listener_task
    if _escrow_client:
        _listener_task = asyncio.create_task(
            asyncio.to_thread(_escrow_client.listen, 15)
        )
        logger.info("✅ EscrowClient event listener started")

    yield

    # ── Shutdown ──────────────────────────────────────────────────────────────
    _rq_task.cancel()
    if _listener_task:
        _listener_task.cancel()
        try:
            await _listener_task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="Arena Engine",
    version="2.0.0",
    description="OCR + Vision match validator for Arena platform",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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


async def require_admin(payload: dict = Depends(verify_token)) -> dict:
    """Raises 403 unless the authenticated user has role=admin in user_roles."""
    user_id = payload.get("sub")
    try:
        with SessionLocal() as session:
            row = session.execute(
                text("SELECT 1 FROM user_roles WHERE user_id = :uid AND role = 'admin'"),
                {"uid": user_id},
            ).fetchone()
    except Exception:
        row = None
    if not row:
        raise HTTPException(403, "Admin only")
    return payload


async def optional_token(authorization: str | None = Header(default=None)) -> dict | None:
    """Like verify_token but returns None instead of 401 when header is absent."""
    if not authorization:
        return None
    if not authorization.startswith("Bearer "):
        return None
    token = authorization.removeprefix("Bearer ")
    try:
        return auth.decode_token(token)
    except (_jwt.ExpiredSignatureError, _jwt.InvalidTokenError):
        return None


# ── Auth models ───────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str
    steam_id: str | None = None   # CS2 account; at least one game account required
    riot_id:  str | None = None   # Valorant account; at least one game account required

    @model_validator(mode="after")
    def require_and_validate_game_account(self) -> "RegisterRequest":
        """
        Enforce two rules at the Pydantic layer (→ automatic 422):
          1. At least one of steam_id / riot_id must be provided.
          2. Whichever is provided must pass the format check.
        Format checks are pure string validation — no DB or network calls.
        """
        steam = self.steam_id.strip() if self.steam_id else None
        riot  = self.riot_id.strip()  if self.riot_id  else None

        if not steam and not riot:
            raise ValueError(
                "At least one game account is required: "
                "provide steam_id (for CS2) or riot_id (for Valorant)"
            )

        if steam:
            err = auth.validate_steam_id(steam)
            if err:
                raise ValueError(err)
            self.steam_id = steam   # store stripped value

        if riot:
            err = auth.validate_riot_id(riot)
            if err:
                raise ValueError(err)
            self.riot_id = riot     # store stripped value

        return self


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
    steam_id: str | None = None
    riot_id: str | None = None
    xp: int = 0
    wins: int = 0
    losses: int = 0
    # Arena Tokens — platform currency for Forge store (NOT on-chain)
    # DB-ready: users.at_balance — awarded 200 on signup, spent in Forge
    at_balance: int = 0
    # Effective privilege from user_roles: admin > moderator > user
    role: str = "user"
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
    # ── Persist result + update user_stats ───────────────────────────────────
    # match_evidence rows are written by POST /validate/screenshot (VisionEngine
    # pipeline). This endpoint updates matches.status / winner_id AND increments
    # user_stats so wins/losses/xp accumulate in DB for every completed match.
    # CONTRACT-ready: declareWinner() call replaces this UPDATE in Phase 6.
    #
    # XP formula: winner +100 XP, all other players +25 XP (participation).
    # win_rate is recalculated as wins / matches * 100 after each update.
    try:
        with SessionLocal() as session:
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

            # ── Update user_stats for all players in this match ───────────────
            # DB-ready: match_players JOIN → update each participant's row.
            if result.winner_id:
                player_rows = session.execute(
                    text("SELECT user_id FROM match_players WHERE match_id = :mid"),
                    {"mid": result.match_id},
                ).fetchall()

                for (uid,) in player_rows:
                    uid_str = str(uid)
                    is_winner = uid_str == str(result.winner_id)
                    xp_gain   = 100 if is_winner else 25
                    session.execute(
                        text("""
                            UPDATE user_stats
                            SET matches  = matches  + 1,
                                wins     = wins     + :wins,
                                losses   = losses   + :losses,
                                xp       = xp       + :xp,
                                win_rate = CASE
                                    WHEN (matches + 1) > 0
                                    THEN ROUND((wins + :wins)::NUMERIC / (matches + 1) * 100, 2)
                                    ELSE 0
                                END
                            WHERE user_id = :uid
                        """),
                        {
                            "wins":   1 if is_winner else 0,
                            "losses": 0 if is_winner else 1,
                            "xp":     xp_gain,
                            "uid":    uid_str,
                        },
                    )
                    logger.info(
                        "user_stats updated: user=%s win=%s xp+%d",
                        uid_str, is_winner, xp_gain,
                    )
                    # ── Auto inbox notification ───────────────────────────────
                    # DB-ready: ARENA_SYSTEM_USER_ID env var must be set to a
                    # seeded system user row in the users table.
                    if is_winner:
                        _send_system_inbox(
                            session, uid_str,
                            subject="🏆 Victory — Match Result",
                            content=(
                                f"You won match {result.match_id}! "
                                f"+100 XP added to your profile. "
                                f"Winnings will be released by the escrow contract."
                            ),
                        )
                    else:
                        _send_system_inbox(
                            session, uid_str,
                            subject="Match Result",
                            content=(
                                f"Match {result.match_id} is over. "
                                f"+25 XP added for participation. Keep grinding!"
                            ),
                        )

            session.commit()
        logger.info("match_evidence saved: match=%s winner=%s", result.match_id, result.winner_id)
    except Exception as exc:
        logger.error("submit_result db error: %s", exc)
        # Non-fatal: return accepted so client doesn't retry endlessly
        # Non-fatal: DB record is source of truth

    # ── Payout ───────────────────────────────────────────────────────────────
    if result.winner_id:
        try:
            with SessionLocal() as _s:
                _sc_row = _s.execute(
                    text("SELECT stake_currency FROM matches WHERE id = :mid"),
                    {"mid": result.match_id},
                ).fetchone()
                _stake_currency = (_sc_row[0] if _sc_row else "CRYPTO") or "CRYPTO"
        except Exception:
            _stake_currency = "CRYPTO"

        if _stake_currency == "AT":
            # AT match: settle off-chain — distribute AT to winner minus 5% fee
            _settle_at_match(str(result.match_id), str(result.winner_id))
        elif _escrow_client:
            # CRYPTO match: release funds on-chain via escrow contract
            try:
                tx_hash = _escrow_client.declare_winner(
                    str(result.match_id), str(result.winner_id)
                )
                logger.info("declareWinner tx: match=%s tx=%s", result.match_id, tx_hash)
            except Exception as exc:
                logger.error(
                    "declareWinner failed (non-fatal): match=%s error=%s",
                    result.match_id, exc,
                )

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

    # ── DB UPSERT (best-effort, only when session_id is present) ─────────────
    # Conflict target: partial unique index on wallet_address WHERE disconnected_at IS NULL.
    # This matches idx_client_sessions_wallet_active from infra/sql/init.sql.
    # Behaviour:
    #   • Active session exists for this wallet  → UPDATE it (refresh heartbeat + user_id)
    #   • No active session (all disconnected)   → INSERT a new active row
    # disconnected_at is always NULL on upsert (we are declaring ourselves alive).
    if payload.session_id:
        try:
            with SessionLocal() as session:
                session.execute(
                    text(
                        "INSERT INTO client_sessions "
                        "  (id, wallet_address, status, game, client_version, match_id, user_id, "
                        "   last_heartbeat, disconnected_at) "
                        "VALUES (:sid, :w, :s, :g, :v, :m, :uid, NOW(), NULL) "
                        "ON CONFLICT (wallet_address) WHERE disconnected_at IS NULL DO UPDATE SET "
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
async def match_status(
    match_id: str,
    token: dict | None = Depends(optional_token),
):
    """
    Check match validation status from DB.

    Returns:
      - status, winner_id         — always present
      - on_chain_match_id         — BIGINT from matches table; null until MatchCreated event
      - stake_per_player          — BNB amount each player staked (float, e.g. 0.1)
      - your_team                 — 0 (Team A) or 1 (Team B) for the calling user;
                                    null when unauthenticated or user not in match

    Frontend uses on_chain_match_id + your_team to call
    ArenaEscrow.deposit(on_chain_match_id, your_team, { value: stake_wei }).

    DB-ready: matches + match_players
    CONTRACT-ready: on_chain_match_id → ArenaEscrow.deposit() / declareWinner()
    """
    user_id: str | None = token.get("user_id") if token else None
    try:
        with SessionLocal() as session:
            row = session.execute(
                text("""
                    SELECT status, winner_id, on_chain_match_id, stake_per_player
                    FROM matches
                    WHERE id = :mid
                """),
                {"mid": match_id},
            ).fetchone()
            if row:
                your_team: int | None = None
                if user_id:
                    team_row = session.execute(
                        text(
                            "SELECT team FROM match_players "
                            "WHERE match_id = :mid AND user_id = :uid"
                        ),
                        {"mid": match_id, "uid": user_id},
                    ).fetchone()
                    if team_row:
                        # DB stores 'A' / 'B'; contract uses 0 / 1
                        your_team = 0 if team_row[0] == "A" else 1
                return {
                    "match_id":          match_id,
                    "status":            row[0],
                    "winner_id":         row[1],
                    "on_chain_match_id": row[2],        # null until MatchCreated event
                    "stake_per_player":  float(row[3]) if row[3] is not None else None,
                    "your_team":         your_team,     # 0=A / 1=B / null
                }
    except Exception:
        pass
    return {
        "match_id":          match_id,
        "status":            "pending",
        "winner_id":         None,
        "on_chain_match_id": None,
        "stake_per_player":  None,
        "your_team":         None,
    }


# ── Auth routes ───────────────────────────────────────────────────────────────

@app.post("/auth/register", response_model=AuthResponse, status_code=201)
async def register(req: RegisterRequest):
    """
    Register a new Arena user.

    Creates rows in: users, user_stats, user_balances, user_roles.
    DB-ready: all inserts use the users table from infra/sql/init.sql.
    """
    # ── Normalize inputs ──────────────────────────────────────────────────────
    email    = req.email.strip().lower()
    username = req.username.strip()
    steam_id = req.steam_id.strip() if req.steam_id else None
    riot_id  = req.riot_id.strip()  if req.riot_id  else None

    try:
        with SessionLocal() as session:
            # ── Duplicate checks — one clear 409 per field ────────────────────
            if session.execute(
                text("SELECT 1 FROM users WHERE lower(email) = :e"), {"e": email}
            ).fetchone():
                raise HTTPException(409, "Email already in use")

            if session.execute(
                text("SELECT 1 FROM users WHERE lower(username) = lower(:u)"), {"u": username}
            ).fetchone():
                raise HTTPException(409, "Username already taken")

            if steam_id and session.execute(
                text("SELECT 1 FROM users WHERE steam_id = :s"), {"s": steam_id}
            ).fetchone():
                raise HTTPException(409, "Steam ID already linked to another account")

            if riot_id and session.execute(
                text("SELECT 1 FROM users WHERE riot_id = :r"), {"r": riot_id}
            ).fetchone():
                raise HTTPException(409, "Riot ID already linked to another account")

            # ── Create user ───────────────────────────────────────────────────
            pw_hash  = auth.hash_password(req.password)
            arena_id = auth.generate_arena_id()
            row = session.execute(
                text(
                    "INSERT INTO users (username, email, password_hash, arena_id, steam_id, riot_id, at_balance) "
                    "VALUES (:u, :e, :h, :a, :s, :r, 200) "
                    "RETURNING id, username, email, arena_id"
                ),
                {"u": username, "e": email, "h": pw_hash, "a": arena_id,
                 "s": steam_id, "r": riot_id},
            ).fetchone()

            user_id = str(row[0])

            # ── Seed companion rows ───────────────────────────────────────────
            session.execute(text("INSERT INTO user_stats (user_id) VALUES (:uid)"),    {"uid": user_id})
            session.execute(text("INSERT INTO user_balances (user_id) VALUES (:uid)"), {"uid": user_id})
            session.execute(text("INSERT INTO user_roles (user_id, role) VALUES (:uid, 'user')"), {"uid": user_id})
            session.commit()

    except HTTPException:
        raise
    except Exception as exc:
        # Catch any remaining DB-level UNIQUE violations as a safe 409
        err = str(exc).lower()
        if "unique" in err or "duplicate" in err:
            logger.warning("register unique violation: %s", exc)
            raise HTTPException(409, "An account with these details already exists")
        logger.error("register error: %s", exc)
        raise HTTPException(500, "Registration failed")

    token = auth.issue_token(user_id, email)
    return AuthResponse(
        access_token=token,
        user_id=user_id,
        username=username,
        email=email,
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
                    "       u.rank, u.wallet_address, u.steam_id, u.riot_id, "
                    "       COALESCE(s.xp, 0), COALESCE(s.wins, 0), COALESCE(s.losses, 0), "
                    "       u.avatar, u.avatar_bg, u.equipped_badge_icon, "
                    "       u.forge_unlocked_item_ids, u.vip_expires_at, "
                    "       COALESCE(u.at_balance, 0), "
                    "       CASE "
                    "         WHEN EXISTS (SELECT 1 FROM user_roles ar "
                    "                      WHERE ar.user_id = u.id AND ar.role = 'admin') "
                    "           THEN 'admin' "
                    "         WHEN EXISTS (SELECT 1 FROM user_roles mr "
                    "                      WHERE mr.user_id = u.id AND mr.role = 'moderator') "
                    "           THEN 'moderator' "
                    "         ELSE 'user' "
                    "       END "
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
        steam_id=row[6],
        riot_id=row[7],
        xp=int(row[8]),
        wins=int(row[9]),
        losses=int(row[10]),
        avatar=row[11],
        avatar_bg=row[12],
        equipped_badge_icon=row[13],
        forge_unlocked_item_ids=list(row[14]) if row[14] else [],
        vip_expires_at=row[15].isoformat() if row[15] else None,
        at_balance=int(row[16]),
        role=str(row[17]) if row[17] is not None else "user",
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
    # Identity fields — uniqueness enforced per field
    username:       str | None = None   # case-insensitive unique
    steam_id:       str | None = None   # globally unique; pass "" to unlink
    riot_id:        str | None = None   # globally unique; pass "" to unlink
    wallet_address: str | None = None   # Ethereum address; pass "" or null to unlink


@app.patch("/users/me", response_model=UserProfile)
async def patch_user_me(req: PatchUserRequest, payload: dict = Depends(verify_token)):
    """
    Partial update of the authenticated user's profile.

    Cosmetic fields (avatar, badge, forge items) are updated directly.
    Identity fields (username, steam_id, riot_id, wallet_address) are checked
    for uniqueness before writing — returns 409 if the value is already taken.
    Pass "" or null to unlink a field (sets column to NULL in DB).
    wallet_address: validated as 0x + 40 hex chars; "" or null → unlink.
    DB-ready: writes to users table columns.
    """
    user_id: str = payload["sub"]

    # ── Uniqueness checks for identity fields ─────────────────────────────────
    try:
        with SessionLocal() as session:
            if req.username is not None:
                conflict = session.execute(
                    text("SELECT 1 FROM users WHERE lower(username) = lower(:u) AND id != :uid"),
                    {"u": req.username.strip(), "uid": user_id},
                ).fetchone()
                if conflict:
                    raise HTTPException(409, "Username already taken")

            if req.steam_id is not None and req.steam_id != "":
                conflict = session.execute(
                    text("SELECT 1 FROM users WHERE steam_id = :s AND id != :uid"),
                    {"s": req.steam_id.strip(), "uid": user_id},
                ).fetchone()
                if conflict:
                    raise HTTPException(409, "Steam ID already linked to another account")

            if req.riot_id is not None and req.riot_id != "":
                conflict = session.execute(
                    text("SELECT 1 FROM users WHERE riot_id = :r AND id != :uid"),
                    {"r": req.riot_id.strip(), "uid": user_id},
                ).fetchone()
                if conflict:
                    raise HTTPException(409, "Riot ID already linked to another account")

            if req.wallet_address is not None and req.wallet_address.strip() != "":
                addr = req.wallet_address.strip()
                # Basic Ethereum address format check (0x + 40 hex chars)
                import re
                if not re.fullmatch(r"0x[0-9a-fA-F]{40}", addr):
                    raise HTTPException(400, "Invalid Ethereum wallet address format")
                conflict = session.execute(
                    text("SELECT 1 FROM users WHERE wallet_address = :w AND id != :uid"),
                    {"w": addr, "uid": user_id},
                ).fetchone()
                if conflict:
                    raise HTTPException(409, "Wallet address already linked to another account")
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("patch_user_me uniqueness check error: %s", exc)
        raise HTTPException(500, "Profile update failed")

    # ── Guard: cannot unlink both game accounts simultaneously ───────────────
    # A user without any game account can't join any match.
    # We check the resulting state: if both would become NULL → 400.
    unlinking_steam = req.steam_id is not None and req.steam_id.strip() == ""
    unlinking_riot  = req.riot_id  is not None and req.riot_id.strip()  == ""
    if unlinking_steam and unlinking_riot:
        raise HTTPException(
            400,
            "Cannot unlink both game accounts at once. "
            "Keep at least one (Steam ID or Riot ID) to remain eligible for matches."
        )

    # ── Build update fields ───────────────────────────────────────────────────
    fields: dict = {}
    if req.avatar                  is not None: fields["avatar"]                  = req.avatar
    if req.avatar_bg               is not None: fields["avatar_bg"]               = req.avatar_bg
    if req.equipped_badge_icon     is not None: fields["equipped_badge_icon"]     = req.equipped_badge_icon
    if req.forge_unlocked_item_ids is not None:
        fields["forge_unlocked_item_ids"] = req.forge_unlocked_item_ids
    if req.username       is not None: fields["username"]       = req.username.strip()
    if req.steam_id       is not None: fields["steam_id"]       = req.steam_id.strip()       or None  # "" → NULL
    if req.riot_id        is not None: fields["riot_id"]        = req.riot_id.strip()        or None  # "" → NULL
    if req.wallet_address is not None: fields["wallet_address"] = req.wallet_address.strip() or None  # "" → NULL (unlink)

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
            # Allow binding to a previously-disconnected session so that
            # re-login after sign-out works immediately (before the next heartbeat).
            row = session.execute(
                text("SELECT id, user_id FROM client_sessions WHERE id = :sid"),
                {"sid": session_id},
            ).fetchone()

            if not row:
                raise HTTPException(404, "Session not found")

            existing_user = str(row[1]) if row[1] else None
            if existing_user and existing_user != user_id:
                raise HTTPException(403, "Session already bound to a different user")

            # Bind user_id and clear disconnected_at — this re-activates the session
            # for a client that just re-logged in after a sign-out.
            session.execute(
                text(
                    "UPDATE client_sessions "
                    "SET user_id = :uid, disconnected_at = NULL "
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


# ── Match lifecycle ───────────────────────────────────────────────────────────

_VALID_GAMES = {"CS2", "Valorant"}


def _normalize_game(raw: str) -> str:
    """Normalise game name to canonical form ('CS2' or 'Valorant')."""
    mapping = {"cs2": "CS2", "valorant": "Valorant"}
    return mapping.get(raw.strip().lower(), raw.strip())


def _assert_game_account(game: str, steam_id: str | None, riot_id: str | None) -> None:
    """
    Raise HTTPException(403) if the user lacks the required game account.

    CS2      → needs steam_id
    Valorant → needs riot_id
    """
    if game == "CS2" and not steam_id:
        raise HTTPException(
            403,
            "A verified Steam ID is required to create or join CS2 matches. "
            "Add your Steam ID in Profile → Settings."
        )
    if game == "Valorant" and not riot_id:
        raise HTTPException(
            403,
            "A verified Riot ID is required to create or join Valorant matches. "
            "Add your Riot ID in Profile → Settings."
        )


def _assert_usdt_balance(wallet_address: str, required_usdt: float) -> None:
    """
    Verify wallet_address holds at least required_usdt USDT on-chain.
    Raises HTTPException(400) if balance is insufficient.
    Skips silently if BLOCKCHAIN_RPC_URL or USDT_CONTRACT_ADDRESS not set
    (fail-open so dev/test environments without RPC still work).

    CONTRACT-ready: ERC20 balanceOf() on BSC — 18 decimals.
    """
    from src.config import BLOCKCHAIN_RPC_URL, USDT_CONTRACT_ADDRESS
    if not BLOCKCHAIN_RPC_URL or not USDT_CONTRACT_ADDRESS:
        log.debug("_assert_usdt_balance: RPC/USDT contract not configured, skipping")
        return
    try:
        from web3 import Web3
        w3 = Web3(Web3.HTTPProvider(BLOCKCHAIN_RPC_URL))
        abi = [{
            "inputs": [{"name": "account", "type": "address"}],
            "name": "balanceOf",
            "outputs": [{"name": "", "type": "uint256"}],
            "stateMutability": "view",
            "type": "function",
        }]
        contract = w3.eth.contract(
            address=Web3.to_checksum_address(USDT_CONTRACT_ADDRESS), abi=abi
        )
        balance_wei = contract.functions.balanceOf(
            Web3.to_checksum_address(wallet_address)
        ).call()
        balance_usdt = balance_wei / 10 ** 18   # USDT on BSC: 18 decimals
        if balance_usdt < required_usdt:
            raise HTTPException(
                400,
                f"Insufficient USDT balance. Need {required_usdt} USDT, "
                f"your wallet has {balance_usdt:.4f} USDT.",
            )
    except HTTPException:
        raise
    except Exception as exc:
        log.warning("_assert_usdt_balance: on-chain check failed, skipping: %s", exc)


_VALID_MODES = {"1v1", "2v2", "4v4", "5v5"}


class CreateMatchRequest(BaseModel):
    """
    POST /matches — create a new match lobby.

    Field names mirror infra/sql/init.sql exactly:
      game         → matches.game  (game enum: 'CS2' | 'Valorant' | …)
      stake_amount → matches.bet_amount  (NUMERIC, must be > 0; CHECK enforced by DB)
      mode         → matches.mode  (match_mode enum: '1v1' | '2v2' | '4v4' | '5v5')
      match_type   → matches.type  (match_type enum: 'public' | 'custom')

    DB-ready: writes to matches + match_players tables.
    CONTRACT-ready: stake_amount → ArenaEscrow.lockStake() once wallet is linked.
    """
    game: str = "CS2"                # "CS2" | "Valorant"
    stake_amount: float = 1.0        # stake per player (USDT for CRYPTO, AT tokens for AT)
    mode: str = "1v1"                # "1v1" | "2v2" | "4v4" | "5v5"
    match_type: str = "custom"       # "public" | "custom"
    stake_currency: str = "CRYPTO"   # "CRYPTO" (ETH/BNB via escrow) | "AT" (Arena Tokens)


_VALID_CURRENCIES = {"CRYPTO", "AT"}
_AT_FEE_PCT = 0.05  # 5% platform fee on AT match winnings — mirrors ArenaEscrow fee


def _assert_at_balance(session, user_id: str, required: int) -> None:
    """Raise 402 if user's at_balance < required AT."""
    row = session.execute(
        text("SELECT at_balance FROM users WHERE id = :uid"),
        {"uid": user_id},
    ).fetchone()
    if not row:
        raise HTTPException(404, "User not found")
    if int(row[0]) < required:
        raise HTTPException(
            402,
            f"Insufficient Arena Tokens — you need {required} AT but have {int(row[0])} AT.",
        )


def _deduct_at(session, user_id: str, amount: int, match_id: str, tx_type: str = "escrow_lock") -> None:
    """Deduct AT from user and record transaction. Called inside an open session (caller commits)."""
    session.execute(
        text("UPDATE users SET at_balance = at_balance - :amt WHERE id = :uid"),
        {"amt": amount, "uid": user_id},
    )
    session.execute(
        text(
            "INSERT INTO transactions (user_id, type, amount, token, status, match_id) "
            "VALUES (:uid, :ttype, :amt, 'AT', 'completed', :mid)"
        ),
        {"uid": user_id, "ttype": tx_type, "amt": amount, "mid": match_id},
    )


def _credit_at(session, user_id: str, amount: int, match_id: str, tx_type: str = "match_win") -> None:
    """Credit AT to user and record transaction. Called inside an open session (caller commits)."""
    session.execute(
        text("UPDATE users SET at_balance = at_balance + :amt WHERE id = :uid"),
        {"amt": amount, "uid": user_id},
    )
    session.execute(
        text(
            "INSERT INTO transactions (user_id, type, amount, token, status, match_id) "
            "VALUES (:uid, :ttype, :amt, 'AT', 'completed', :mid)"
        ),
        {"uid": user_id, "ttype": tx_type, "amt": amount, "mid": match_id},
    )


def _settle_at_match(match_id: str, winner_id: str) -> None:
    """
    Distribute AT for a completed AT-currency match.

    Flow (mirrors ArenaEscrow.declareWinner):
      1. Read all players and their AT stake from the match.
      2. Compute pot = stake_per_player * player_count.
      3. Deduct 5% fee → winner receives 95% of pot.
      4. Credit winner, log fee transaction, commit.

    DB-ready: uses users.at_balance + transactions table.
    """
    try:
        with SessionLocal() as session:
            match_row = session.execute(
                text(
                    "SELECT stake_currency, bet_amount FROM matches WHERE id = :mid"
                ),
                {"mid": match_id},
            ).fetchone()

            if not match_row or match_row[0] != "AT":
                return  # not an AT match — nothing to do

            stake_per_player = int(match_row[1])
            player_rows = session.execute(
                text("SELECT user_id FROM match_players WHERE match_id = :mid"),
                {"mid": match_id},
            ).fetchall()

            player_count = len(player_rows)
            if player_count == 0:
                return

            pot = stake_per_player * player_count
            fee = int(pot * _AT_FEE_PCT)
            winner_payout = pot - fee

            _credit_at(session, winner_id, winner_payout, match_id, "match_win")

            # Fee transaction (platform revenue — no user credited)
            session.execute(
                text(
                    "INSERT INTO transactions (user_id, type, amount, token, status, match_id) "
                    "VALUES (:uid, 'fee', :amt, 'AT', 'completed', :mid)"
                ),
                {"uid": winner_id, "amt": fee, "mid": match_id},
            )
            session.commit()
            logger.info(
                "_settle_at_match: match=%s winner=%s payout=%d AT fee=%d AT",
                match_id, winner_id, winner_payout, fee,
            )
    except Exception as exc:
        logger.error("_settle_at_match error (non-fatal): match=%s error=%s", match_id, exc)


def _refund_at_match(match_id: str) -> None:
    """
    Refund all AT stakes for a cancelled AT-currency match.
    Returns stake_per_player AT to every player in match_players.
    DB-ready: uses users.at_balance + transactions table.
    """
    try:
        with SessionLocal() as session:
            match_row = session.execute(
                text("SELECT stake_currency, bet_amount FROM matches WHERE id = :mid"),
                {"mid": match_id},
            ).fetchone()

            if not match_row or match_row[0] != "AT":
                return

            stake_per_player = int(match_row[1])
            player_rows = session.execute(
                text("SELECT user_id FROM match_players WHERE match_id = :mid"),
                {"mid": match_id},
            ).fetchall()

            for (uid,) in player_rows:
                _credit_at(session, str(uid), stake_per_player, match_id, "refund")

            session.commit()
            logger.info(
                "_refund_at_match: match=%s refunded %d players %d AT each",
                match_id, len(player_rows), stake_per_player,
            )
    except Exception as exc:
        logger.error("_refund_at_match error (non-fatal): match=%s error=%s", match_id, exc)


@app.post("/matches", status_code=201)
async def create_match(req: CreateMatchRequest, payload: dict = Depends(verify_token)):
    """
    Create a new match lobby.

    Game-account gate:
      CS2      → creator must have steam_id
      Valorant → creator must have riot_id

    On success returns match_id + status='waiting' so the frontend can
    open the lobby and wait for the second player.

    DB-ready: inserts into matches (id, game, creator_id, stake_amount, status)
              and match_players (match_id, user_id, wallet_address).
    """
    user_id: str = payload["sub"]
    game = _normalize_game(req.game)

    if game not in _VALID_GAMES:
        raise HTTPException(400, f"game must be one of: {', '.join(sorted(_VALID_GAMES))}")

    mode = req.mode.strip()
    if mode not in _VALID_MODES:
        raise HTTPException(400, f"mode must be one of: {', '.join(sorted(_VALID_MODES))}")

    match_type = req.match_type.strip()
    if match_type not in ("public", "custom"):
        raise HTTPException(400, "match_type must be 'public' or 'custom'")

    stake_currency = req.stake_currency.upper().strip()
    if stake_currency not in _VALID_CURRENCIES:
        raise HTTPException(400, "stake_currency must be 'CRYPTO' or 'AT'")

    # bet_amount has CHECK > 0 in DB; clamp to minimum to prevent constraint error
    bet_amount = max(float(req.stake_amount), 0.01)
    at_stake = int(bet_amount) if stake_currency == "AT" else 0

    try:
        with SessionLocal() as session:
            # ── Look up creator's game accounts ───────────────────────────────
            user_row = session.execute(
                text("SELECT steam_id, riot_id, wallet_address FROM users WHERE id = :uid"),
                {"uid": user_id},
            ).fetchone()

            if not user_row:
                raise HTTPException(404, "User not found")

            steam_id, riot_id, wallet_address = user_row
            _assert_game_account(game, steam_id, riot_id)

            # ── AT balance check (before creating the match row) ──────────────
            if stake_currency == "AT":
                _assert_at_balance(session, user_id, at_stake)

            # ── Create match ──────────────────────────────────────────────────
            match_row = session.execute(
                text(
                    "INSERT INTO matches (type, game, host_id, mode, bet_amount, stake_currency) "
                    "VALUES (:mtype, :g, :host, :mode, :bet, :sc) "
                    "RETURNING id"
                ),
                {
                    "mtype": match_type,
                    "g":     game,
                    "host":  user_id,
                    "mode":  mode,
                    "bet":   bet_amount,
                    "sc":    stake_currency,
                },
            ).fetchone()
            match_id = str(match_row[0])

            # ── Add creator as first player ───────────────────────────────────
            session.execute(
                text(
                    "INSERT INTO match_players (match_id, user_id, wallet_address) "
                    "VALUES (:mid, :uid, :w)"
                ),
                {"mid": match_id, "uid": user_id, "w": wallet_address},
            )

            # ── Lock creator's AT stake ───────────────────────────────────────
            if stake_currency == "AT":
                _deduct_at(session, user_id, at_stake, match_id, "escrow_lock")

            session.commit()

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_match error: %s", exc)
        raise HTTPException(500, "Match creation failed")

    return {
        "match_id":        match_id,
        "game":            game,
        "mode":            mode,
        "match_type":      match_type,
        "status":          "waiting",
        "stake_amount":    bet_amount,
        "stake_currency":  stake_currency,
    }


@app.post("/matches/{match_id}/join", status_code=200)
async def join_match(match_id: str, payload: dict = Depends(verify_token)):
    """
    Join an existing match lobby.

    Game-account gate (same as create_match):
      CS2      → joiner must have steam_id
      Valorant → joiner must have riot_id

    DB-ready: validates match exists + is 'waiting', checks duplicate join,
              inserts into match_players.
    CONTRACT-ready: triggers escrow lock once both players have joined.
    """
    user_id: str = payload["sub"]

    try:
        with SessionLocal() as session:
            # ── Verify match exists and is open ───────────────────────────────
            match_row = session.execute(
                text(
                    "SELECT game, status, bet_amount, stake_currency "
                    "FROM matches WHERE id = :mid"
                ),
                {"mid": match_id},
            ).fetchone()

            if not match_row:
                raise HTTPException(404, "Match not found")

            game, status, stake_amount, stake_currency = match_row
            game = _normalize_game(game or "CS2")
            stake_currency = (stake_currency or "CRYPTO").upper()

            if status != "waiting":
                raise HTTPException(409, f"Match is not open for joining (status: {status})")

            # ── Check joiner's game account ───────────────────────────────────
            user_row = session.execute(
                text("SELECT steam_id, riot_id, wallet_address FROM users WHERE id = :uid"),
                {"uid": user_id},
            ).fetchone()

            if not user_row:
                raise HTTPException(404, "User not found")

            steam_id, riot_id, wallet_address = user_row
            _assert_game_account(game, steam_id, riot_id)

            # ── Currency-specific balance checks ──────────────────────────────
            if stake_currency == "AT":
                # AT match: check arena token balance (no wallet needed)
                at_stake = int(stake_amount or 0)
                _assert_at_balance(session, user_id, at_stake)
            else:
                # CRYPTO match: wallet must be linked + on-chain balance check
                if not wallet_address:
                    raise HTTPException(
                        400,
                        "You must link a wallet before joining a staked match. "
                        "Go to Profile → Wallet and connect your MetaMask."
                    )
                if stake_amount:
                    _assert_usdt_balance(wallet_address, float(stake_amount))

            # ── Duplicate join guard ──────────────────────────────────────────
            already = session.execute(
                text(
                    "SELECT 1 FROM match_players "
                    "WHERE match_id = :mid AND user_id = :uid"
                ),
                {"mid": match_id, "uid": user_id},
            ).fetchone()

            if already:
                raise HTTPException(409, "Already joined this match")

            # ── Join ──────────────────────────────────────────────────────────
            session.execute(
                text(
                    "INSERT INTO match_players (match_id, user_id, wallet_address) "
                    "VALUES (:mid, :uid, :w)"
                ),
                {"mid": match_id, "uid": user_id, "w": wallet_address},
            )

            # ── Lock joiner's AT stake ────────────────────────────────────────
            if stake_currency == "AT":
                _deduct_at(session, user_id, int(stake_amount or 0), match_id, "escrow_lock")

            session.commit()

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("join_match error: %s", exc)
        raise HTTPException(500, "Join failed")

    return {"joined": True, "match_id": match_id, "game": game, "stake_currency": stake_currency}


# ── Arena Token purchase ───────────────────────────────────────────────────────

class BuyAtRequest(BaseModel):
    """
    POST /wallet/buy-at — credit Arena Tokens after on-chain USDT transfer.

    Flow:
      1. Frontend: user transfers USDT to platform wallet via MetaMask.
      2. Frontend: sends tx_hash + usdt_amount to this endpoint.
      3. Backend: CONTRACT-ready: verify tx on-chain (skipped if no RPC).
      4. Backend: credits at_balance += usdt_amount * AT_PER_USDT.
      5. Returns new at_balance.
    """
    tx_hash: str         # MetaMask tx hash of the USDT transfer
    usdt_amount: float   # USDT transferred (must be > 0)


@app.post("/wallet/buy-at")
async def buy_arena_tokens(req: BuyAtRequest, payload: dict = Depends(verify_token)):
    """
    Credit Arena Tokens to the user after they transfer USDT to the platform wallet.

    CONTRACT-ready: tx_hash should be verified on-chain before crediting.
    Rate: AT_PER_USDT env var (default 10 AT per 1 USDT).
    DB-ready: UPDATE users SET at_balance = at_balance + :at WHERE id = :uid.
    """
    from src.config import AT_PER_USDT

    user_id: str = payload["sub"]

    if req.usdt_amount <= 0:
        raise HTTPException(400, "usdt_amount must be greater than 0")

    at_to_credit = int(req.usdt_amount * AT_PER_USDT)
    if at_to_credit <= 0:
        raise HTTPException(400, "Amount too small to purchase Arena Tokens")

    try:
        with SessionLocal() as session:
            result = session.execute(
                text("""
                    UPDATE users
                       SET at_balance = at_balance + :at
                     WHERE id = :uid
                    RETURNING at_balance
                """),
                {"at": at_to_credit, "uid": user_id},
            ).fetchone()

            if not result:
                raise HTTPException(404, "User not found")

            session.commit()
            new_balance = int(result[0])

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("buy_at error: %s", exc)
        raise HTTPException(500, "Purchase failed")

    logger.info(
        "buy_at: user=%s credited %d AT (%.2f USDT, tx=%s)",
        user_id, at_to_credit, req.usdt_amount, req.tx_hash,
    )
    return {
        "at_balance":  new_balance,
        "at_credited": at_to_credit,
        "usdt_spent":  req.usdt_amount,
    }


# ── AT packages ───────────────────────────────────────────────────────────────


@app.get("/wallet/at-packages")
async def get_at_packages():
    """
    Return all active AT purchase packages with discount info.

    DB-ready: reads at_packages table (seeded in migration 008).
    Response per package:
      at_amount    — tokens received
      usdt_price   — full price in USDT
      discount_pct — discount percentage
      final_price  — USDT after discount (usdt_price * (1 - discount_pct/100))
    """
    try:
        with SessionLocal() as session:
            rows = session.execute(
                text(
                    "SELECT at_amount, usdt_price, discount_pct "
                    "FROM at_packages WHERE active = TRUE ORDER BY at_amount"
                )
            ).fetchall()
    except Exception as exc:
        logger.error("get_at_packages error: %s", exc)
        raise HTTPException(500, "Failed to load packages")

    packages = []
    for at_amount, usdt_price, discount_pct in rows:
        disc = float(discount_pct or 0)
        final = round(float(usdt_price) * (1 - disc / 100), 2)
        packages.append({
            "at_amount":    int(at_amount),
            "usdt_price":   float(usdt_price),
            "discount_pct": disc,
            "final_price":  final,
        })

    return {"packages": packages}


class BuyAtPackageRequest(BaseModel):
    """
    POST /wallet/buy-at-package — buy a fixed AT package (with discount).

    tx_hash    — MetaMask USDT transfer proof
    at_amount  — must match one of the active at_packages rows exactly
    """
    tx_hash: str
    at_amount: int


@app.post("/wallet/buy-at-package")
async def buy_at_package(req: BuyAtPackageRequest, payload: dict = Depends(verify_token)):
    """
    Credit Arena Tokens for a pre-defined discounted package purchase.

    Flow:
      1. User transfers USDT (final_price) to platform wallet via MetaMask.
      2. Frontend sends tx_hash + at_amount.
      3. Backend validates at_amount matches a package, credits AT.

    CONTRACT-ready: tx_hash should be verified on-chain before crediting.
    DB-ready: UPDATE users SET at_balance + :at; INSERT transactions.
    """
    user_id: str = payload["sub"]

    try:
        with SessionLocal() as session:
            pkg = session.execute(
                text(
                    "SELECT at_amount, usdt_price, discount_pct "
                    "FROM at_packages WHERE at_amount = :amt AND active = TRUE"
                ),
                {"amt": req.at_amount},
            ).fetchone()

            if not pkg:
                raise HTTPException(404, f"No active package for {req.at_amount} AT")

            at_amount, usdt_price, discount_pct = pkg
            disc = float(discount_pct or 0)
            final_price = round(float(usdt_price) * (1 - disc / 100), 2)

            result = session.execute(
                text(
                    "UPDATE users SET at_balance = at_balance + :at "
                    "WHERE id = :uid RETURNING at_balance"
                ),
                {"at": int(at_amount), "uid": user_id},
            ).fetchone()

            if not result:
                raise HTTPException(404, "User not found")

            session.execute(
                text(
                    "INSERT INTO transactions (user_id, type, amount, token, status) "
                    "VALUES (:uid, 'at_purchase', :amt, 'AT', 'completed')"
                ),
                {"uid": user_id, "amt": int(at_amount)},
            )
            session.commit()
            new_balance = int(result[0])

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("buy_at_package error: %s", exc)
        raise HTTPException(500, "Purchase failed")

    logger.info(
        "buy_at_package: user=%s pkg=%d AT final=%.2f USDT tx=%s",
        user_id, req.at_amount, final_price, req.tx_hash,
    )
    return {
        "at_balance":   new_balance,
        "at_credited":  req.at_amount,
        "usdt_spent":   final_price,
        "discount_pct": disc,
    }


# ── Forge purchase ─────────────────────────────────────────────────────────────

class ForgePurchaseRequest(BaseModel):
    """
    POST /forge/purchase — spend AT to unlock a Forge item.

    item_slug: unique item identifier from forge_items.slug
               (e.g. "avatar-dragon", "badge-founders")
    """
    item_slug: str


@app.post("/forge/purchase")
async def forge_purchase(req: ForgePurchaseRequest, payload: dict = Depends(verify_token)):
    """
    Purchase a Forge item with Arena Tokens.

    Flow:
      1. Fetch item from forge_items by slug — 404 if not found / not active.
      2. Check user does not already own it — 409 if duplicate.
      3. Check at_balance >= price_at — 400 if insufficient.
      4. Deduct at_balance, add slug to forge_unlocked_item_ids, insert forge_purchase row.
      5. Return new at_balance + item_slug.

    DB-ready: writes to users (at_balance, forge_unlocked_item_ids) + forge_purchases.
    """
    user_id: str = payload["sub"]

    try:
        with SessionLocal() as session:
            # ── 1. Fetch item ─────────────────────────────────────────────────
            item_row = session.execute(
                text(
                    "SELECT id, price_at FROM forge_items "
                    "WHERE slug = :slug AND active = TRUE"
                ),
                {"slug": req.item_slug},
            ).fetchone()

            if not item_row:
                raise HTTPException(404, f"Item '{req.item_slug}' not found or unavailable")

            item_id, price_at = item_row

            if price_at is None:
                raise HTTPException(400, f"Item '{req.item_slug}' is not available for Arena Tokens")

            # ── 2. Already owned? ─────────────────────────────────────────────
            user_row = session.execute(
                text("SELECT at_balance, forge_unlocked_item_ids FROM users WHERE id = :uid"),
                {"uid": user_id},
            ).fetchone()

            if not user_row:
                raise HTTPException(404, "User not found")

            at_balance, owned_ids = user_row
            owned_ids = list(owned_ids) if owned_ids else []

            if req.item_slug in owned_ids:
                raise HTTPException(409, f"You already own '{req.item_slug}'")

            # ── 3. Sufficient AT? ─────────────────────────────────────────────
            if at_balance < price_at:
                raise HTTPException(
                    400,
                    f"Insufficient Arena Tokens. Need {price_at} AT, you have {at_balance} AT.",
                )

            # ── 4. Deduct + unlock ────────────────────────────────────────────
            new_ids = owned_ids + [req.item_slug]
            result = session.execute(
                text("""
                    UPDATE users
                       SET at_balance              = at_balance - :cost,
                           forge_unlocked_item_ids = :ids
                     WHERE id = :uid
                    RETURNING at_balance
                """),
                {"cost": price_at, "ids": new_ids, "uid": user_id},
            ).fetchone()

            session.execute(
                text(
                    "INSERT INTO forge_purchases (user_id, item_id, currency, amount) "
                    "VALUES (:uid, :iid, 'AT', :cost)"
                ),
                {"uid": user_id, "iid": str(item_id), "cost": price_at},
            )
            session.commit()
            new_balance = int(result[0])

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("forge_purchase error: %s", exc)
        raise HTTPException(500, "Purchase failed")

    logger.info(
        "forge_purchase: user=%s bought %s for %d AT (balance now %d)",
        user_id, req.item_slug, price_at, new_balance,
    )
    return {
        "at_balance": new_balance,
        "item_slug":  req.item_slug,
    }


# ── Change password ────────────────────────────────────────────────────────────

class ChangePasswordRequest(BaseModel):
    """
    POST /auth/change-password — update the authenticated user's password.

    current_password: must match the bcrypt hash stored in users.password_hash.
    new_password:     minimum 8 characters; bcrypt-hashed before storage.
    """
    current_password: str
    new_password: str


@app.post("/auth/change-password", status_code=200)
async def change_password(req: ChangePasswordRequest, payload: dict = Depends(verify_token)):
    """
    Change the authenticated user's password.

    Steps:
      1. Fetch current password_hash from DB.
      2. Verify current_password against the stored hash — 400 if wrong.
      3. Hash new_password and UPDATE users.password_hash.

    DB-ready: reads and writes users.password_hash.
    """
    user_id: str = payload["sub"]

    if len(req.new_password) < 8:
        raise HTTPException(400, "New password must be at least 8 characters")

    try:
        with SessionLocal() as session:
            row = session.execute(
                text("SELECT password_hash FROM users WHERE id = :uid"),
                {"uid": user_id},
            ).fetchone()

            if not row:
                raise HTTPException(404, "User not found")

            if not auth.verify_password(req.current_password, row[0]):
                raise HTTPException(400, "Current password is incorrect")

            new_hash = auth.hash_password(req.new_password)
            session.execute(
                text("UPDATE users SET password_hash = :h, updated_at = NOW() WHERE id = :uid"),
                {"h": new_hash, "uid": user_id},
            )
            session.commit()

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("change_password error: %s", exc)
        raise HTTPException(500, "Password change failed")

    return {"changed": True}


# ── Friendships ────────────────────────────────────────────────────────────────

class FriendRequestBody(BaseModel):
    """
    POST /friends/request — send a friend request.

    user_id: UUID of the target user.
    message: optional greeting message (stored in friendships.message).
    """
    user_id: str
    message: str | None = None


@app.post("/friends/request", status_code=201)
async def send_friend_request(req: FriendRequestBody, payload: dict = Depends(verify_token)):
    """
    Send a friend request to another user.

    Rules:
      - Cannot friend yourself.
      - If a pending/accepted/blocked friendship already exists (either direction) → 409.
      - Inserts a new row with status='pending'.

    DB-ready: inserts into friendships table.
    """
    me: str = payload["sub"]

    if me == req.user_id:
        raise HTTPException(400, "Cannot send a friend request to yourself")

    try:
        with SessionLocal() as session:
            # Check target user exists
            target = session.execute(
                text("SELECT id FROM users WHERE id = :uid"),
                {"uid": req.user_id},
            ).fetchone()
            if not target:
                raise HTTPException(404, "User not found")

            # Check no existing friendship in either direction
            existing = session.execute(
                text(
                    "SELECT id, status FROM friendships "
                    "WHERE (initiator_id = :me AND receiver_id = :them) "
                    "   OR (initiator_id = :them AND receiver_id = :me)"
                ),
                {"me": me, "them": req.user_id},
            ).fetchone()

            if existing:
                status_val = existing[1]
                if status_val == "blocked":
                    raise HTTPException(403, "Cannot send a friend request to this user")
                raise HTTPException(409, "A friend request or friendship already exists")

            session.execute(
                text(
                    "INSERT INTO friendships (initiator_id, receiver_id, message) "
                    "VALUES (:me, :them, :msg)"
                ),
                {"me": me, "them": req.user_id, "msg": req.message},
            )
            session.commit()

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("send_friend_request error: %s", exc)
        raise HTTPException(500, "Request failed")

    return {"sent": True, "to": req.user_id}


@app.get("/friends")
async def list_friends(payload: dict = Depends(verify_token)):
    """
    List all accepted friends for the authenticated user.

    Returns each friend's basic profile: user_id, username, avatar, arena_id.
    DB-ready: friendships JOIN users.
    """
    me: str = payload["sub"]
    try:
        with SessionLocal() as session:
            rows = session.execute(
                text(
                    "SELECT u.id, u.username, u.arena_id, u.avatar, u.equipped_badge_icon "
                    "FROM friendships f "
                    "JOIN users u ON u.id = CASE "
                    "  WHEN f.initiator_id = :me THEN f.receiver_id "
                    "  ELSE f.initiator_id END "
                    "WHERE (f.initiator_id = :me OR f.receiver_id = :me) "
                    "  AND f.status = 'accepted' "
                    "ORDER BY u.username ASC"
                ),
                {"me": me},
            ).fetchall()
    except Exception as exc:
        logger.error("list_friends error: %s", exc)
        raise HTTPException(500, "Failed to load friends")

    return {
        "friends": [
            {
                "user_id":             str(r[0]),
                "username":            r[1],
                "arena_id":            r[2],
                "avatar":              r[3],
                "equipped_badge_icon": r[4],
            }
            for r in rows
        ]
    }


@app.get("/friends/requests")
async def list_friend_requests(payload: dict = Depends(verify_token)):
    """
    List pending friend requests for the authenticated user.

    Returns:
      incoming: requests where I am the receiver (I can accept/reject)
      outgoing: requests I sent (I can cancel)

    DB-ready: friendships JOIN users.
    """
    me: str = payload["sub"]
    try:
        with SessionLocal() as session:
            incoming_rows = session.execute(
                text(
                    "SELECT f.id, u.id, u.username, u.arena_id, u.avatar, f.message, f.created_at "
                    "FROM friendships f "
                    "JOIN users u ON u.id = f.initiator_id "
                    "WHERE f.receiver_id = :me AND f.status = 'pending' "
                    "ORDER BY f.created_at DESC"
                ),
                {"me": me},
            ).fetchall()

            outgoing_rows = session.execute(
                text(
                    "SELECT f.id, u.id, u.username, u.arena_id, u.avatar, f.message, f.created_at "
                    "FROM friendships f "
                    "JOIN users u ON u.id = f.receiver_id "
                    "WHERE f.initiator_id = :me AND f.status = 'pending' "
                    "ORDER BY f.created_at DESC"
                ),
                {"me": me},
            ).fetchall()

    except Exception as exc:
        logger.error("list_friend_requests error: %s", exc)
        raise HTTPException(500, "Failed to load friend requests")

    def _fmt(rows: list) -> list:
        return [
            {
                "request_id": str(r[0]),
                "user_id":    str(r[1]),
                "username":   r[2],
                "arena_id":   r[3],
                "avatar":     r[4],
                "message":    r[5],
                "created_at": r[6].isoformat() if r[6] else None,
            }
            for r in rows
        ]

    return {
        "incoming": _fmt(incoming_rows),
        "outgoing": _fmt(outgoing_rows),
    }


@app.post("/friends/{user_id}/accept", status_code=200)
async def accept_friend_request(user_id: str, payload: dict = Depends(verify_token)):
    """
    Accept a pending friend request from user_id.

    Only the receiver can accept. Updates status → 'accepted'.
    DB-ready: UPDATE friendships.
    """
    me: str = payload["sub"]
    try:
        with SessionLocal() as session:
            row = session.execute(
                text(
                    "SELECT id FROM friendships "
                    "WHERE initiator_id = :them AND receiver_id = :me AND status = 'pending'"
                ),
                {"them": user_id, "me": me},
            ).fetchone()

            if not row:
                raise HTTPException(404, "No pending friend request found from this user")

            session.execute(
                text(
                    "UPDATE friendships SET status = 'accepted', updated_at = NOW() "
                    "WHERE id = :fid"
                ),
                {"fid": str(row[0])},
            )
            session.commit()

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("accept_friend_request error: %s", exc)
        raise HTTPException(500, "Accept failed")

    return {"accepted": True, "friend_id": user_id}


@app.post("/friends/{user_id}/reject", status_code=200)
async def reject_friend_request(user_id: str, payload: dict = Depends(verify_token)):
    """
    Reject (delete) a pending friend request from user_id.

    Only the receiver can reject. Deletes the friendship row.
    DB-ready: DELETE FROM friendships.
    """
    me: str = payload["sub"]
    try:
        with SessionLocal() as session:
            row = session.execute(
                text(
                    "SELECT id FROM friendships "
                    "WHERE initiator_id = :them AND receiver_id = :me AND status = 'pending'"
                ),
                {"them": user_id, "me": me},
            ).fetchone()

            if not row:
                raise HTTPException(404, "No pending friend request found from this user")

            session.execute(
                text("DELETE FROM friendships WHERE id = :fid"),
                {"fid": str(row[0])},
            )
            session.commit()

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("reject_friend_request error: %s", exc)
        raise HTTPException(500, "Reject failed")

    return {"rejected": True, "from": user_id}


@app.delete("/friends/{user_id}", status_code=200)
async def remove_friend(user_id: str, payload: dict = Depends(verify_token)):
    """
    Remove an accepted friend (either direction).

    Deletes the friendship row regardless of who initiated it.
    DB-ready: DELETE FROM friendships.
    """
    me: str = payload["sub"]
    try:
        with SessionLocal() as session:
            row = session.execute(
                text(
                    "SELECT id FROM friendships "
                    "WHERE (initiator_id = :me AND receiver_id = :them) "
                    "   OR (initiator_id = :them AND receiver_id = :me) "
                    "  AND status = 'accepted'"
                ),
                {"me": me, "them": user_id},
            ).fetchone()

            if not row:
                raise HTTPException(404, "Friendship not found")

            session.execute(
                text("DELETE FROM friendships WHERE id = :fid"),
                {"fid": str(row[0])},
            )
            session.commit()

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("remove_friend error: %s", exc)
        raise HTTPException(500, "Remove failed")

    return {"removed": True, "user_id": user_id}


@app.post("/friends/{user_id}/block", status_code=200)
async def block_user(user_id: str, payload: dict = Depends(verify_token)):
    """
    Block a user.

    If a friendship exists (any status, either direction) → update it:
      set initiator_id=me, receiver_id=blocked_user, status='blocked'.
    If no friendship → insert a new blocked row.

    DB-ready: UPSERT on friendships.
    """
    me: str = payload["sub"]

    if me == user_id:
        raise HTTPException(400, "Cannot block yourself")

    try:
        with SessionLocal() as session:
            existing = session.execute(
                text(
                    "SELECT id FROM friendships "
                    "WHERE (initiator_id = :me AND receiver_id = :them) "
                    "   OR (initiator_id = :them AND receiver_id = :me)"
                ),
                {"me": me, "them": user_id},
            ).fetchone()

            if existing:
                # Re-orient: blocker is always initiator, blocked is receiver
                session.execute(
                    text(
                        "UPDATE friendships "
                        "SET initiator_id = :me, receiver_id = :them, "
                        "    status = 'blocked', updated_at = NOW() "
                        "WHERE id = :fid"
                    ),
                    {"me": me, "them": user_id, "fid": str(existing[0])},
                )
            else:
                # Check target user exists
                target = session.execute(
                    text("SELECT id FROM users WHERE id = :uid"),
                    {"uid": user_id},
                ).fetchone()
                if not target:
                    raise HTTPException(404, "User not found")

                session.execute(
                    text(
                        "INSERT INTO friendships (initiator_id, receiver_id, status) "
                        "VALUES (:me, :them, 'blocked')"
                    ),
                    {"me": me, "them": user_id},
                )
            session.commit()

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("block_user error: %s", exc)
        raise HTTPException(500, "Block failed")

    return {"blocked": True, "user_id": user_id}


# ── Direct Messages ────────────────────────────────────────────────────────────

class SendMessageRequest(BaseModel):
    """
    POST /messages — send a direct message to another user.

    receiver_id: UUID of the recipient.
    content:     message text; 1–2000 characters (enforced by DB CHECK constraint).
    """
    receiver_id: str
    content: str


@app.post("/messages", status_code=201)
async def send_message(req: SendMessageRequest, payload: dict = Depends(verify_token)):
    """
    Send a direct message to another user.

    Rules:
      - Cannot message yourself.
      - content must be 1–2000 characters.
      - Inserts into direct_messages; returns the new message id.

    DB-ready: INSERT into direct_messages.
    """
    me: str = payload["sub"]

    if me == req.receiver_id:
        raise HTTPException(400, "Cannot send a message to yourself")

    if not req.content or not req.content.strip():
        raise HTTPException(400, "Message content cannot be empty")

    if len(req.content) > 2000:
        raise HTTPException(400, "Message content exceeds 2000 characters")

    try:
        with SessionLocal() as session:
            # Verify receiver exists
            target = session.execute(
                text("SELECT id FROM users WHERE id = :uid"),
                {"uid": req.receiver_id},
            ).fetchone()
            if not target:
                raise HTTPException(404, "Recipient not found")

            row = session.execute(
                text(
                    "INSERT INTO direct_messages (sender_id, receiver_id, content) "
                    "VALUES (:sender, :receiver, :content) "
                    "RETURNING id, created_at"
                ),
                {"sender": me, "receiver": req.receiver_id, "content": req.content},
            ).fetchone()
            session.commit()
            msg_id = str(row[0])
            created_at = row[1].isoformat() if row[1] else None

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("send_message error: %s", exc)
        raise HTTPException(500, "Message send failed")

    return {
        "id":          msg_id,
        "sender_id":   me,
        "receiver_id": req.receiver_id,
        "content":     req.content,
        "created_at":  created_at,
    }


@app.get("/messages/{friend_id}")
async def get_conversation(
    friend_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    payload: dict = Depends(verify_token),
):
    """
    Get the conversation between the authenticated user and friend_id.

    Returns messages ordered oldest-first (ascending created_at).
    Optional ?limit= parameter (1–200, default 50).

    DB-ready: SELECT from direct_messages (both directions).
    """
    me: str = payload["sub"]
    try:
        with SessionLocal() as session:
            rows = session.execute(
                text(
                    "SELECT id, sender_id, receiver_id, content, read, created_at "
                    "FROM direct_messages "
                    "WHERE (sender_id = :me AND receiver_id = :them) "
                    "   OR (sender_id = :them AND receiver_id = :me) "
                    "ORDER BY created_at ASC "
                    "LIMIT :lim"
                ),
                {"me": me, "them": friend_id, "lim": limit},
            ).fetchall()
    except Exception as exc:
        logger.error("get_conversation error: %s", exc)
        raise HTTPException(500, "Failed to load conversation")

    return {
        "messages": [
            {
                "id":          str(r[0]),
                "sender_id":   str(r[1]),
                "receiver_id": str(r[2]),
                "content":     r[3],
                "read":        r[4],
                "created_at":  r[5].isoformat() if r[5] else None,
            }
            for r in rows
        ]
    }


@app.post("/messages/{friend_id}/read", status_code=200)
async def mark_messages_read(friend_id: str, payload: dict = Depends(verify_token)):
    """
    Mark all unread messages from friend_id to the authenticated user as read.

    DB-ready: UPDATE direct_messages SET read = TRUE.
    """
    me: str = payload["sub"]
    try:
        with SessionLocal() as session:
            result = session.execute(
                text(
                    "UPDATE direct_messages "
                    "SET read = TRUE "
                    "WHERE sender_id = :them AND receiver_id = :me AND read = FALSE"
                ),
                {"them": friend_id, "me": me},
            )
            session.commit()
            # rowcount may not be available with all drivers — use 0 as fallback
            updated = getattr(result, "rowcount", 0) or 0

    except Exception as exc:
        logger.error("mark_messages_read error: %s", exc)
        raise HTTPException(500, "Mark read failed")

    return {"marked_read": True, "count": updated}


# ── Stats update path (documentation) ─────────────────────────────────────────
#
# How wins / losses / xp are updated:
#
#   Path A — On-chain (Phase 6, primary):
#     1. Match completes → EscrowClient.declare_winner(match_id, winner_id) is called
#        (triggered from POST /match/result or the RageQuitDetector).
#     2. The ArenaEscrow contract emits WinnerDeclared(matchId, winner).
#     3. A future Oracle listener (Phase 6) subscribes to WinnerDeclared and calls:
#          UPDATE user_stats SET wins = wins + 1 WHERE user_id = :winner_id
#          UPDATE user_stats SET losses = losses + 1 WHERE user_id IN (loser_ids)
#          UPDATE user_stats SET xp = xp + :xp_gain WHERE user_id IN (all_players)
#        XP formula (Phase 6 TODO): win = +100 XP, loss = +25 XP (participation).
#
#   Path B — Direct API (current, for testing / custom matches):
#     POST /match/result  with { winner_id }
#       → currently only updates matches.status + matches.winner_id.
#       → DB-ready: will also UPDATE user_stats when winner_id is confirmed.
#
#   GET /auth/me returns:
#     xp, wins, losses  ← from user_stats (0 for new users)
#     at_balance         ← from users.at_balance (200 for new users)
#
# DB-ready: all stat updates write to user_stats table (user_id FK → users.id).
# CONTRACT-ready: WinnerDeclared event listener triggers stat writes.


# ── Match history ──────────────────────────────────────────────────────────────

@app.get("/matches/history")
async def match_history(
    game: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    payload: dict = Depends(verify_token),
):
    """
    Return the authenticated user's match history from DB.

    Optional filters:
      ?game=CS2|Valorant  — filter by game
      ?status=completed|cancelled|disputed  — filter by status
      ?limit=N            — max rows (1–100, default 20)

    Returns matches ordered newest-first, including opponent info and result.
    DB-ready: matches JOIN match_players JOIN users.
    """
    user_id: str = payload["sub"]

    conditions = ["mp.user_id = :uid", "m.status != 'waiting'", "m.status != 'in_progress'"]
    params: dict = {"uid": user_id, "lim": limit}

    if game:
        conditions.append("m.game = :game")
        params["game"] = _normalize_game(game)
    if status:
        conditions.append("m.status = :status")
        params["status"] = status

    where = " AND ".join(conditions)

    try:
        with SessionLocal() as session:
            rows = session.execute(
                text(f"""
                    SELECT
                        m.id,
                        m.game,
                        m.mode,
                        m.status,
                        m.bet_amount,
                        m.winner_id,
                        m.created_at,
                        m.ended_at,
                        -- opponent: first other player in the match
                        (SELECT u2.username
                         FROM match_players mp2
                         JOIN users u2 ON u2.id = mp2.user_id
                         WHERE mp2.match_id = m.id AND mp2.user_id != :uid
                         LIMIT 1),
                        (SELECT u2.id
                         FROM match_players mp2
                         JOIN users u2 ON u2.id = mp2.user_id
                         WHERE mp2.match_id = m.id AND mp2.user_id != :uid
                         LIMIT 1),
                        (SELECT u2.avatar
                         FROM match_players mp2
                         JOIN users u2 ON u2.id = mp2.user_id
                         WHERE mp2.match_id = m.id AND mp2.user_id != :uid
                         LIMIT 1)
                    FROM matches m
                    JOIN match_players mp ON mp.match_id = m.id
                    WHERE {where}
                    ORDER BY m.created_at DESC
                    LIMIT :lim
                """),
                params,
            ).fetchall()
    except Exception as exc:
        logger.error("match_history error: %s", exc)
        raise HTTPException(500, "Failed to load match history")

    return {
        "matches": [
            {
                "id":              str(r[0]),
                "game":            r[1],
                "mode":            r[2],
                "status":          r[3],
                "bet_amount":      float(r[4]) if r[4] is not None else 0.0,
                "result":          (
                    "win"  if r[5] and str(r[5]) == user_id else
                    "loss" if r[5] else
                    "draw"
                ),
                "winner_id":       str(r[5]) if r[5] else None,
                "created_at":      r[6].isoformat() if r[6] else None,
                "ended_at":        r[7].isoformat() if r[7] else None,
                "opponent":        r[8],
                "opponent_id":     str(r[9])  if r[9]  else None,
                "opponent_avatar": r[10],
            }
            for r in rows
        ]
    }


# ── Available matches (lobby) ──────────────────────────────────────────────────

@app.get("/matches")
async def list_matches(
    game: str | None = Query(default=None),
    mode: str | None = Query(default=None),
    match_type: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    token: dict | None = Depends(optional_token),
):
    """
    List open (waiting) matches available to join.

    Optional filters:
      ?game=CS2|Valorant     — filter by game
      ?mode=1v1|2v2|4v4|5v5  — filter by mode
      ?match_type=public|custom
      ?limit=N               — max rows (1–100, default 20)

    Returns matches with host info and current player count.
    DB-ready: matches JOIN match_players JOIN users.
    """
    conditions = ["m.status = 'waiting'"]
    params: dict = {"lim": limit}

    if game:
        conditions.append("m.game = :game")
        params["game"] = _normalize_game(game)
    if mode:
        conditions.append("m.mode = :mode")
        params["mode"] = mode.strip()
    if match_type:
        conditions.append("m.type = :mtype")
        params["mtype"] = match_type.strip()

    where = " AND ".join(conditions)

    try:
        with SessionLocal() as session:
            rows = session.execute(
                text(f"""
                    SELECT
                        m.id,
                        m.game,
                        m.mode,
                        m.type,
                        m.bet_amount,
                        m.status,
                        m.code,
                        m.created_at,
                        m.max_players,
                        u.username   AS host_username,
                        u.id         AS host_id,
                        u.avatar     AS host_avatar,
                        COUNT(mp.user_id) AS player_count
                    FROM matches m
                    JOIN users u ON u.id = m.host_id
                    LEFT JOIN match_players mp ON mp.match_id = m.id
                    WHERE {where}
                    GROUP BY m.id, u.id
                    ORDER BY m.created_at DESC
                    LIMIT :lim
                """),
                params,
            ).fetchall()
    except Exception as exc:
        logger.error("list_matches error: %s", exc)
        raise HTTPException(500, "Failed to load matches")

    return {
        "matches": [
            {
                "id":             str(r[0]),
                "game":           r[1],
                "mode":           r[2],
                "type":           r[3],
                "bet_amount":     float(r[4]) if r[4] is not None else 0.0,
                "status":         r[5],
                "code":           r[6],
                "created_at":     r[7].isoformat() if r[7] else None,
                "max_players":    r[8],
                "host_username":  r[9],
                "host_id":        str(r[10]) if r[10] else None,
                "host_avatar":    r[11],
                "player_count":   int(r[12]),
            }
            for r in rows
        ]
    }


# ── Leaderboard ────────────────────────────────────────────────────────────────

@app.get("/leaderboard")
async def leaderboard(
    game: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    token: dict | None = Depends(optional_token),
):
    """
    Return the top players ranked by wins then xp.

    Optional filters:
      ?game=CS2|Valorant  — per-game leaderboard (filtered by matches played in that game)
      ?limit=N            — top N players (1–200, default 50)

    Returns user profile fields + stats for leaderboard display.
    DB-ready: users JOIN user_stats ORDER BY wins DESC, xp DESC.
    """
    params: dict = {"lim": limit}

    # Per-game filter: only include users who have played ≥1 match in that game.
    game_filter = ""
    if game:
        game_filter = """
            AND u.id IN (
                SELECT DISTINCT mp.user_id FROM match_players mp
                JOIN matches m ON m.id = mp.match_id
                WHERE m.game = :game
            )
        """
        params["game"] = _normalize_game(game)

    try:
        with SessionLocal() as session:
            rows = session.execute(
                text(f"""
                    SELECT
                        u.id,
                        u.username,
                        u.arena_id,
                        u.avatar,
                        u.equipped_badge_icon,
                        u.rank,
                        COALESCE(s.wins,    0) AS wins,
                        COALESCE(s.losses,  0) AS losses,
                        COALESCE(s.matches, 0) AS matches,
                        COALESCE(s.win_rate, 0) AS win_rate,
                        COALESCE(s.xp,      0) AS xp,
                        COALESCE(s.total_earnings, 0) AS total_earnings
                    FROM users u
                    LEFT JOIN user_stats s ON s.user_id = u.id
                    WHERE TRUE {game_filter}
                    ORDER BY wins DESC, xp DESC
                    LIMIT :lim
                """),
                params,
            ).fetchall()
    except Exception as exc:
        logger.error("leaderboard error: %s", exc)
        raise HTTPException(500, "Failed to load leaderboard")

    return {
        "leaderboard": [
            {
                "rank":            idx + 1,
                "user_id":         str(r[0]),
                "username":        r[1],
                "arena_id":        r[2],
                "avatar":          r[3],
                "equipped_badge":  r[4],
                "tier":            r[5],
                "wins":            int(r[6]),
                "losses":          int(r[7]),
                "matches":         int(r[8]),
                "win_rate":        float(r[9]),
                "xp":              int(r[10]),
                "total_earnings":  float(r[11]),
            }
            for idx, r in enumerate(rows)
        ]
    }


# ── Player search ──────────────────────────────────────────────────────────────

@app.get("/players")
async def search_players(
    q: str | None = Query(default=None),
    game: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    token: dict | None = Depends(optional_token),
):
    """
    Search players by username or ArenaID.

    Query params:
      ?q=<string>           — case-insensitive search on username / arena_id
      ?game=CS2|Valorant    — filter to players who have a steam_id (CS2) or riot_id (Valorant)
      ?limit=N              — max results (1–50, default 20)

    Returns public profile fields + summary stats (no email, no wallet).
    DB-ready: users LEFT JOIN user_stats WHERE username ILIKE or arena_id ILIKE.
    """
    conditions: list[str] = []
    params: dict = {"lim": limit}

    if q and q.strip():
        q_clean = q.strip()
        conditions.append(
            "(u.username ILIKE :q OR u.arena_id ILIKE :q)"
        )
        params["q"] = f"%{q_clean}%"

    if game:
        g = _normalize_game(game)
        if g == "CS2":
            conditions.append("u.steam_id IS NOT NULL")
        elif g == "Valorant":
            conditions.append("u.riot_id IS NOT NULL")

    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    try:
        with SessionLocal() as session:
            rows = session.execute(
                text(f"""
                    SELECT
                        u.id,
                        u.username,
                        u.arena_id,
                        u.avatar,
                        u.equipped_badge_icon,
                        u.rank,
                        COALESCE(s.wins,    0),
                        COALESCE(s.losses,  0),
                        COALESCE(s.matches, 0),
                        COALESCE(s.win_rate, 0),
                        COALESCE(s.xp,      0)
                    FROM users u
                    LEFT JOIN user_stats s ON s.user_id = u.id
                    {where}
                    ORDER BY s.wins DESC NULLS LAST
                    LIMIT :lim
                """),
                params,
            ).fetchall()
    except Exception as exc:
        logger.error("search_players error: %s", exc)
        raise HTTPException(500, "Player search failed")

    return {
        "players": [
            {
                "user_id":        str(r[0]),
                "username":       r[1],
                "arena_id":       r[2],
                "avatar":         r[3],
                "equipped_badge": r[4],
                "rank":           r[5],
                "wins":           int(r[6]),
                "losses":         int(r[7]),
                "matches":        int(r[8]),
                "win_rate":       float(r[9]),
                "xp":             int(r[10]),
            }
            for r in rows
        ]
    }


# ── Public player profile ──────────────────────────────────────────────────────

@app.get("/players/{user_id}")
async def get_player_profile(
    user_id: str,
    token: dict | None = Depends(optional_token),
):
    """
    Fetch a public player profile by user_id.

    Returns public fields only — no email, no wallet address.
    DB-ready: users LEFT JOIN user_stats.
    """
    try:
        with SessionLocal() as session:
            row = session.execute(
                text("""
                    SELECT
                        u.id,
                        u.username,
                        u.arena_id,
                        u.avatar,
                        u.avatar_bg,
                        u.equipped_badge_icon,
                        u.rank,
                        COALESCE(s.wins,    0),
                        COALESCE(s.losses,  0),
                        COALESCE(s.matches, 0),
                        COALESCE(s.win_rate, 0),
                        COALESCE(s.xp,      0),
                        COALESCE(s.total_earnings, 0),
                        u.forge_unlocked_item_ids,
                        u.vip_expires_at,
                        u.steam_id,
                        u.riot_id
                    FROM users u
                    LEFT JOIN user_stats s ON s.user_id = u.id
                    WHERE u.id = :uid
                """),
                {"uid": user_id},
            ).fetchone()
    except Exception as exc:
        logger.error("get_player_profile error: %s", exc)
        raise HTTPException(500, "Profile fetch failed")

    if not row:
        raise HTTPException(404, "Player not found")

    return {
        "user_id":              str(row[0]),
        "username":             row[1],
        "arena_id":             row[2],
        "avatar":               row[3],
        "avatar_bg":            row[4],
        "equipped_badge_icon":  row[5],
        "rank":                 row[6],
        "wins":                 int(row[7]),
        "losses":               int(row[8]),
        "matches":              int(row[9]),
        "win_rate":             float(row[10]),
        "xp":                   int(row[11]),
        "total_earnings":       float(row[12]),
        "forge_unlocked_item_ids": list(row[13]) if row[13] else [],
        "vip_expires_at":       row[14].isoformat() if row[14] else None,
        "has_steam":            row[15] is not None,
        "has_riot":             row[16] is not None,
    }


# ── Inbox ──────────────────────────────────────────────────────────────────────
#
# inbox_messages: formal user-to-user messages with a subject line.
# Different from direct_messages (DMs): inbox = notifications / formal comms.
# System auto-notifications (match won/lost) are sent here by the engine itself
# using the ARENA_SYSTEM_USER_ID env var (a seeded platform user UUID).
# If ARENA_SYSTEM_USER_ID is not set, auto-notifications are silently skipped.
#
# DB-ready: inbox_messages table (init.sql).
# Cursor connects: inboxStore.ts → these endpoints.

_SYSTEM_USER_ID: str | None = os.getenv("ARENA_SYSTEM_USER_ID")


def _send_system_inbox(session, receiver_id: str, subject: str, content: str) -> None:
    """
    Insert a system notification into inbox_messages.
    Silently skipped when ARENA_SYSTEM_USER_ID is not configured.
    DB-ready: requires a seeded 'arena_system' user row in users table.
    """
    if not _SYSTEM_USER_ID:
        return
    try:
        session.execute(
            text(
                "INSERT INTO inbox_messages (sender_id, receiver_id, subject, content) "
                "VALUES (:sid, :rid, :sub, :con)"
            ),
            {
                "sid": _SYSTEM_USER_ID,
                "rid": receiver_id,
                "sub": subject,
                "con": content,
            },
        )
    except Exception as exc:
        logger.warning("_send_system_inbox failed (non-fatal): %s", exc)


class SendInboxRequest(BaseModel):
    """
    POST /inbox — send a formal inbox message to another user.

    receiver_id: UUID of the recipient.
    subject:     up to 200 characters.
    content:     1–5000 characters.
    """
    receiver_id: str
    subject: str
    content: str


@app.post("/inbox", status_code=201)
async def send_inbox_message(req: SendInboxRequest, payload: dict = Depends(verify_token)):
    """
    Send a formal inbox message (with subject) to another user.

    Rules:
      - Cannot message yourself.
      - subject: 1–200 chars; content: 1–5000 chars.
      - Receiver must exist.

    DB-ready: INSERT into inbox_messages.
    """
    me: str = payload["sub"]

    if me == req.receiver_id:
        raise HTTPException(400, "Cannot send an inbox message to yourself")

    subject = req.subject.strip()
    content = req.content.strip()

    if not subject:
        raise HTTPException(400, "Subject cannot be empty")
    if len(subject) > 200:
        raise HTTPException(400, "Subject exceeds 200 characters")
    if not content:
        raise HTTPException(400, "Content cannot be empty")
    if len(content) > 5000:
        raise HTTPException(400, "Content exceeds 5000 characters")

    try:
        with SessionLocal() as session:
            target = session.execute(
                text("SELECT id FROM users WHERE id = :uid"),
                {"uid": req.receiver_id},
            ).fetchone()
            if not target:
                raise HTTPException(404, "Recipient not found")

            row = session.execute(
                text(
                    "INSERT INTO inbox_messages (sender_id, receiver_id, subject, content) "
                    "VALUES (:sid, :rid, :sub, :con) "
                    "RETURNING id, created_at"
                ),
                {
                    "sid": me,
                    "rid": req.receiver_id,
                    "sub": subject,
                    "con": content,
                },
            ).fetchone()
            session.commit()
            msg_id    = str(row[0])
            created_at = row[1].isoformat() if row[1] else None

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("send_inbox_message error: %s", exc)
        raise HTTPException(500, "Send failed")

    return {
        "id":          msg_id,
        "sender_id":   me,
        "receiver_id": req.receiver_id,
        "subject":     subject,
        "created_at":  created_at,
    }


@app.get("/inbox")
async def get_inbox(
    unread_only: bool = Query(default=False),
    limit: int = Query(default=30, ge=1, le=100),
    payload: dict = Depends(verify_token),
):
    """
    Return the authenticated user's inbox messages (not deleted), newest first.

    Optional:
      ?unread_only=true  — only unread messages
      ?limit=N           — max rows (1–100, default 30)

    Returns sender username + avatar alongside message fields.
    DB-ready: inbox_messages JOIN users.
    """
    me: str = payload["sub"]
    params: dict = {"me": me, "lim": limit}
    extra = "AND im.read = FALSE" if unread_only else ""

    try:
        with SessionLocal() as session:
            rows = session.execute(
                text(f"""
                    SELECT
                        im.id,
                        im.subject,
                        im.content,
                        im.read,
                        im.created_at,
                        u.id       AS sender_id,
                        u.username AS sender_username,
                        u.avatar   AS sender_avatar,
                        u.arena_id AS sender_arena_id
                    FROM inbox_messages im
                    JOIN users u ON u.id = im.sender_id
                    WHERE im.receiver_id = :me
                      AND im.deleted = FALSE
                      {extra}
                    ORDER BY im.created_at DESC
                    LIMIT :lim
                """),
                params,
            ).fetchall()
    except Exception as exc:
        logger.error("get_inbox error: %s", exc)
        raise HTTPException(500, "Failed to load inbox")

    return {
        "messages": [
            {
                "id":              str(r[0]),
                "subject":         r[1],
                "content":         r[2],
                "read":            r[3],
                "created_at":      r[4].isoformat() if r[4] else None,
                "sender_id":       str(r[5]),
                "sender_username": r[6],
                "sender_avatar":   r[7],
                "sender_arena_id": r[8],
            }
            for r in rows
        ]
    }


@app.get("/inbox/unread-count")
async def inbox_unread_count(payload: dict = Depends(verify_token)):
    """
    Return the count of unread inbox messages for the badge indicator.
    DB-ready: COUNT from inbox_messages.
    """
    me: str = payload["sub"]
    try:
        with SessionLocal() as session:
            row = session.execute(
                text(
                    "SELECT COUNT(*) FROM inbox_messages "
                    "WHERE receiver_id = :me AND read = FALSE AND deleted = FALSE"
                ),
                {"me": me},
            ).fetchone()
            count = int(row[0]) if row else 0
    except Exception as exc:
        logger.error("inbox_unread_count error: %s", exc)
        raise HTTPException(500, "Failed to get count")

    return {"unread_count": count}


@app.patch("/inbox/{message_id}/read", status_code=200)
async def mark_inbox_read(message_id: str, payload: dict = Depends(verify_token)):
    """
    Mark a single inbox message as read.

    Only the receiver can mark their own messages.
    DB-ready: UPDATE inbox_messages SET read = TRUE.
    """
    me: str = payload["sub"]
    try:
        with SessionLocal() as session:
            row = session.execute(
                text(
                    "SELECT id FROM inbox_messages "
                    "WHERE id = :mid AND receiver_id = :me AND deleted = FALSE"
                ),
                {"mid": message_id, "me": me},
            ).fetchone()
            if not row:
                raise HTTPException(404, "Message not found")

            session.execute(
                text("UPDATE inbox_messages SET read = TRUE WHERE id = :mid"),
                {"mid": message_id},
            )
            session.commit()

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("mark_inbox_read error: %s", exc)
        raise HTTPException(500, "Update failed")

    return {"read": True, "id": message_id}


@app.patch("/inbox/read-all", status_code=200)
async def mark_all_inbox_read(payload: dict = Depends(verify_token)):
    """
    Mark ALL unread inbox messages as read for the authenticated user.
    DB-ready: UPDATE inbox_messages SET read = TRUE WHERE receiver_id = :me.
    """
    me: str = payload["sub"]
    try:
        with SessionLocal() as session:
            result = session.execute(
                text(
                    "UPDATE inbox_messages SET read = TRUE "
                    "WHERE receiver_id = :me AND read = FALSE AND deleted = FALSE"
                ),
                {"me": me},
            )
            session.commit()
            updated = getattr(result, "rowcount", 0) or 0
    except Exception as exc:
        logger.error("mark_all_inbox_read error: %s", exc)
        raise HTTPException(500, "Update failed")

    return {"marked_read": updated}


@app.delete("/inbox/{message_id}", status_code=200)
async def delete_inbox_message(message_id: str, payload: dict = Depends(verify_token)):
    """
    Soft-delete an inbox message (sets deleted = TRUE).

    Only the receiver can delete their own messages.
    DB-ready: UPDATE inbox_messages SET deleted = TRUE.
    """
    me: str = payload["sub"]
    try:
        with SessionLocal() as session:
            row = session.execute(
                text(
                    "SELECT id FROM inbox_messages "
                    "WHERE id = :mid AND receiver_id = :me AND deleted = FALSE"
                ),
                {"mid": message_id, "me": me},
            ).fetchone()
            if not row:
                raise HTTPException(404, "Message not found")

            session.execute(
                text("UPDATE inbox_messages SET deleted = TRUE WHERE id = :mid"),
                {"mid": message_id},
            )
            session.commit()

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("delete_inbox_message error: %s", exc)
        raise HTTPException(500, "Delete failed")

    return {"deleted": True, "id": message_id}


# ── Admin — Oracle / EscrowClient ─────────────────────────────────────────────


@app.get("/admin/oracle/status")
async def admin_oracle_status(payload: dict = Depends(require_admin)):
    """
    Return the current state of the EscrowClient oracle listener.

    Fields:
      - listener_active: bool   — True when the background task is running
      - last_block: int         — last processed block stored in oracle_sync_state
      - last_sync_at: str|None  — ISO timestamp of last UPSERT
      - escrow_enabled: bool    — True when EscrowClient was initialised

    DB-ready: reads oracle_sync_state singleton row.
    """
    escrow_enabled = _escrow_client is not None
    listener_active = (
        _listener_task is not None
        and not _listener_task.done()
    )

    last_block: int = 0
    last_sync_at: str | None = None
    try:
        with SessionLocal() as session:
            row = session.execute(
                text(
                    "SELECT last_block, last_sync_at "
                    "FROM oracle_sync_state WHERE id = 'singleton'"
                )
            ).fetchone()
            if row:
                last_block = int(row[0])
                last_sync_at = row[1].isoformat() if row[1] else None
    except Exception as exc:
        logger.warning("admin_oracle_status DB read failed: %s", exc)

    return {
        "escrow_enabled": escrow_enabled,
        "listener_active": listener_active,
        "last_block": last_block,
        "last_sync_at": last_sync_at,
    }


@app.post("/admin/oracle/sync", status_code=200)
async def admin_oracle_sync(payload: dict = Depends(require_admin)):
    """
    Manually trigger a one-off event scan from last_block to current chain head.

    Useful after downtime or to force an immediate catch-up without waiting
    for the next poll interval. Non-destructive — last_block is updated after.

    DB-ready: reads oracle_sync_state, calls EscrowClient.process_events(),
              then upserts updated last_block.
    """
    if not _escrow_client:
        raise HTTPException(503, "EscrowClient not available — blockchain env vars not set")

    try:
        saved_block = _escrow_client._load_last_block()
        current_block = _escrow_client._w3.eth.block_number
        from_block = (saved_block + 1) if saved_block > 0 else max(0, current_block - 100)

        if from_block > current_block:
            return {"synced": True, "events_processed": 0, "from_block": from_block, "to_block": current_block}

        n = _escrow_client.process_events(from_block, current_block)
        _escrow_client._save_last_block(current_block)

        logger.info(
            "admin_oracle_sync: processed %d events | blocks %d→%d",
            n, from_block, current_block,
        )
        return {
            "synced": True,
            "events_processed": n,
            "from_block": from_block,
            "to_block": current_block,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("admin_oracle_sync error: %s", exc)
        raise HTTPException(500, "Oracle sync failed")
