"""
ARENA Engine — Transaction History Ledger
Issue #22: Persistent SQLite ledger for all platform financial transactions.

Stores every deposit, payout, and fee with full audit trail.
Connects to WalletManager (Issue #21) via optional ledger= parameter.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from src.wallet.wallet_manager import Transaction

log = logging.getLogger("wallet.ledger")

# ── Default DB path: engine/data/ledger.db ───────────────────────────────────
_DATA_DIR        = Path(__file__).parent.parent.parent / "data"
_DEFAULT_DB_PATH = str(_DATA_DIR / "ledger.db")

# ── Transaction types ─────────────────────────────────────────────────────────
TX_DEPOSIT = "deposit"
TX_PAYOUT  = "payout"
TX_FEE     = "fee"


# ── Data model ────────────────────────────────────────────────────────────────
@dataclass
class LedgerEntry:
    tx_id:          int
    wallet_address: str           # the player's wallet (recipient or sender)
    match_id:       Optional[str] # which match this belongs to (None for deposits)
    tx_type:        str           # deposit | payout | fee
    amount:         float
    asset:          str           # e.g. "USDT"
    timestamp:      str           # ISO-8601 string
    tx_hash:        Optional[str] # Binance transaction hash
    status:         str           # pending | success | failed


# ── Ledger ────────────────────────────────────────────────────────────────────
class TransactionLedger:
    """
    Persistent ledger for all ARENA financial transactions.

    Backed by SQLite (engine/data/ledger.db).
    Receives Transaction objects from WalletManager and stores them
    with added context: wallet_address, match_id, tx_type.

    Query by wallet, match, or date.
    Export to JSON or CSV for audit / admin use.
    """

    def __init__(self, db_path: str = _DEFAULT_DB_PATH) -> None:
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._create_tables()
        log.info("TransactionLedger ready | path=%s", db_path)

    # ── Internal ──────────────────────────────────────────────────────────────
    def _create_tables(self) -> None:
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS transactions (
                tx_id          INTEGER PRIMARY KEY AUTOINCREMENT,
                wallet_address TEXT    NOT NULL,
                match_id       TEXT,
                tx_type        TEXT    NOT NULL,
                amount         REAL    NOT NULL,
                asset          TEXT    NOT NULL DEFAULT 'USDT',
                timestamp      TEXT    NOT NULL,
                tx_hash        TEXT,
                status         TEXT    NOT NULL DEFAULT 'pending'
            )
        """)
        # Indexes for fast lookups by wallet, match, and date
        self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_ledger_wallet ON transactions (wallet_address)"
        )
        self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_ledger_match ON transactions (match_id)"
        )
        self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_ledger_date ON transactions (date(timestamp))"
        )
        self._conn.commit()

    @staticmethod
    def _row_to_entry(row: sqlite3.Row) -> LedgerEntry:
        return LedgerEntry(
            tx_id=row["tx_id"],
            wallet_address=row["wallet_address"],
            match_id=row["match_id"],
            tx_type=row["tx_type"],
            amount=row["amount"],
            asset=row["asset"],
            timestamp=row["timestamp"],
            tx_hash=row["tx_hash"],
            status=row["status"],
        )

    @staticmethod
    def _entry_to_dict(e: LedgerEntry) -> dict:
        return {
            "tx_id":          e.tx_id,
            "wallet_address": e.wallet_address,
            "match_id":       e.match_id,
            "tx_type":        e.tx_type,
            "amount":         e.amount,
            "asset":          e.asset,
            "timestamp":      e.timestamp,
            "tx_hash":        e.tx_hash,
            "status":         e.status,
        }

    # ── Write ─────────────────────────────────────────────────────────────────
    def record(
        self,
        tx: Transaction,
        wallet_address: str,
        tx_type: str = TX_PAYOUT,
        match_id: Optional[str] = None,
    ) -> int:
        """
        Persist a Transaction from WalletManager to the ledger.

        Args:
            tx:             Transaction object from WalletManager.send_payment().
            wallet_address: Player's wallet address (recipient for payouts/fees,
                            sender for deposits).
            tx_type:        "deposit" | "payout" | "fee"
            match_id:       Match this transaction belongs to (None for deposits).

        Returns:
            Auto-incremented tx_id assigned by SQLite.
        """
        timestamp = (
            tx.timestamp.isoformat()
            if isinstance(tx.timestamp, datetime)
            else str(tx.timestamp)
        )
        cursor = self._conn.execute(
            """
            INSERT INTO transactions
                (wallet_address, match_id, tx_type, amount, asset, timestamp, tx_hash, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (wallet_address, match_id, tx_type,
             tx.amount, tx.asset, timestamp, tx.tx_hash, tx.status),
        )
        self._conn.commit()
        tx_id = cursor.lastrowid
        log.info(
            "ledger | tx_id=%d type=%s wallet=%s amount=%.4f %s match=%s status=%s",
            tx_id, tx_type, wallet_address, tx.amount, tx.asset, match_id, tx.status,
        )
        return tx_id

    # ── Query ─────────────────────────────────────────────────────────────────
    def get_by_wallet(self, wallet_address: str) -> List[LedgerEntry]:
        """All transactions for a given wallet address, ordered by tx_id."""
        rows = self._conn.execute(
            "SELECT * FROM transactions WHERE wallet_address = ? ORDER BY tx_id",
            (wallet_address,),
        ).fetchall()
        return [self._row_to_entry(r) for r in rows]

    def get_by_match(self, match_id: str) -> List[LedgerEntry]:
        """All transactions linked to a specific match."""
        rows = self._conn.execute(
            "SELECT * FROM transactions WHERE match_id = ? ORDER BY tx_id",
            (match_id,),
        ).fetchall()
        return [self._row_to_entry(r) for r in rows]

    def get_by_date(self, date_str: str) -> List[LedgerEntry]:
        """All transactions on a given date (format: YYYY-MM-DD)."""
        rows = self._conn.execute(
            "SELECT * FROM transactions WHERE date(timestamp) = ? ORDER BY tx_id",
            (date_str,),
        ).fetchall()
        return [self._row_to_entry(r) for r in rows]

    def get_all(self) -> List[LedgerEntry]:
        """Return every entry in the ledger, ordered by tx_id."""
        rows = self._conn.execute(
            "SELECT * FROM transactions ORDER BY tx_id"
        ).fetchall()
        return [self._row_to_entry(r) for r in rows]

    # ── Export ────────────────────────────────────────────────────────────────
    def export_json(self, wallet_address: Optional[str] = None) -> str:
        """
        Export ledger to a JSON string.
        If wallet_address is given — only that player's entries.
        """
        entries = (
            self.get_by_wallet(wallet_address) if wallet_address else self.get_all()
        )
        return json.dumps([self._entry_to_dict(e) for e in entries], indent=2)

    def export_csv(self, wallet_address: Optional[str] = None) -> str:
        """
        Export ledger to a CSV string.
        If wallet_address is given — only that player's entries.
        """
        entries = (
            self.get_by_wallet(wallet_address) if wallet_address else self.get_all()
        )
        output = io.StringIO()
        fieldnames = [
            "tx_id", "wallet_address", "match_id", "tx_type",
            "amount", "asset", "timestamp", "tx_hash", "status",
        ]
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        for e in entries:
            writer.writerow(self._entry_to_dict(e))
        return output.getvalue()

    def close(self) -> None:
        self._conn.close()
