"""
ArenaEscrow — Python client (Web3.py)

Responsibilities:
  1. Oracle actions  — declare_winner(), cancel_match_on_chain()
  2. Event listeners — MatchCreated / PlayerDeposited / MatchActive /
                       WinnerDeclared / MatchRefunded / MatchCancelled → DB sync
  3. Health check    — is_healthy()

Sync contract:
  declare_winner()       ↔ POST /match/result  CONTRACT-ready marker (main.py)
  declare_tie()          ↔ _auto_payout_on_tie() in main.py (draw outcome)
  WinnerDeclared event   ↔ transactions table  tx_type='match_win' / 'fee'
  TieDeclared event      ↔ transactions table  tx_type='tie_refund' / 'fee', matches.status='tied'
  PlayerDeposited event  ↔ match_players       has_deposited=TRUE
  MatchActive event      ↔ matches             status='in_progress'
  MatchRefunded event    ↔ matches             status='cancelled' + tx_type='refund'
  MatchCancelled event   ↔ matches             status='cancelled' + tx_type='refund'
  winningTeam 0/1        ↔ match_players.team  'A'=0 / 'B'=1
  on_chain_match_id      ↔ matches.on_chain_match_id  BIGINT

Issue alignment:
  Issue #28 — Contract-Backend Integration
  Issue #56 — Rage-Quit: claimRefund timeout → MatchRefunded event handled here
"""

import logging
import os
import time
import uuid
from contextlib import contextmanager
from typing import Optional

from sqlalchemy import text
from web3 import Web3
from web3.exceptions import ContractLogicError

logger = logging.getLogger(__name__)

# ── Minimal ABI — only events + functions used by the engine ────────────────
# Full ABI lives in engine/contracts/artifacts/src/ArenaEscrow.sol/ArenaEscrow.json
# CONTRACT-ready: keep in sync with ArenaEscrow.sol whenever the contract changes.
ARENA_ESCROW_ABI = [
    # ── Events ──────────────────────────────────────────────────────────────
    {
        "type": "event", "name": "MatchCreated",
        "inputs": [
            {"name": "matchId",        "type": "uint256", "indexed": True},
            {"name": "creator",        "type": "address", "indexed": True},
            {"name": "teamSize",       "type": "uint8",   "indexed": False},
            {"name": "stakePerPlayer", "type": "uint256", "indexed": False},
        ],
    },
    {
        "type": "event", "name": "PlayerDeposited",
        "inputs": [
            {"name": "matchId",        "type": "uint256", "indexed": True},
            {"name": "player",         "type": "address", "indexed": True},
            {"name": "team",           "type": "uint8",   "indexed": False},
            # stakePerPlayer added — ArenaEscrow.sol line 127 (feat/contracts-m8-oz-pausable)
            # enables _handle_player_deposited to use the event directly (no extra DB read)
            {"name": "stakePerPlayer", "type": "uint256", "indexed": False},
            {"name": "depositsTeamA",  "type": "uint8",   "indexed": False},
            {"name": "depositsTeamB",  "type": "uint8",   "indexed": False},
        ],
    },
    {
        "type": "event", "name": "MatchActive",
        "inputs": [
            {"name": "matchId", "type": "uint256", "indexed": True},
        ],
    },
    {
        "type": "event", "name": "WinnerDeclared",
        "inputs": [
            {"name": "matchId",         "type": "uint256", "indexed": True},
            {"name": "winningTeam",     "type": "uint8",   "indexed": False},
            {"name": "payoutPerWinner", "type": "uint256", "indexed": False},
            {"name": "fee",             "type": "uint256", "indexed": False},
        ],
    },
    {
        "type": "event", "name": "MatchRefunded",
        "inputs": [
            {"name": "matchId", "type": "uint256", "indexed": True},
        ],
    },
    {
        "type": "event", "name": "MatchCancelled",
        "inputs": [
            {"name": "matchId",     "type": "uint256", "indexed": True},
            {"name": "cancelledBy", "type": "address", "indexed": True},
        ],
    },
    {
        "type": "event", "name": "TieDeclared",
        "inputs": [
            {"name": "matchId",         "type": "uint256", "indexed": True},
            {"name": "refundPerPlayer", "type": "uint256", "indexed": False},
            {"name": "fee",             "type": "uint256", "indexed": False},
        ],
    },
    {
        "type": "event", "name": "PayoutCredited",
        "inputs": [
            {"name": "recipient", "type": "address", "indexed": True},
            {"name": "amount",    "type": "uint256", "indexed": False},
        ],
    },
    {
        "type": "event", "name": "Withdrawn",
        "inputs": [
            {"name": "recipient", "type": "address", "indexed": True},
            {"name": "amount",    "type": "uint256", "indexed": False},
        ],
    },
    # ── Functions ────────────────────────────────────────────────────────────
    {
        "type": "function", "name": "declareWinner",
        "inputs": [
            {"name": "matchId",     "type": "uint256"},
            {"name": "winningTeam", "type": "uint8"},
        ],
        "outputs": [], "stateMutability": "nonpayable",
    },
    {
        "type": "function", "name": "declareTie",
        "inputs": [{"name": "matchId", "type": "uint256"}],
        "outputs": [], "stateMutability": "nonpayable",
    },
    {
        "type": "function", "name": "cancelMatch",
        "inputs": [{"name": "matchId", "type": "uint256"}],
        "outputs": [], "stateMutability": "nonpayable",
    },
    {
        "type": "function", "name": "getMatch",
        "inputs": [{"name": "matchId", "type": "uint256"}],
        "outputs": [
            {"name": "teamA",         "type": "address[]"},
            {"name": "teamB",         "type": "address[]"},
            {"name": "stakePerPlayer","type": "uint256"},
            {"name": "teamSize",      "type": "uint8"},
            {"name": "depositsTeamA", "type": "uint8"},
            {"name": "depositsTeamB", "type": "uint8"},
            {"name": "state",         "type": "uint8"},
            {"name": "winningTeam",   "type": "uint8"},
        ],
        "stateMutability": "view",
    },
    {
        "type": "function", "name": "isPaused",
        "inputs": [], "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "view",
    },
    {
        "type": "function", "name": "withdraw",
        "inputs": [], "outputs": [], "stateMutability": "nonpayable",
    },
    {
        "type": "function", "name": "pendingWithdrawals",
        "inputs": [{"name": "account", "type": "address"}],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    },
    # ── Owner-only pause / unpause (M8 kill switch) ──────────────────────────
    # Called from EscrowClient.pause_contract() / unpause_contract()
    # using OWNER_PRIVATE_KEY (deployer wallet), NOT the oracle key.
    # Oracle cannot pause — see ArenaEscrow.sol onlyOwner modifier.
    {
        "type": "function", "name": "pause",
        "inputs": [], "outputs": [], "stateMutability": "nonpayable",
    },
    {
        "type": "function", "name": "unpause",
        "inputs": [], "outputs": [], "stateMutability": "nonpayable",
    },
]

