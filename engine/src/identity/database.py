"""
ARENA Engine — Player Identity Database
Stores the mapping: wallet_address → steam_id → steam_display_name → game
Uses SQLite (local file, no server needed).
Also manages the blacklist for banned players and the dispute queue.
"""

from __future__ import annotations

import re
import sqlite3
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, List

log = logging.getLogger("identity.database")

# ── Default DB path: engine/data/players.db ──────────────────────────────────
_DATA_DIR        = Path(__file__).parent.parent.parent / "data"
_DEFAULT_DB_PATH = str(_DATA_DIR / "players.db")

# ── Validation patterns ───────────────────────────────────────────────────────
_WALLET_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")   # Ethereum: 0x + 40 hex chars
_STEAM_RE  = re.compile(r"^\d{17}$")               # Steam ID: exactly 17 digits


# ── Dispute dataclass ────────────────────────────────────────────────────────
@dataclass
class Dispute:
    wallet_address: str   # who is appealing
    reason:         str   # what they wrote
    status:         str   # "open" | "reviewing" | "escalated" | "resolved"
    resolution:     str = ""   # "approved" | "rejected" | "refund" | "void" | "player_a_wins" | "player_b_wins"
    admin_note:     str = ""   # what the admin wrote when deciding


# ── Player dataclass ─────────────────────────────────────────────────────────
@dataclass
class Player:
    wallet_address: str   # primary key  e.g. "0xAbC...123"
    steam_id:       str   # e.g. "76561198012345678"
    steam_display_name: str   # e.g. "daniel_cs" — the name OCR reads from the scoreboard
    game:           str   # e.g. "CS2" | "Valorant" | "Fortnite"


# ── Validation helpers ────────────────────────────────────────────────────────
def _validate_wallet(wallet: str) -> None:
    if not _WALLET_RE.match(wallet):
        raise ValueError(f"Invalid wallet address: '{wallet}' — must be 0x + 40 hex chars")

def _validate_steam(steam_id: str) -> None:
    if not _STEAM_RE.match(steam_id):
        raise ValueError(f"Invalid Steam ID: '{steam_id}' — must be exactly 17 digits")


