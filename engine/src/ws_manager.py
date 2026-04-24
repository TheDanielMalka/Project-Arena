"""
Arena WebSocket connection manager.

Manages the full lifecycle of WebSocket connections:
  - Per-user channels  (user_id → set of WebSocket)
  - Per-match rooms    (match_id → set of WebSocket)
  - Auth via JWT on connect
  - Thread-safe broadcast using asyncio locks

Design constraints (Phase 1 — single Uvicorn worker):
  In-memory only. If multiple workers are deployed, add Redis
  pub/sub and replace the in-memory dicts before Phase 2 cutover.

Event wire format (JSON sent over the wire):
  { "type": "<namespace>:<action>", "data": { ... } }
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """
    Thread-safe WebSocket connection manager.

    Rooms:
      _user_sockets  : user_id  → {WebSocket, ...}
      _match_sockets : match_id → {WebSocket, ...}
      _socket_meta   : WebSocket → {"user_id": str, "match_id": str|None}

    All public methods are coroutines so they can be awaited from
    async FastAPI route handlers and background tasks.
    """

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._user_sockets:  dict[str, set[WebSocket]] = defaultdict(set)
        self._match_sockets: dict[str, set[WebSocket]] = defaultdict(set)
        self._socket_meta:   dict[WebSocket, dict]     = {}

    async def connect(
        self,
        ws: WebSocket,
        user_id: str,
        match_id: str | None = None,
    ) -> None:
        await ws.accept()
        async with self._lock:
            self._user_sockets[user_id].add(ws)
            self._socket_meta[ws] = {"user_id": user_id, "match_id": match_id}
            if match_id:
                self._match_sockets[match_id].add(ws)
        logger.info("WS connect  user=%s match=%s total=%d",
                    user_id, match_id, len(self._socket_meta))

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            meta = self._socket_meta.pop(ws, {})
            uid  = meta.get("user_id")
            mid  = meta.get("match_id")
            if uid:
                self._user_sockets[uid].discard(ws)
                if not self._user_sockets[uid]:
                    del self._user_sockets[uid]
            if mid:
                self._match_sockets[mid].discard(ws)
                if not self._match_sockets[mid]:
                    del self._match_sockets[mid]
        logger.info("WS disconnect user=%s match=%s total=%d",
                    uid, mid, len(self._socket_meta))

    async def subscribe_match(self, ws: WebSocket, match_id: str) -> None:
        """Join a match room mid-session (e.g. when match transitions to in_progress)."""
        async with self._lock:
            meta = self._socket_meta.get(ws)
            if meta is None:
                return
            old_mid = meta.get("match_id")
            if old_mid and old_mid != match_id:
                self._match_sockets[old_mid].discard(ws)
                if not self._match_sockets[old_mid]:
                    del self._match_sockets[old_mid]
            meta["match_id"] = match_id
            self._match_sockets[match_id].add(ws)

    async def unsubscribe_match(self, ws: WebSocket) -> None:
        """Leave match room (match ended, player left)."""
        async with self._lock:
            meta = self._socket_meta.get(ws)
            if meta is None:
                return
            mid = meta.get("match_id")
            if mid:
                self._match_sockets[mid].discard(ws)
                if not self._match_sockets[mid]:
                    del self._match_sockets[mid]
                meta["match_id"] = None

    # ── Broadcast helpers ─────────────────────────────────────────────────────

    @staticmethod
    def _build(event_type: str, data: dict) -> str:
        return json.dumps({"type": event_type, "data": data})

    async def _send_safe(self, ws: WebSocket, msg: str) -> None:
        try:
            await ws.send_text(msg)
        except Exception as exc:
            logger.debug("WS send failed (client gone): %s", exc)

    async def broadcast_to_match(self, match_id: str, event_type: str, data: dict) -> None:
        """Send event to every connected socket in this match room."""
        async with self._lock:
            sockets = set(self._match_sockets.get(match_id, set()))
        if not sockets:
            return
        msg = self._build(event_type, data)
        await asyncio.gather(*(self._send_safe(ws, msg) for ws in sockets))
        logger.debug("WS broadcast_to_match match=%s type=%s sockets=%d",
                     match_id, event_type, len(sockets))

    async def broadcast_to_user(self, user_id: str, event_type: str, data: dict) -> None:
        """Send event to all sessions owned by this user."""
        async with self._lock:
            sockets = set(self._user_sockets.get(user_id, set()))
        if not sockets:
            return
        msg = self._build(event_type, data)
        await asyncio.gather(*(self._send_safe(ws, msg) for ws in sockets))
        logger.debug("WS broadcast_to_user user=%s type=%s sockets=%d",
                     user_id, event_type, len(sockets))

    async def broadcast_all(self, event_type: str, data: dict) -> None:
        """Send event to every connected socket (system-wide events only)."""
        async with self._lock:
            sockets = set(self._socket_meta.keys())
        if not sockets:
            return
        msg = self._build(event_type, data)
        await asyncio.gather(*(self._send_safe(ws, msg) for ws in sockets))
        logger.debug("WS broadcast_all type=%s sockets=%d", event_type, len(sockets))

    # ── Convenience wrappers (fire-and-forget from sync context) ─────────────

    def fire_match(self, match_id: str, event_type: str, data: dict) -> None:
        """Schedule a match broadcast from a synchronous context (background threads)."""
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                loop.call_soon_threadsafe(
                    loop.create_task,
                    self.broadcast_to_match(match_id, event_type, data),
                )
        except RuntimeError:
            pass

    def fire_user(self, user_id: str, event_type: str, data: dict) -> None:
        """Schedule a user broadcast from a synchronous context."""
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                loop.call_soon_threadsafe(
                    loop.create_task,
                    self.broadcast_to_user(user_id, event_type, data),
                )
        except RuntimeError:
            pass

    # ── Diagnostics ───────────────────────────────────────────────────────────

    @property
    def stats(self) -> dict[str, Any]:
        return {
            "total_connections": len(self._socket_meta),
            "user_channels":     len(self._user_sockets),
            "match_rooms":       len(self._match_sockets),
        }