# ── Team mapping ─────────────────────────────────────────────────────────────
# Sync: match_players.team ('A'/'B') ↔ ArenaEscrow winningTeam (0/1)
_TEAM_TO_INT = {"A": 0, "B": 1}
_INT_TO_TEAM = {0: "A", 1: "B"}

# ── Mode mapping ─────────────────────────────────────────────────────────────
# Sync: matches.mode ('1v1'/'2v2'/'4v4'/'5v5') ↔ ArenaEscrow teamSize (1/2/4/5)
_TEAM_SIZE_TO_MODE = {1: "1v1", 2: "2v2", 4: "4v4", 5: "5v5"}

# ── Gas budget ───────────────────────────────────────────────────────────────
_GAS_DECLARE_WINNER = 300_000   # 5v5 worst case
_GAS_DECLARE_TIE    = 350_000   # 5v5 tie — two full team loops + fee
_GAS_CANCEL_MATCH   = 200_000
_GAS_ADMIN          =  80_000   # pause() / unpause() — simple state flip


def _event_tx_hash(event) -> Optional[str]:
    """
    Extract the originating transactionHash from a web3 event as a 0x-prefixed
    hex string. Used to fill transactions.tx_hash on every row we insert from
    an on-chain event so uq_transactions_chain_event_dedup can block replays
    when the same event is delivered twice (chain re-org, listener restart).
    Returns None only if the event object is malformed — callers should let
    that propagate so the NOT NULL guardrail (migration 035) catches it.
    """
    raw = event.get("transactionHash") if hasattr(event, "get") else event["transactionHash"]
    if raw is None:
        return None
    if isinstance(raw, (bytes, bytearray)):
        return "0x" + raw.hex()
    s = str(raw)
    return s if s.startswith("0x") else "0x" + s


