"""
ARENA Engine — Configuration
Loads environment variables with validation.
"""

import os
from dotenv import load_dotenv

load_dotenv()

# ── Database ──────────────────────────────────────────────────
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://arena_admin:arena_secret_change_me@arena-db:5432/arena")

# ── Crypto / Wallet ──────────────────────────────────────────
PRIVATE_KEY = os.getenv("PRIVATE_KEY")
WALLET_ADDRESS = os.getenv("WALLET_ADDRESS")

# ── Binance API ──────────────────────────────────────────────
BINANCE_API_KEY = os.getenv("BINANCE_API_KEY")
BINANCE_SECRET = os.getenv("BINANCE_SECRET")

# ── Blockchain / Smart Contract ──────────────────────────────
BLOCKCHAIN_RPC_URL = os.getenv("BLOCKCHAIN_RPC_URL")   # e.g. BSC Testnet RPC
CONTRACT_ADDRESS   = os.getenv("CONTRACT_ADDRESS")      # ArenaEscrow deployed address
CHAIN_ID           = int(os.getenv("CHAIN_ID", "97"))   # 97 = BSC Testnet, 56 = BSC Mainnet

# ── Infrastructure ───────────────────────────────────────────
SSH_KEY_PATH = os.getenv("SSH_KEY_PATH")
ORACLE_API_KEY = os.getenv("ORACLE_API_KEY")

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