# ── Database class ────────────────────────────────────────────────────────────
class PlayerDatabase:
    """
    Simple SQLite-backed store for player identity records.
    Each instance manages one .db file.
    """

    def __init__(self, db_path: str = _DEFAULT_DB_PATH):
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row   # rows behave like dicts
        self._create_table()
        log.info("PlayerDatabase ready | path=%s", self.db_path)

    # ── Internal ──────────────────────────────────────────────────────────────
    def _create_table(self) -> None:
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS players (
                wallet_address TEXT PRIMARY KEY,
                steam_id       TEXT NOT NULL UNIQUE,
                steam_display_name TEXT NOT NULL,
                game           TEXT NOT NULL
            )
        """)
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS blacklist (
                wallet_address TEXT PRIMARY KEY,
                reason         TEXT NOT NULL DEFAULT 'smurf'
            )
        """)
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS disputes (
                wallet_address TEXT PRIMARY KEY,
                reason         TEXT NOT NULL,
                status         TEXT NOT NULL DEFAULT 'open',
                resolution     TEXT NOT NULL DEFAULT '',
                admin_note     TEXT NOT NULL DEFAULT ''
            )
        """)
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS match_log (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                wallet_address TEXT NOT NULL,
                played_at      TEXT NOT NULL DEFAULT (date('now'))
            )
        """)
        self._conn.commit()

    # ── CRUD ──────────────────────────────────────────────────────────────────
    def add(self, player: Player) -> None:
        """Add a new player. Raises ValueError on bad data or duplicate wallet."""
        _validate_wallet(player.wallet_address)
        _validate_steam(player.steam_id)

        # Check wallet duplicate first for a clear error message
        if self.get(player.wallet_address) is not None:
            raise ValueError(f"Player with wallet '{player.wallet_address}' already exists")

        try:
            self._conn.execute(
                "INSERT INTO players (wallet_address, steam_id, steam_display_name, game) VALUES (?, ?, ?, ?)",
                (player.wallet_address, player.steam_id, player.steam_display_name, player.game),
            )
            self._conn.commit()
            log.info("add | wallet=%s steam=%s display_name=%s game=%s",
                     player.wallet_address, player.steam_id, player.steam_display_name, player.game)
        except sqlite3.IntegrityError:
            raise ValueError(f"Steam ID '{player.steam_id}' is already registered with another wallet")

    def get(self, wallet_address: str) -> Optional[Player]:
        """Fetch a player by wallet address. Returns None if not found."""
        _validate_wallet(wallet_address)
        row = self._conn.execute(
            "SELECT * FROM players WHERE wallet_address = ?", (wallet_address,)
        ).fetchone()
        if row is None:
            log.info("get | wallet=%s → not found", wallet_address)
            return None
        log.info("get | wallet=%s → found display_name=%s", wallet_address, row["steam_display_name"])
        return Player(
            wallet_address=row["wallet_address"],
            steam_id=row["steam_id"],
            steam_display_name=row["steam_display_name"],
            game=row["game"],
        )

    def update(self, player: Player) -> None:
        """Update an existing player's data. Raises ValueError if not found."""
        _validate_wallet(player.wallet_address)
        _validate_steam(player.steam_id)

        cursor = self._conn.execute(
            "UPDATE players SET steam_id=?, steam_display_name=?, game=? WHERE wallet_address=?",
            (player.steam_id, player.steam_display_name, player.game, player.wallet_address),
        )
        self._conn.commit()
        if cursor.rowcount == 0:
            raise ValueError(f"Player with wallet '{player.wallet_address}' not found")
        log.info("update | wallet=%s → display_name=%s game=%s", player.wallet_address, player.steam_display_name, player.game)

    def delete(self, wallet_address: str) -> None:
        """Delete a player by wallet address. Raises ValueError if not found."""
        _validate_wallet(wallet_address)

        cursor = self._conn.execute(
            "DELETE FROM players WHERE wallet_address = ?", (wallet_address,)
        )
        self._conn.commit()
        if cursor.rowcount == 0:
            raise ValueError(f"Player with wallet '{wallet_address}' not found")
        log.info("delete | wallet=%s", wallet_address)

    def get_by_steam_id(self, steam_id: str) -> Optional[Player]:
        """Fetch a player by Steam ID. Returns None if not found."""
        _validate_steam(steam_id)
        row = self._conn.execute(
            "SELECT * FROM players WHERE steam_id = ?", (steam_id,)
        ).fetchone()
        if row is None:
            return None
        return Player(
            wallet_address=row["wallet_address"],
            steam_id=row["steam_id"],
            steam_display_name=row["steam_display_name"],
            game=row["game"],
        )

    # ── Blacklist ──────────────────────────────────────────────────────────────
    def blacklist(self, wallet_address: str, reason: str = "smurf") -> None:
        """Add a wallet to the blacklist."""
        _validate_wallet(wallet_address)
        self._conn.execute(
            "INSERT OR REPLACE INTO blacklist (wallet_address, reason) VALUES (?, ?)",
            (wallet_address, reason),
        )
        self._conn.commit()
        log.info("blacklist | wallet=%s reason=%s", wallet_address, reason)

    def unblacklist(self, wallet_address: str) -> None:
        """Remove a wallet from the blacklist."""
        _validate_wallet(wallet_address)
        self._conn.execute(
            "DELETE FROM blacklist WHERE wallet_address = ?", (wallet_address,)
        )
        self._conn.commit()
        log.info("unblacklist | wallet=%s", wallet_address)

    def is_blacklisted(self, wallet_address: str) -> bool:
        """Check if a wallet is blacklisted."""
        _validate_wallet(wallet_address)
        row = self._conn.execute(
            "SELECT 1 FROM blacklist WHERE wallet_address = ?", (wallet_address,)
        ).fetchone()
        return row is not None

    # ── Disputes ──────────────────────────────────────────────────────────────
    def submit_dispute(self, wallet_address: str, reason: str) -> None:
        """Player submits an appeal. Raises ValueError if not blacklisted."""
        _validate_wallet(wallet_address)
        if not self.is_blacklisted(wallet_address):
            raise ValueError(f"Wallet '{wallet_address}' is not blacklisted — no dispute needed")
        self._conn.execute(
            "INSERT OR REPLACE INTO disputes (wallet_address, reason, status, resolution, admin_note) VALUES (?, ?, 'open', '', '')",
            (wallet_address, reason),
        )
        self._conn.commit()
        log.info("dispute submitted | wallet=%s", wallet_address)

    def get_open_disputes(self) -> List[Dispute]:
        """Return all disputes not yet resolved (open / reviewing / escalated)."""
        rows = self._conn.execute(
            "SELECT * FROM disputes WHERE status != 'resolved'"
        ).fetchall()
        return [self._row_to_dispute(r) for r in rows]

    def get_pending_disputes(self) -> List[Dispute]:
        """Alias for get_open_disputes() — backward compatibility."""
        return self.get_open_disputes()

    def update_dispute_status(self, wallet_address: str, status: str) -> None:
        """Admin updates dispute status: open → reviewing → escalated."""
        _validate_wallet(wallet_address)
        valid = {"open", "reviewing", "escalated"}
        if status not in valid:
            raise ValueError(f"Invalid status '{status}' — must be one of {valid}")
        cursor = self._conn.execute(
            "UPDATE disputes SET status=? WHERE wallet_address=? AND status != 'resolved'",
            (status, wallet_address),
        )
        self._conn.commit()
        if cursor.rowcount == 0:
            raise ValueError(f"No active dispute found for wallet '{wallet_address}'")
        log.info("dispute status → %s | wallet=%s", status, wallet_address)

    def resolve_dispute(self, wallet_address: str, approved: bool, admin_note: str = "", resolution: str = "") -> None:
        """Admin resolves a dispute. approved=True → unblacklist player."""
        _validate_wallet(wallet_address)
        res = resolution if resolution else ("approved" if approved else "rejected")
        cursor = self._conn.execute(
            "UPDATE disputes SET status='resolved', resolution=?, admin_note=? WHERE wallet_address=? AND status != 'resolved'",
            (res, admin_note, wallet_address),
        )
        self._conn.commit()
        if cursor.rowcount == 0:
            raise ValueError(f"No pending dispute found for wallet '{wallet_address}'")
        if approved:
            self.unblacklist(wallet_address)
        log.info("dispute resolved | wallet=%s resolution=%s note=%s", wallet_address, res, admin_note)

    @staticmethod
    def _row_to_dispute(r) -> Dispute:
        return Dispute(
            wallet_address=r["wallet_address"],
            reason=r["reason"],
            status=r["status"],
            resolution=r["resolution"],
            admin_note=r["admin_note"],
        )

    # ── Match Log ──────────────────────────────────────────────────────────────
    def log_match(self, wallet_address: str) -> None:
        """רושם כניסה למשחק עבור שחקן."""
        _validate_wallet(wallet_address)
        self._conn.execute(
            "INSERT INTO match_log (wallet_address) VALUES (?)",
            (wallet_address,),
        )
        self._conn.commit()
        log.info("match_log | wallet=%s", wallet_address)

    def get_today_match_count(self, wallet_address: str) -> int:
        """מחזיר כמה משחקים שיחק השחקן היום."""
        _validate_wallet(wallet_address)
        row = self._conn.execute(
            "SELECT COUNT(*) as cnt FROM match_log WHERE wallet_address = ? AND played_at = date('now')",
            (wallet_address,),
        ).fetchone()
        return row["cnt"]

    def close(self) -> None:
        self._conn.close()