class EscrowClient:
    """
    Web3.py wrapper for ArenaEscrow.sol.

    Usage:
        client = build_escrow_client(SessionLocal)
        tx_hash = client.declare_winner(match_id, winner_id)
    """

    def __init__(
        self,
        rpc_url:           str,
        contract_address:  str,
        private_key:       str,
        session_factory,               # SQLAlchemy SessionLocal (callable → Session)
        owner_private_key: str | None = None,  # deployer / owner wallet — for pause/unpause
    ) -> None:
        self._w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 30}))
        self._contract = self._w3.eth.contract(
            address=Web3.to_checksum_address(contract_address),
            abi=ARENA_ESCROW_ABI,
        )
        self._account = self._w3.eth.account.from_key(private_key)
        # Owner account (deployer) — required for pause() / unpause() (onlyOwner).
        # Separate from oracle because the oracle cannot pause the contract.
        # CONTRACT-ready: OWNER_PRIVATE_KEY env var — distinct from PRIVATE_KEY (oracle).
        self._owner_account = (
            self._w3.eth.account.from_key(owner_private_key)
            if owner_private_key else None
        )
        self._session_factory = session_factory
        logger.info(
            "EscrowClient ready | contract=%s oracle=%s owner_configured=%s chain=%s",
            contract_address, self._account.address,
            self._owner_account is not None,
            self._w3.eth.chain_id,
        )

    # ── Public property for health/logging ───────────────────────────────────

    @property
    def contract(self):
        return self._contract

    # ── Health ───────────────────────────────────────────────────────────────

    def is_healthy(self) -> bool:
        """Returns True if the RPC node is reachable and the contract is live."""
        try:
            return self._w3.is_connected() and not self._contract.functions.isPaused().call()
        except Exception as exc:
            logger.warning("EscrowClient health check failed: %s", exc)
            return False

    # ── Oracle actions ───────────────────────────────────────────────────────

    def declare_winner(self, match_id: str, winner_id: str) -> str:
        """
        Called from POST /match/result after Vision Engine confirms result.

        Looks up on_chain_match_id and the winner's team from the DB,
        then calls ArenaEscrow.declareWinner(on_chain_match_id, winningTeam).

        Returns tx_hash (hex string).

        DB-ready: reads matches.on_chain_match_id + match_players.team
        CONTRACT-ready: replaces the CONTRACT-ready marker in main.py
        """
        with self._session_factory() as session:
            # 1. Resolve on_chain_match_id from DB match UUID
            row = session.execute(
                text("SELECT on_chain_match_id FROM matches WHERE id = :mid"),
                {"mid": match_id},
            ).fetchone()
            if row is None:
                raise ValueError(f"Match not found in DB: {match_id}")
            on_chain_id = row[0]
            if on_chain_id is None:
                raise ValueError(
                    f"Match {match_id} has no on_chain_match_id — "
                    "contract not yet linked to this match"
                )

            # 2. Resolve winner's team (A=0, B=1)
            team_row = session.execute(
                text(
                    "SELECT team FROM match_players "
                    "WHERE match_id = :mid AND user_id = :uid"
                ),
                {"mid": match_id, "uid": winner_id},
            ).fetchone()
            if team_row is None:
                raise ValueError(
                    f"Winner {winner_id} not found in match_players for match {match_id}"
                )
            winning_team: int = _TEAM_TO_INT[team_row[0]]

        # 3. Build + sign + send transaction
        return self._send_tx(
            self._contract.functions.declareWinner(int(on_chain_id), winning_team),
            gas=_GAS_DECLARE_WINNER,
        )

    def cancel_match_on_chain(self, match_id: str) -> str:
        """
        Admin-triggered cancel of a WAITING on-chain match.
        Calls ArenaEscrow.cancelMatch(on_chain_match_id).

        DB-ready: reads matches.on_chain_match_id
        CONTRACT-ready: Issue #28 admin dispute resolution
        """
        with self._session_factory() as session:
            row = session.execute(
                text("SELECT on_chain_match_id FROM matches WHERE id = :mid"),
                {"mid": match_id},
            ).fetchone()
            if not row or row[0] is None:
                raise ValueError(f"Match {match_id} has no on_chain_match_id")
            on_chain_id = row[0]

        return self._send_tx(
            self._contract.functions.cancelMatch(int(on_chain_id)),
            gas=_GAS_CANCEL_MATCH,
        )

    def transfer_to_holding(
        self,
        match_id: str,
        holding_wallet: str,
        reason: str,
    ) -> str:
        """
        Oracle transfers all escrow funds to a platform holding wallet when the
        match outcome is ambiguous (both teams disconnected / private server crash).

        Requires ArenaEscrow.transferToHolding() to be deployed.
        Raises NotImplementedError until the contract is redeployed with that function.

        Returns tx_hash hex string.
        """
        with self._session_factory() as session:
            row = session.execute(
                text("SELECT on_chain_match_id FROM matches WHERE id = :mid"),
                {"mid": match_id},
            ).fetchone()
            if not row or row[0] is None:
                raise ValueError(f"Match {match_id} has no on_chain_match_id")
            on_chain_id = int(row[0])

        if not hasattr(self._contract.functions, "transferToHolding"):
            raise NotImplementedError(
                "ArenaEscrow.transferToHolding() not deployed yet — "
                "redeploy contract with the new function before calling this."
            )

        return self._send_tx(
            self._contract.functions.transferToHolding(
                on_chain_id,
                holding_wallet,
                reason,
            ),
            gas=250_000,
        )

    def declare_tie(self, match_id: str) -> str:
        """
        Called from _auto_payout_on_tie() after Vision Engine confirms a draw.

        Looks up on_chain_match_id from the DB, then calls
        ArenaEscrow.declareTie(on_chain_match_id).

        Returns tx_hash (hex string).
        """
        with self._session_factory() as session:
            row = session.execute(
                text("SELECT on_chain_match_id FROM matches WHERE id = :mid"),
                {"mid": match_id},
            ).fetchone()
            if row is None:
                raise ValueError(f"Match not found in DB: {match_id}")
            on_chain_id = row[0]
            if on_chain_id is None:
                raise ValueError(
                    f"Match {match_id} has no on_chain_match_id — "
                    "contract not yet linked to this match"
                )

        return self._send_tx(
            self._contract.functions.declareTie(int(on_chain_id)),
            gas=_GAS_DECLARE_TIE,
        )

    def pause_contract(self) -> Optional[str]:
        """
        Call ArenaEscrow.pause() from the owner wallet (onlyOwner).
        Mirrors POST /admin/freeze {"freeze": true} at the contract layer.

        The oracle private key (PRIVATE_KEY) CANNOT pause — only the deployer
        wallet (OWNER_PRIVATE_KEY) can.  Returns None and logs a warning when
        OWNER_PRIVATE_KEY is not configured (non-fatal — in-memory freeze still
        applies via _PAYOUTS_FROZEN).

        CONTRACT-ready: OWNER_PRIVATE_KEY env var must be set before testnet deploy.
        """
        if not self._owner_account:
            logger.warning(
                "pause_contract: OWNER_PRIVATE_KEY not configured — "
                "on-chain pause skipped (in-memory _PAYOUTS_FROZEN still active)"
            )
            return None
        return self._send_tx(
            self._contract.functions.pause(),
            gas=_GAS_ADMIN,
            account=self._owner_account,
        )

    def unpause_contract(self) -> Optional[str]:
        """
        Call ArenaEscrow.unpause() from the owner wallet (onlyOwner).
        Mirrors POST /admin/freeze {"freeze": false} at the contract layer.

        Returns None and logs a warning when OWNER_PRIVATE_KEY is not configured.

        CONTRACT-ready: OWNER_PRIVATE_KEY env var must be set before testnet deploy.
        """
        if not self._owner_account:
            logger.warning(
                "unpause_contract: OWNER_PRIVATE_KEY not configured — "
                "on-chain unpause skipped"
            )
            return None
        return self._send_tx(
            self._contract.functions.unpause(),
            gas=_GAS_ADMIN,
            account=self._owner_account,
        )

    # ── Event processing ─────────────────────────────────────────────────────

    def process_events(self, from_block: int, to_block: int) -> int:
        """
        Fetches and processes all ArenaEscrow events in [from_block, to_block].
        Returns the number of events processed.
        Each handler is idempotent (ON CONFLICT DO NOTHING / UPDATE idempotent).
        """
        handlers = {
            "MatchCreated":    self._handle_match_created,
            "PlayerDeposited": self._handle_player_deposited,
            "MatchActive":     self._handle_match_active,
            "WinnerDeclared":  self._handle_winner_declared,
            "TieDeclared":     self._handle_tie_declared,
            "MatchRefunded":   self._handle_match_refunded,
            "MatchCancelled":  self._handle_match_cancelled,
            "PayoutCredited":  self._handle_payout_credited,
            "Withdrawn":       self._handle_withdrawn,
        }
        total = 0
        for event_name, handler in handlers.items():
            try:
                event_filter = getattr(self._contract.events, event_name)
                logs = event_filter.get_logs(fromBlock=from_block, toBlock=to_block)
                for log in logs:
                    try:
                        handler(log)
                        total += 1
                    except Exception as exc:
                        logger.error(
                            "Error handling %s event: %s | log=%s", event_name, exc, log
                        )
            except Exception as exc:
                logger.error("Error fetching %s logs: %s", event_name, exc)
        return total

    # ── Oracle sync state — persistent last_block ────────────────────────────

    def _load_last_block(self) -> int:
        """
        Load the last processed block number from oracle_sync_state in DB.

        Returns the saved value when > 0 (listener resumes from there).
        Returns 0 when the table is empty or DB is unavailable — caller
        falls back to eth.block_number - lookback_blocks.

        DB-ready: reads oracle_sync_state (migration 007).
        """
        try:
            with self._session_factory() as session:
                row = session.execute(
                    text("SELECT last_block FROM oracle_sync_state WHERE id = 'singleton'")
                ).fetchone()
                return int(row[0]) if row and row[0] else 0
        except Exception as exc:
            logger.warning("_load_last_block failed (fallback to lookback): %s", exc)
            return 0

    def _save_last_block(self, block: int) -> None:
        """
        Persist the last successfully processed block number to DB.

        Uses an UPSERT on oracle_sync_state so the row always exists after
        migration 007 is applied.  Errors are non-fatal — the listener
        continues running; next successful save will catch up.

        DB-ready: writes oracle_sync_state (migration 007).
        """
        try:
            with self._session_factory() as session:
                session.execute(
                    text(
                        "INSERT INTO oracle_sync_state (id, last_block, last_sync_at) "
                        "VALUES ('singleton', :block, NOW()) "
                        "ON CONFLICT (id) DO UPDATE "
                        "  SET last_block = EXCLUDED.last_block, "
                        "      last_sync_at = NOW()"
                    ),
                    {"block": block},
                )
                session.commit()
        except Exception as exc:
            logger.warning("_save_last_block failed (non-fatal): %s", exc)

    def listen(self, poll_interval: int = 15, lookback_blocks: int = 100) -> None:
        """
        Main polling loop — runs forever, polling for new contract events.
        Start this in a background thread or process alongside the FastAPI engine.

        poll_interval:   seconds between polls (default 15s — ~5 BSC blocks)
        lookback_blocks: blocks to look back on first-ever start (no saved state)

        Resume logic:
          - On startup: reads oracle_sync_state.last_block from DB.
          - If saved > 0: resumes from there (no missed events after restart).
          - If 0 (first run): falls back to current_block - lookback_blocks.
          - After every successful poll: saves current_block to DB.

        DB-ready: processes all events and syncs to DB in real time.
        CONTRACT-ready: this is the escrow ↔ DB sync backbone for Issue #28.
        """
        # ── Determine starting block ──────────────────────────────────────────
        saved_block = self._load_last_block()
        if saved_block > 0:
            last_block = saved_block
            logger.info(
                "EscrowClient listener resuming | from_block=%d poll=%ss",
                last_block, poll_interval,
            )
        else:
            last_block = max(0, self._w3.eth.block_number - lookback_blocks)
            logger.info(
                "EscrowClient listener starting fresh | from_block=%d poll=%ss lookback=%s",
                last_block, poll_interval, lookback_blocks,
            )

        while True:
            try:
                current_block = self._w3.eth.block_number
                if current_block > last_block:
                    n = self.process_events(last_block + 1, current_block)
                    if n:
                        logger.info(
                            "Processed %d events | blocks %d→%d",
                            n, last_block + 1, current_block,
                        )
                    last_block = current_block
                    self._save_last_block(current_block)  # persist resume point
            except Exception as exc:
                logger.error("Listener poll error: %s", exc)
            time.sleep(poll_interval)

    # ── View helpers ─────────────────────────────────────────────────────────

    def get_on_chain_match(self, on_chain_match_id: int) -> dict:
        """
        Reads match state directly from the contract.
        Used by admin dashboard to verify on-chain state vs DB.
        """
        result = self._contract.functions.getMatch(on_chain_match_id).call()
        return {
            "teamA":          result[0],
            "teamB":          result[1],
            "stakePerPlayer": result[2],
            "teamSize":       result[3],
            "depositsTeamA":  result[4],
            "depositsTeamB":  result[5],
            "state":          result[6],
            "winningTeam":    result[7],
        }

    def read_match_state(self, on_chain_match_id: int) -> int:
        """
        Returns the raw MatchState enum integer for a match (index [6] of getMatch()).
        0=WAITING 1=ACTIVE 2=FINISHED 3=REFUNDED 4=CANCELLED 5=TIED
        Raises if the match does not exist.
        """
        result = self._contract.functions.getMatch(on_chain_match_id).call()
        return int(result[6])

    def read_pending_withdrawals(self, wallet_address: str) -> int:
        """
        Returns the on-chain pendingWithdrawals[wallet] in wei.
        Returns 0 when nothing is owed (normal case — direct ETH transfer succeeded).
        """
        checksum = Web3.to_checksum_address(wallet_address)
        return int(self._contract.functions.pendingWithdrawals(checksum).call())

    # ── Event handlers ───────────────────────────────────────────────────────

    def _handle_match_created(self, event) -> None:
        """
        MatchCreated(matchId, creator, teamSize, stakePerPlayer)

        Links an on-chain match to the DB match by updating on_chain_match_id.
        The DB match is identified by: host wallet + status='waiting' + most recent.

        DB-ready:
          UPDATE matches SET on_chain_match_id=matchId WHERE host_id=(wallet lookup)
          AND status='waiting' AND on_chain_match_id IS NULL ORDER BY created_at DESC
          INSERT match_players (creator, team='A', has_deposited=TRUE)
          INSERT transactions  (type='escrow_lock', user_id=creator)
          UPDATE user_balances SET in_escrow += stakePerPlayer
        """
        args           = event["args"]
        on_chain_id    = args["matchId"]
        creator_wallet = args["creator"].lower()
        team_size      = args["teamSize"]
        stake_wei      = args["stakePerPlayer"]
        stake_eth      = Web3.from_wei(stake_wei, "ether")
        tx_hash        = _event_tx_hash(event)

        with self._session_factory() as session:
            # Idempotency (C15): if this on_chain_match_id is already linked,
            # a duplicate event was delivered (re-org, listener restart).
            # Skip instead of linking a second DB match, which would cause
            # later WinnerDeclared / Refund events to pay the wrong row.
            existing = session.execute(
                text("SELECT id FROM matches WHERE on_chain_match_id = :oid"),
                {"oid": on_chain_id},
            ).fetchone()
            if existing:
                logger.info(
                    "MatchCreated: on_chain_id=%s already linked to match=%s — skipping",
                    on_chain_id, existing[0],
                )
                return

            # Find user by wallet address
            user = session.execute(
                text("SELECT id FROM users WHERE LOWER(wallet_address) = :wallet"),
                {"wallet": creator_wallet},
            ).fetchone()
            if not user:
                logger.warning("MatchCreated: unknown wallet %s", creator_wallet)
                return
            user_id = str(user[0])

            # Link to existing DB match (WAITING, no on_chain_match_id yet)
            result = session.execute(
                text("""
                    UPDATE matches
                    SET on_chain_match_id = :on_chain_id,
                        stake_per_player  = :stake,
                        bet_amount        = :stake
                    WHERE host_id = :uid
                      AND status  = 'waiting'
                      AND on_chain_match_id IS NULL
                    ORDER BY created_at DESC
                    LIMIT 1
                    RETURNING id
                """),
                {"on_chain_id": on_chain_id, "stake": float(stake_eth), "uid": user_id},
            ).fetchone()

            if not result:
                logger.warning(
                    "MatchCreated: no waiting match found for wallet=%s on_chain_id=%s",
                    creator_wallet, on_chain_id,
                )
                return
            db_match_id = str(result[0])

            # Mark creator's deposit in match_players
            session.execute(
                text("""
                    UPDATE match_players
                    SET has_deposited  = TRUE,
                        deposited_at   = NOW(),
                        deposit_amount = :stake,
                        wallet_address = :wallet
                    WHERE match_id = :mid AND user_id = :uid
                """),
                {
                    "mid": db_match_id, "uid": user_id,
                    "stake": float(stake_eth), "wallet": creator_wallet,
                },
            )

            # Record escrow_lock transaction.
            # tx_hash scopes the uq_transactions_chain_event_dedup index so a
            # re-fired MatchCreated (re-org / listener restart) fails the
            # second insert instead of double-crediting escrow.
            session.execute(
                text("""
                    INSERT INTO transactions (id, user_id, type, amount, token, status, match_id, tx_hash)
                    VALUES (:id, :uid, 'escrow_lock', :amount, 'BNB', 'completed', :mid, :tx)
                    ON CONFLICT DO NOTHING
                """),
                {
                    "id": str(uuid.uuid4()), "uid": user_id,
                    "amount": float(stake_eth), "mid": db_match_id,
                    "tx": tx_hash,
                },
            )

            # Update in_escrow balance
            # DB-ready: user_balances.in_escrow += stakePerPlayer
            # FOR UPDATE locks the row for the remainder of this transaction,
            # serializing concurrent event handlers / API writers that touch
            # the same user_balances row (C12).
            session.execute(
                text("SELECT 1 FROM user_balances WHERE user_id = :uid FOR UPDATE"),
                {"uid": user_id},
            )
            session.execute(
                text(
                    "UPDATE user_balances SET in_escrow = in_escrow + :stake WHERE user_id = :uid"
                ),
                {"stake": float(stake_eth), "uid": user_id},
            )
            session.commit()

        logger.info(
            "MatchCreated: db_match=%s on_chain=%s creator=%s",
            db_match_id, on_chain_id, creator_wallet,
        )

    def _handle_player_deposited(self, event) -> None:
        """
        PlayerDeposited(matchId, player, team, stakePerPlayer, depositsTeamA, depositsTeamB)

        stakePerPlayer is now taken directly from the event (source of truth — on-chain wei)
        rather than from the DB matches.stake_per_player, which may not yet be populated
        when the event fires.  The ABI was updated to include this field (sync: 2026-04-11).

        DB-ready:
          UPDATE match_players SET has_deposited=TRUE, deposited_at=NOW(), deposit_amount=stake
          INSERT transactions  (type='escrow_lock')
          UPDATE matches       SET deposits_received += 1
          UPDATE user_balances SET in_escrow += stakePerPlayer
        """
        args          = event["args"]
        on_chain_id   = args["matchId"]
        player_wallet = args["player"].lower()
        team_int      = args["team"]           # 0=A, 1=B
        team_letter   = _INT_TO_TEAM[team_int]
        # Use stakePerPlayer from event args — on-chain source of truth (wei → ether)
        stake_wei   = args["stakePerPlayer"]
        stake_eth   = float(Web3.from_wei(stake_wei, "ether"))
        tx_hash     = _event_tx_hash(event)

        with self._session_factory() as session:
            user = session.execute(
                text("SELECT id FROM users WHERE LOWER(wallet_address) = :wallet"),
                {"wallet": player_wallet},
            ).fetchone()
            if not user:
                logger.warning("PlayerDeposited: unknown wallet %s", player_wallet)
                return
            user_id = str(user[0])

            match_row = session.execute(
                text("SELECT id FROM matches WHERE on_chain_match_id = :oid"),
                {"oid": on_chain_id},
            ).fetchone()
            if not match_row:
                logger.warning(
                    "PlayerDeposited: no DB match for on_chain_id=%s", on_chain_id
                )
                return
            db_match_id = str(match_row[0])
            stake       = stake_eth  # from event — no longer reads from DB column

            session.execute(
                text("""
                    UPDATE match_players
                    SET has_deposited  = TRUE,
                        deposited_at   = NOW(),
                        deposit_amount = :stake,
                        wallet_address = :wallet,
                        team           = :team
                    WHERE match_id = :mid AND user_id = :uid
                """),
                {
                    "mid": db_match_id, "uid": user_id,
                    "stake": stake, "wallet": player_wallet, "team": team_letter,
                },
            )
            session.execute(
                text(
                    "UPDATE matches SET deposits_received = deposits_received + 1 WHERE id = :mid"
                ),
                {"mid": db_match_id},
            )
            session.execute(
                text("""
                    INSERT INTO transactions (id, user_id, type, amount, token, status, match_id, tx_hash)
                    VALUES (:id, :uid, 'escrow_lock', :amount, 'BNB', 'completed', :mid, :tx)
                    ON CONFLICT DO NOTHING
                """),
                {
                    "id": str(uuid.uuid4()), "uid": user_id,
                    "amount": stake, "mid": db_match_id,
                    "tx": tx_hash,
                },
            )
            # FOR UPDATE — lock user_balances row before mutating (C12).
            session.execute(
                text("SELECT 1 FROM user_balances WHERE user_id = :uid FOR UPDATE"),
                {"uid": user_id},
            )
            session.execute(
                text(
                    "UPDATE user_balances SET in_escrow = in_escrow + :stake WHERE user_id = :uid"
                ),
                {"stake": stake, "uid": user_id},
            )
            session.commit()

        logger.info(
            "PlayerDeposited: match=%s player=%s team=%s", db_match_id, player_wallet, team_letter
        )

    def _handle_match_active(self, event) -> None:
        """
        MatchActive(matchId) — all players deposited, match begins.

        DB-ready: UPDATE matches SET status='in_progress', started_at=NOW()
        """
        on_chain_id = event["args"]["matchId"]
        with self._session_factory() as session:
            session.execute(
                text("""
                    UPDATE matches
                    SET status = 'in_progress', started_at = NOW()
                    WHERE on_chain_match_id = :oid AND status = 'waiting'
                """),
                {"oid": on_chain_id},
            )
            session.commit()
        logger.info("MatchActive: on_chain=%s → status=in_progress", on_chain_id)

    def _handle_winner_declared(self, event) -> None:
        """
        WinnerDeclared(matchId, winningTeam, payoutPerWinner, fee)

        DB-ready:
          UPDATE matches SET status='completed', ended_at=NOW(), winner_id=<first winner>
          For each winner:   INSERT transactions (type='match_win', amount=payoutPerWinner)
                             UPDATE user_stats   SET wins+=1, total_earnings+=payout
          For each loser:    UPDATE user_stats   SET losses+=1
          INSERT transactions (type='fee', amount=fee)
          UPDATE user_balances: release in_escrow for all players, credit winners
        """
        args           = event["args"]
        on_chain_id    = args["matchId"]
        winning_team   = args["winningTeam"]          # 0=A, 1=B
        payout_wei     = args["payoutPerWinner"]
        fee_wei        = args["fee"]
        payout_eth     = float(Web3.from_wei(payout_wei, "ether"))
        fee_eth        = float(Web3.from_wei(fee_wei,    "ether"))
        winning_letter = _INT_TO_TEAM[winning_team]
        losing_letter  = _INT_TO_TEAM[1 - winning_team]
        tx_hash        = _event_tx_hash(event)

        with self._session_factory() as session:
            match_row = session.execute(
                text("SELECT id FROM matches WHERE on_chain_match_id = :oid"),
                {"oid": on_chain_id},
            ).fetchone()
            if not match_row:
                logger.warning(
                    "WinnerDeclared: no DB match for on_chain_id=%s", on_chain_id
                )
                return
            db_match_id = str(match_row[0])

            # All players in this match
            players = session.execute(
                text("SELECT user_id, team FROM match_players WHERE match_id = :mid"),
                {"mid": db_match_id},
            ).fetchall()

            winner_id: Optional[str] = None
            for (player_id, team) in players:
                player_id = str(player_id)
                if team == winning_letter:
                    if winner_id is None:
                        winner_id = player_id   # first winner for winner_id FK
                    # match_win transaction
                    session.execute(
                        text("""
                            INSERT INTO transactions
                                (id, user_id, type, amount, token, status, match_id, tx_hash)
                            VALUES (:id, :uid, 'match_win', :amount, 'BNB', 'completed', :mid, :tx)
                            ON CONFLICT DO NOTHING
                        """),
                        {
                            "id": str(uuid.uuid4()), "uid": player_id,
                            "amount": payout_eth, "mid": db_match_id,
                            "tx": tx_hash,
                        },
                    )
                    session.execute(
                        text("""
                            UPDATE user_stats
                            SET wins = wins + 1,
                                total_earnings = total_earnings + :payout
                            WHERE user_id = :uid
                        """),
                        {"payout": payout_eth, "uid": player_id},
                    )
                    # FOR UPDATE — lock winner's user_balances row (C12).
                    session.execute(
                        text("SELECT 1 FROM user_balances WHERE user_id = :uid FOR UPDATE"),
                        {"uid": player_id},
                    )
                    session.execute(
                        text("""
                            UPDATE user_balances
                            SET available = available + :payout,
                                in_escrow = GREATEST(0, in_escrow - :stake)
                            WHERE user_id = :uid
                        """),
                        {"payout": payout_eth, "uid": player_id, "stake": payout_eth},
                    )
                else:
                    session.execute(
                        text("UPDATE user_stats SET losses = losses + 1 WHERE user_id = :uid"),
                        {"uid": player_id},
                    )
                    # FOR UPDATE — lock loser's user_balances row (C12).
                    session.execute(
                        text("SELECT 1 FROM user_balances WHERE user_id = :uid FOR UPDATE"),
                        {"uid": player_id},
                    )
                    session.execute(
                        text("""
                            UPDATE user_balances
                            SET in_escrow = GREATEST(0, in_escrow - :stake)
                            WHERE user_id = :uid
                        """),
                        {"uid": player_id, "stake": payout_eth},
                    )

            # Platform fee transaction
            session.execute(
                text("""
                    INSERT INTO transactions
                        (id, type, amount, token, status, match_id, tx_hash)
                    VALUES (:id, 'fee', :amount, 'BNB', 'completed', :mid, :tx)
                    ON CONFLICT DO NOTHING
                """),
                {
                    "id": str(uuid.uuid4()), "amount": fee_eth,
                    "mid": db_match_id, "tx": tx_hash,
                },
            )

            # Update match record
            session.execute(
                text("""
                    UPDATE matches
                    SET status = 'completed', ended_at = NOW(), winner_id = :wid
                    WHERE id = :mid
                """),
                {"wid": winner_id, "mid": db_match_id},
            )
            session.commit()

        logger.info(
            "WinnerDeclared: match=%s winner_team=%s payout=%.4f BNB fee=%.4f BNB",
            db_match_id, winning_letter, payout_eth, fee_eth,
        )

    def _handle_tie_declared(self, event) -> None:
        """
        TieDeclared(matchId, refundPerPlayer, fee)

        DB-ready:
          UPDATE matches SET status='tied', ended_at=NOW()
          For each player:
            INSERT transactions (type='tie_refund', amount=refundPerPlayer)
            UPDATE user_stats   SET ties += 1
            UPDATE user_balances SET available += refundPerPlayer, in_escrow -= stake
          INSERT transactions (type='fee', amount=fee) [platform fee]
        """
        args            = event["args"]
        on_chain_id     = args["matchId"]
        refund_wei      = args["refundPerPlayer"]
        fee_wei         = args["fee"]
        refund_eth      = float(Web3.from_wei(refund_wei, "ether"))
        fee_eth         = float(Web3.from_wei(fee_wei, "ether"))
        tx_hash         = _event_tx_hash(event)

        with self._session_factory() as session:
            match_row = session.execute(
                text(
                    "SELECT id, stake_per_player, status "
                    "FROM matches WHERE on_chain_match_id = :oid FOR UPDATE"
                ),
                {"oid": on_chain_id},
            ).fetchone()
            if not match_row:
                logger.warning(
                    "_handle_tie_declared: no DB match for on_chain_id=%s", on_chain_id
                )
                return

            db_match_id    = str(match_row[0])
            current_status = match_row[2]

            if current_status == "tied":
                logger.info(
                    "_handle_tie_declared: match=%s already tied — skipping (replay guard)",
                    db_match_id,
                )
                return

            players = session.execute(
                text("SELECT user_id FROM match_players WHERE match_id = :mid"),
                {"mid": db_match_id},
            ).fetchall()

            for (player_id,) in players:
                player_id = str(player_id)
                session.execute(
                    text("""
                        INSERT INTO transactions
                            (id, user_id, type, amount, token, status, match_id, tx_hash)
                        VALUES (:id, :uid, 'tie_refund', :amount, 'BNB', 'completed', :mid, :tx)
                        ON CONFLICT DO NOTHING
                    """),
                    {
                        "id": str(uuid.uuid4()), "uid": player_id,
                        "amount": refund_eth, "mid": db_match_id,
                        "tx": tx_hash,
                    },
                )
                session.execute(
                    text("UPDATE user_stats SET ties = ties + 1 WHERE user_id = :uid"),
                    {"uid": player_id},
                )
                session.execute(
                    text("SELECT 1 FROM user_balances WHERE user_id = :uid FOR UPDATE"),
                    {"uid": player_id},
                )
                session.execute(
                    text("""
                        UPDATE user_balances
                        SET available = available + :refund,
                            in_escrow = GREATEST(0, in_escrow - :refund)
                        WHERE user_id = :uid
                    """),
                    {"refund": refund_eth, "uid": player_id},
                )

            session.execute(
                text("""
                    INSERT INTO transactions
                        (id, type, amount, token, status, match_id, tx_hash)
                    VALUES (:id, 'fee', :amount, 'BNB', 'completed', :mid, :tx)
                    ON CONFLICT DO NOTHING
                """),
                {
                    "id": str(uuid.uuid4()), "amount": fee_eth,
                    "mid": db_match_id, "tx": tx_hash,
                },
            )

            session.execute(
                text("UPDATE matches SET status = 'tied', ended_at = NOW() WHERE id = :mid"),
                {"mid": db_match_id},
            )
            session.commit()

        logger.info(
            "_handle_tie_declared: match=%s refund=%.4f BNB fee=%.4f BNB players=%d",
            db_match_id, refund_eth, fee_eth, len(players),
        )

    def _handle_payout_credited(self, event) -> None:
        """
        PayoutCredited(recipient, amount) — direct ETH transfer failed inside a payout
        loop (declareWinner / declareTie / cancelMatch / cancelWaiting / claimRefund).
        Funds sit in pendingWithdrawals[recipient] until the user calls withdraw().

        DB-ready:
          UPSERT pending_withdrawals — amount_wei += credited amount (same wallet, same match).
          INSERT transactions (type='pending_withdrawal_credit') for audit trail.
        """
        args      = event["args"]
        recipient = args["recipient"].lower()
        amount    = int(args["amount"])
        tx_hash   = _event_tx_hash(event)

        if amount == 0:
            return

        with self._session_factory() as session:
            user = session.execute(
                text("SELECT id FROM users WHERE LOWER(wallet_address) = :wallet"),
                {"wallet": recipient},
            ).fetchone()
            if not user:
                logger.warning("PayoutCredited: unknown wallet %s (amount=%d wei)", recipient, amount)
                return
            user_id = str(user[0])

            # Try to link to the match that caused this credit via tx_hash
            match_row = session.execute(
                text("SELECT id FROM matches WHERE on_chain_match_id = ("
                     "SELECT on_chain_match_id FROM matches m "
                     "JOIN transactions t ON t.match_id = m.id "
                     "WHERE t.tx_hash = :tx LIMIT 1)"),
                {"tx": tx_hash},
            ).fetchone()
            match_id = str(match_row[0]) if match_row else None

            session.execute(
                text("""
                    INSERT INTO pending_withdrawals
                        (user_id, wallet_addr, amount_wei, match_id)
                    VALUES (:uid, :wallet, :amt, :mid)
                    ON CONFLICT (wallet_addr, match_id)
                    DO UPDATE SET amount_wei = pending_withdrawals.amount_wei + EXCLUDED.amount_wei
                """),
                {"uid": user_id, "wallet": recipient, "amt": amount, "mid": match_id},
            )
            session.execute(
                text("""
                    INSERT INTO transactions
                        (id, user_id, type, amount, token, status, match_id, tx_hash)
                    VALUES (:id, :uid, 'pending_withdrawal_credit', :amt_bnb, 'BNB', 'pending', :mid, :tx)
                    ON CONFLICT DO NOTHING
                """),
                {
                    "id": str(uuid.uuid4()), "uid": user_id,
                    "amt_bnb": float(Web3.from_wei(amount, "ether")),
                    "mid": match_id, "tx": tx_hash,
                },
            )
            session.commit()

        logger.info(
            "PayoutCredited: wallet=%s amount=%d wei — funds held in contract pullPayment",
            recipient, amount,
        )

    def _handle_withdrawn(self, event) -> None:
        """
        Withdrawn(recipient, amount) — user successfully called withdraw() to pull
        their pendingWithdrawals credit.

        DB-ready:
          UPDATE pending_withdrawals SET claimed_at=NOW(), claim_tx=tx_hash
          UPDATE transactions SET status='completed' WHERE type='pending_withdrawal_credit'
        """
        args      = event["args"]
        recipient = args["recipient"].lower()
        amount    = int(args["amount"])
        tx_hash   = _event_tx_hash(event)

        with self._session_factory() as session:
            user = session.execute(
                text("SELECT id FROM users WHERE LOWER(wallet_address) = :wallet"),
                {"wallet": recipient},
            ).fetchone()
            if not user:
                logger.warning("Withdrawn: unknown wallet %s", recipient)
                return
            user_id = str(user[0])

            session.execute(
                text("""
                    UPDATE pending_withdrawals
                    SET claimed_at = NOW(), claim_tx = :tx
                    WHERE wallet_addr = :wallet AND claimed_at IS NULL
                """),
                {"tx": tx_hash, "wallet": recipient},
            )
            session.execute(
                text("""
                    UPDATE transactions
                    SET status = 'completed'
                    WHERE user_id = :uid AND type = 'pending_withdrawal_credit' AND status = 'pending'
                """),
                {"uid": user_id},
            )
            session.execute(
                text("""
                    INSERT INTO transactions
                        (id, user_id, type, amount, token, status, tx_hash)
                    VALUES (:id, :uid, 'pending_withdrawal_claimed', :amt, 'BNB', 'completed', :tx)
                    ON CONFLICT DO NOTHING
                """),
                {
                    "id": str(uuid.uuid4()), "uid": user_id,
                    "amt": float(Web3.from_wei(amount, "ether")),
                    "tx": tx_hash,
                },
            )
            session.commit()

        logger.info("Withdrawn: wallet=%s amount=%d wei", recipient, amount)

    def _handle_match_refunded(self, event) -> None:
        """
        MatchRefunded(matchId) — timeout triggered, all deposits returned.
        Handles rage-quit (Issue #56): player let the match expire → refund.

        DB-ready: UPDATE matches SET status='cancelled' + refund txs for all players
        """
        on_chain_id = event["args"]["matchId"]
        self._refund_all_players(
            on_chain_id, reason="refund_timeout", tx_hash=_event_tx_hash(event)
        )

    def _handle_match_cancelled(self, event) -> None:
        """
        MatchCancelled(matchId, cancelledBy) — host or oracle cancelled WAITING match.
        Only depositors receive refunds (non-depositors had nothing in escrow).

        DB-ready: UPDATE matches SET status='cancelled' + refund txs for depositors
        """
        on_chain_id = event["args"]["matchId"]
        self._refund_all_players(
            on_chain_id,
            reason="refund_cancel",
            depositors_only=True,
            tx_hash=_event_tx_hash(event),
        )

    def _refund_all_players(
        self,
        on_chain_id: int,
        reason: str,
        depositors_only: bool = False,
        tx_hash: str | None = None,
    ) -> None:
        """
        Shared refund logic for MatchRefunded / MatchCancelled.

        Idempotent: if the match is already 'cancelled' in DB we skip immediately —
        same guard pattern as _at_payout_already_happened() for AT matches.
        The match row is locked FOR UPDATE so concurrent event replays serialize
        and only the first caller proceeds.

        DB-ready:
          UPDATE matches SET status='cancelled', ended_at=NOW()
          For each (deposited) player:
            INSERT transactions (type='refund') ON CONFLICT (tx_hash) DO NOTHING
            UPDATE user_balances SET available += stake, in_escrow -= stake
        """
        with self._session_factory() as session:
            # FOR UPDATE — serialize concurrent / replayed event handlers for this match.
            match_row = session.execute(
                text(
                    "SELECT id, stake_per_player, status "
                    "FROM matches WHERE on_chain_match_id = :oid FOR UPDATE"
                ),
                {"oid": on_chain_id},
            ).fetchone()
            if not match_row:
                logger.warning(
                    "_refund_all_players: no DB match for on_chain_id=%s", on_chain_id
                )
                return

            db_match_id   = str(match_row[0])
            stake         = float(match_row[1]) if match_row[1] else 0.0
            current_status = match_row[2]

            # Idempotency guard — already processed, do not double-credit.
            if current_status == "cancelled":
                logger.info(
                    "_refund_all_players: match=%s already cancelled — skipping (reason=%s)",
                    db_match_id, reason,
                )
                return

            query_str = (
                "SELECT user_id FROM match_players WHERE match_id = :mid AND has_deposited = TRUE"
                if depositors_only
                else "SELECT user_id FROM match_players WHERE match_id = :mid"
            )
            players = session.execute(text(query_str), {"mid": db_match_id}).fetchall()

            for (player_id,) in players:
                player_id = str(player_id)

                # ON CONFLICT on idx_transactions_tx_hash_unique blocks duplicate
                # rows when the same tx_hash is replayed. Double-credit is prevented
                # by the status guard above — we return early if already 'cancelled'.
                session.execute(
                    text("""
                        INSERT INTO transactions
                            (id, user_id, type, amount, token, status, match_id, tx_hash)
                        VALUES (:id, :uid, 'refund', :amount, 'BNB', 'completed', :mid, :tx)
                        ON CONFLICT DO NOTHING
                    """),
                    {
                        "id": str(uuid.uuid4()), "uid": player_id,
                        "amount": stake, "mid": db_match_id,
                        "tx": tx_hash,
                    },
                )
                # FOR UPDATE — lock user_balances row before mutation (C12).
                session.execute(
                    text("SELECT 1 FROM user_balances WHERE user_id = :uid FOR UPDATE"),
                    {"uid": player_id},
                )
                session.execute(
                    text("""
                        UPDATE user_balances
                        SET available = available + :stake,
                            in_escrow = GREATEST(0, in_escrow - :stake)
                        WHERE user_id = :uid
                    """),
                    {"stake": stake, "uid": player_id},
                )

            session.execute(
                text(
                    "UPDATE matches SET status = 'cancelled', ended_at = NOW() WHERE id = :mid"
                ),
                {"mid": db_match_id},
            )
            session.commit()

        logger.info(
            "_refund_all_players: match=%s reason=%s players=%d",
            db_match_id, reason, len(players),
        )

    # ── Internal tx helper ────────────────────────────────────────────────────

    def _send_tx(self, fn, gas: int, account=None) -> str:
        """
        Build, sign, send a transaction and wait for receipt.
        Returns the tx_hash hex string.

        account: defaults to self._account (oracle wallet).
                 Pass self._owner_account for onlyOwner calls (pause/unpause).

        CONTRACT-ready: used by declare_winner(), cancel_match_on_chain(),
                        pause_contract(), unpause_contract()
        """
        signer = account if account is not None else self._account
        nonce  = self._w3.eth.get_transaction_count(signer.address)
        tx     = fn.build_transaction({
            "from":     signer.address,
            "nonce":    nonce,
            "gas":      gas,
            "gasPrice": self._w3.eth.gas_price,
        })
        signed  = self._w3.eth.account.sign_transaction(tx, signer.key)
        tx_hash = self._w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = self._w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        if receipt["status"] != 1:
            raise RuntimeError(f"Transaction reverted: {tx_hash.hex()}")
        return tx_hash.hex()


