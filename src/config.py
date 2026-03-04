import os
from dotenv import load_dotenv

load_dotenv()

PRIVATE_KEY = os.getenv("PRIVATE_KEY")
WALLET_ADDRESS = os.getenv("WALLET_ADDRESS")
BINANCE_API_KEY = os.getenv("BINANCE_API_KEY")
BINANCE_SECRET = os.getenv("BINANCE_SECRET")
SSH_KEY_PATH = os.getenv("SSH_KEY_PATH")
ORACLE_API_KEY = os.getenv("ORACLE_API_KEY")
DATABASE_URL = os.getenv("DATABASE_URL")
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")

REQUIRED_VARS = [
    "SSH_KEY_PATH",
    "PRIVATE_KEY",
    "WALLET_ADDRESS",
    "BINANCE_API_KEY",
    "BINANCE_SECRET",
    "ORACLE_API_KEY",
    "DATABASE_URL",
    "ENVIRONMENT"
]

def validate_env():
    missing = [var for var in REQUIRED_VARS if not os.getenv(var)]
    if missing:
        raise EnvironmentError(
            f"Missing required environment variables: {', '.join(missing)}"
        )
    print("All environment variables loaded successfully.")

if __name__ == "__main__":
    validate_env()