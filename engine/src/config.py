"""
ARENA Engine — Configuration
Loads environment variables with validation.
"""

import os
from urllib.parse import quote_plus

from dotenv import load_dotenv

load_dotenv()


def build_postgresql_url(
    user: str,
    password: str,
    host: str,
    port: str,
    database: str,
) -> str:
    """Assemble a SQLAlchemy Postgres URL; user/password are percent-encoded."""
    return (
        f"postgresql://{quote_plus(user)}:{quote_plus(password)}"
        f"@{host}:{port}/{database}"
    )


def _database_url_from_components() -> str | None:
    """Build a SQLAlchemy URL from POSTGRES_* / DB_PASSWORD (password URL-encoded)."""
    pwd = (os.getenv("POSTGRES_PASSWORD") or os.getenv("DB_PASSWORD") or "").strip()
    if not pwd:
        return None
    user = (os.getenv("POSTGRES_USER") or "arena_admin").strip()
    host = (os.getenv("POSTGRES_HOST") or "localhost").strip()
    port = (os.getenv("POSTGRES_PORT") or "5432").strip()
    db = (os.getenv("POSTGRES_DB") or "arena").strip()
    return build_postgresql_url(user, pwd, host, port, db)


def _resolve_database_url() -> str:
    """
    Prefer explicit DATABASE_URL when set (non-empty). Otherwise build from
    POSTGRES_PASSWORD or DB_PASSWORD so characters like / @ : # do not break the URL.
    """
    raw = (os.getenv("DATABASE_URL") or "").strip()
    if raw:
        return raw
    built = _database_url_from_components()
    if built:
        return built
    return "postgresql://arena_admin:arena_secret_change_me@arena-db:5432/arena"


# ── Database ──────────────────────────────────────────────────
DATABASE_URL = _resolve_database_url()
# Keep getenv() and SQLAlchemy helpers aligned after building from components.
os.environ["DATABASE_URL"] = DATABASE_URL

# ── Crypto / Wallet ──────────────────────────────────────────
PRIVATE_KEY = os.getenv("PRIVATE_KEY")
WALLET_ADDRESS = os.getenv("WALLET_ADDRESS")

# ── Binance API ──────────────────────────────────────────────
BINANCE_API_KEY = os.getenv("BINANCE_API_KEY")
BINANCE_SECRET = os.getenv("BINANCE_SECRET")

# ── Blockchain / Smart Contract ──────────────────────────────
BLOCKCHAIN_RPC_URL    = os.getenv("BLOCKCHAIN_RPC_URL")          # e.g. BSC Testnet RPC
CONTRACT_ADDRESS      = os.getenv("CONTRACT_ADDRESS")             # ArenaEscrow deployed address
CHAIN_ID              = int(os.getenv("CHAIN_ID", "97"))          # 97 = BSC Testnet, 56 = BSC Mainnet
USDT_CONTRACT_ADDRESS = os.getenv("USDT_CONTRACT_ADDRESS")        # ERC20 USDT on BSC
AT_PER_USDT           = int(os.getenv("AT_PER_USDT", "10"))       # Arena Tokens credited per 1 USDT

# ── AT Withdrawal ─────────────────────────────────────────────
# Rate: 1050 AT = $10 USDT  →  AT_PER_USDT_WITHDRAW = 105 AT per $1
# Amounts must be multiples of 1050 (AT_PER_USDT_WITHDRAW * 10).
# Daily cap: 10,000 AT maximum withdrawal per user per day
AT_PER_USDT_WITHDRAW    = int(os.getenv("AT_PER_USDT_WITHDRAW", "105"))      # AT per $1 → 1050 AT = $10
AT_DAILY_WITHDRAW_LIMIT = int(os.getenv("AT_DAILY_WITHDRAW_LIMIT", "10000")) # max AT per day
PLATFORM_WALLET_ADDRESS       = os.getenv("PLATFORM_WALLET_ADDRESS", "")              # Arena platform wallet (BNB sender)

# ── Infrastructure ───────────────────────────────────────────
SSH_KEY_PATH = os.getenv("SSH_KEY_PATH")
ORACLE_API_KEY = os.getenv("ORACLE_API_KEY")

# ── Steam ─────────────────────────────────────────────────────
# STEAM_API_KEY: optional — if set, validates Steam ID existence at registration.
# ENGINE_BASE_URL: public URL of this engine; Steam redirects back to it.
# FRONTEND_URL:   public URL of the React frontend; engine redirects after auth.
STEAM_API_KEY   = os.getenv("STEAM_API_KEY")
ENGINE_BASE_URL = os.getenv("ENGINE_BASE_URL", "http://localhost:8000")
FRONTEND_URL    = os.getenv("FRONTEND_URL",    "http://localhost:5173")

# ── Public Match Pool ────────────────────────────────────────
# UUID of the system user that owns auto-created public rooms.
# Must match the UUID inserted in migration 041-public-match-pool.sql.
ARENA_SYSTEM_USER_ID = (
    os.getenv("ARENA_SYSTEM_USER_ID") or "00000000-0000-0000-0000-000000000001"
).strip()
# How often (seconds) the pool manager checks and refills open rooms.
POOL_MANAGER_INTERVAL = int(os.getenv("POOL_MANAGER_INTERVAL", "30"))

# ── Discord (optional — lobby room alerts) ───────────────────
DISCORD_LOBBY_WEBHOOK_URL = os.getenv("DISCORD_LOBBY_WEBHOOK_URL", "")

# ── App Settings ─────────────────────────────────────────────
API_SECRET = os.getenv("API_SECRET", "change_me_in_production")
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
SCREENSHOT_INTERVAL = int(os.getenv("SCREENSHOT_INTERVAL", "5"))

# ── Arena Desktop Client ──────────────────────────────────────
CLIENT_VERSION        = os.getenv("CLIENT_VERSION", "0.1.0")
PROCESS_POLL_INTERVAL = int(os.getenv("PROCESS_POLL_INTERVAL", "3"))   # seconds between process scans
HEARTBEAT_INTERVAL    = int(os.getenv("HEARTBEAT_INTERVAL", "15"))     # seconds between API pings
# Minimum client version accepted as "version_ok=True" in GET /client/status.
# Bump this when a breaking engine ↔ client protocol change ships.
MIN_CLIENT_VERSION    = os.getenv("MIN_CLIENT_VERSION", "1.0.0")

REQUIRED_VARS = [
    "DATABASE_URL",
    "API_SECRET",
]

OPTIONAL_VARS = [
    "PRIVATE_KEY",
    "WALLET_ADDRESS",
    "BINANCE_API_KEY",
    "BINANCE_SECRET",
    "BLOCKCHAIN_RPC_URL",
    "CONTRACT_ADDRESS",
    "USDT_CONTRACT_ADDRESS",
    "SSH_KEY_PATH",
    "ORACLE_API_KEY",
]


def validate_env():
    missing = [var for var in REQUIRED_VARS if not os.getenv(var)]
    if missing:
        raise EnvironmentError(
            f"Missing required environment variables: {', '.join(missing)}"
        )

    optional_missing = [var for var in OPTIONAL_VARS if not os.getenv(var)]
    if optional_missing:
        print(f"⚠️  Optional vars not set: {', '.join(optional_missing)}")

    print("✅ All required environment variables loaded successfully.")


if __name__ == "__main__":
    validate_env()