# ── Factory ───────────────────────────────────────────────────────────────────

def build_escrow_client(session_factory) -> Optional[EscrowClient]:
    """
    Builds an EscrowClient from environment variables.
    Returns None if any required variable is missing — engine runs without escrow.

    Required env vars:
      BLOCKCHAIN_RPC_URL  — e.g. https://data-seed-prebsc-1-s1.binance.org:8545
      CONTRACT_ADDRESS    — deployed ArenaEscrow address (auto-filled by deploy.js)
      PRIVATE_KEY         — oracle wallet private key (hex, with or without 0x)

    DB-ready: session_factory = SQLAlchemy SessionLocal
    CONTRACT-ready: called at engine startup in main.py lifespan
    """
    rpc_url           = os.getenv("BLOCKCHAIN_RPC_URL", "").strip()
    contract_address  = os.getenv("CONTRACT_ADDRESS",   "").strip()
    private_key       = os.getenv("PRIVATE_KEY",        "").strip()
    # OWNER_PRIVATE_KEY is optional — required only for pause()/unpause().
    # If absent, EscrowClient still works; pause_contract() / unpause_contract()
    # log a warning and return None (in-memory _PAYOUTS_FROZEN still takes effect).
    owner_private_key = os.getenv("OWNER_PRIVATE_KEY",  "").strip() or None

    if not rpc_url or not contract_address or not private_key:
        logger.info(
            "EscrowClient disabled — missing env vars "
            "(BLOCKCHAIN_RPC_URL=%s CONTRACT_ADDRESS=%s PRIVATE_KEY=%s)",
            bool(rpc_url), bool(contract_address), bool(private_key),
        )
        return None

    return EscrowClient(
        rpc_url=rpc_url,
        contract_address=contract_address,
        private_key=private_key,
        session_factory=session_factory,
        owner_private_key=owner_private_key,
    )
