"""
Tests for ConnectionManager (engine/src/ws_manager.py).

Covers:
  1. connect()           — registers socket in user + match rooms
  2. disconnect()        — cleans up all dicts, removes empty keys
  3. subscribe_match()   — joins room mid-session, leaves old room
  4. unsubscribe_match() — leaves match room, keeps user channel
  5. broadcast_to_match  — sends JSON to every socket in room
  6. broadcast_to_user   — sends JSON to every session of a user
  7. broadcast_all       — sends to every connected socket
  8. _send_safe          — swallows send errors silently
  9. stats property      — reflects live connection counts
  10. fire_match / fire_user — no-op when no event loop is running
"""
from __future__ import annotations

import asyncio
import json
import uuid

import pytest

from src.ws_manager import ConnectionManager


# ── Fake WebSocket ────────────────────────────────────────────────────────────

class _FakeWs:
    """Minimal stand-in for fastapi.WebSocket in unit tests."""

    def __init__(self) -> None:
        self.sent: list[str] = []
        self.accepted = False
        self._raise_on_send: Exception | None = None

    async def accept(self) -> None:
        self.accepted = True

    async def send_text(self, msg: str) -> None:
        if self._raise_on_send:
            raise self._raise_on_send
        self.sent.append(msg)

    def fail_next_send(self, exc: Exception) -> None:
        self._raise_on_send = exc


def _run(coro):
    return asyncio.run(coro)


def _uid() -> str:
    return str(uuid.uuid4())


# ── 1. connect ────────────────────────────────────────────────────────────────

class TestConnect:
    def test_accepts_socket(self):
        mgr = ConnectionManager()
        ws  = _FakeWs()
        _run(mgr.connect(ws, "user-1"))
        assert ws.accepted

    def test_registers_in_user_channel(self):
        mgr = ConnectionManager()
        ws  = _FakeWs()
        uid = _uid()
        _run(mgr.connect(ws, uid))
        assert ws in mgr._user_sockets[uid]

    def test_registers_in_match_room_when_given(self):
        mgr = ConnectionManager()
        ws  = _FakeWs()
        uid, mid = _uid(), _uid()
        _run(mgr.connect(ws, uid, mid))
        assert ws in mgr._match_sockets[mid]

    def test_no_match_room_when_match_id_none(self):
        mgr = ConnectionManager()
        ws  = _FakeWs()
        _run(mgr.connect(ws, _uid(), None))
        assert len(mgr._match_sockets) == 0

    def test_stats_increments(self):
        mgr = ConnectionManager()
        assert mgr.stats["total_connections"] == 0
        _run(mgr.connect(_FakeWs(), _uid()))
        assert mgr.stats["total_connections"] == 1


# ── 2. disconnect ─────────────────────────────────────────────────────────────

class TestDisconnect:
    def test_removes_from_user_channel(self):
        mgr = ConnectionManager()
        ws  = _FakeWs()
        uid = _uid()
        _run(mgr.connect(ws, uid))
        _run(mgr.disconnect(ws))
        assert uid not in mgr._user_sockets

    def test_removes_from_match_room(self):
        mgr = ConnectionManager()
        ws  = _FakeWs()
        uid, mid = _uid(), _uid()
        _run(mgr.connect(ws, uid, mid))
        _run(mgr.disconnect(ws))
        assert mid not in mgr._match_sockets

    def test_removes_from_socket_meta(self):
        mgr = ConnectionManager()
        ws  = _FakeWs()
        _run(mgr.connect(ws, _uid()))
        _run(mgr.disconnect(ws))
        assert ws not in mgr._socket_meta

    def test_double_disconnect_is_safe(self):
        mgr = ConnectionManager()
        ws  = _FakeWs()
        _run(mgr.connect(ws, _uid()))
        _run(mgr.disconnect(ws))
        _run(mgr.disconnect(ws))  # must not raise

    def test_cleans_up_empty_user_key(self):
        mgr = ConnectionManager()
        ws  = _FakeWs()
        uid = _uid()
        _run(mgr.connect(ws, uid))
        _run(mgr.disconnect(ws))
        assert uid not in mgr._user_sockets

    def test_keeps_other_sockets_in_user_channel(self):
        mgr = ConnectionManager()
        uid = _uid()
        ws1, ws2 = _FakeWs(), _FakeWs()
        _run(mgr.connect(ws1, uid))
        _run(mgr.connect(ws2, uid))
        _run(mgr.disconnect(ws1))
        assert ws2 in mgr._user_sockets[uid]


# ── 3. subscribe_match ────────────────────────────────────────────────────────

class TestSubscribeMatch:
    def test_joins_match_room(self):
        mgr = ConnectionManager()
        ws  = _FakeWs()
        uid, mid = _uid(), _uid()
        _run(mgr.connect(ws, uid))
        _run(mgr.subscribe_match(ws, mid))
        assert ws in mgr._match_sockets[mid]

    def test_leaves_old_room_on_switch(self):
        mgr = ConnectionManager()
        ws  = _FakeWs()
        uid, mid1, mid2 = _uid(), _uid(), _uid()
        _run(mgr.connect(ws, uid, mid1))
        _run(mgr.subscribe_match(ws, mid2))
        assert mid1 not in mgr._match_sockets
        assert ws in mgr._match_sockets[mid2]

    def test_noop_for_unknown_socket(self):
        mgr = ConnectionManager()
        ws  = _FakeWs()
        _run(mgr.subscribe_match(ws, _uid()))  # must not raise


# ── 4. unsubscribe_match ──────────────────────────────────────────────────────

class TestUnsubscribeMatch:
    def test_leaves_match_room(self):
        mgr = ConnectionManager()
        ws  = _FakeWs()
        uid, mid = _uid(), _uid()
        _run(mgr.connect(ws, uid, mid))
        _run(mgr.unsubscribe_match(ws))
        assert mid not in mgr._match_sockets

    def test_keeps_user_channel(self):
        mgr = ConnectionManager()
        ws  = _FakeWs()
        uid, mid = _uid(), _uid()
        _run(mgr.connect(ws, uid, mid))
        _run(mgr.unsubscribe_match(ws))
        assert ws in mgr._user_sockets[uid]

    def test_noop_when_not_in_match(self):
        mgr = ConnectionManager()
        ws  = _FakeWs()
        _run(mgr.connect(ws, _uid()))
        _run(mgr.unsubscribe_match(ws))  # must not raise


# ── 5. broadcast_to_match ────────────────────────────────────────────────────

class TestBroadcastToMatch:
    def test_sends_to_all_room_sockets(self):
        mgr = ConnectionManager()
        uid1, uid2, mid = _uid(), _uid(), _uid()
        ws1, ws2 = _FakeWs(), _FakeWs()
        _run(mgr.connect(ws1, uid1, mid))
        _run(mgr.connect(ws2, uid2, mid))
        _run(mgr.broadcast_to_match(mid, "match:status_changed", {"status": "completed"}))
        for ws in (ws1, ws2):
            assert len(ws.sent) == 1
            payload = json.loads(ws.sent[0])
            assert payload["type"] == "match:status_changed"
            assert payload["data"]["status"] == "completed"

    def test_does_not_send_to_other_room(self):
        mgr = ConnectionManager()
        ws1, ws2 = _FakeWs(), _FakeWs()
        mid1, mid2 = _uid(), _uid()
        _run(mgr.connect(ws1, _uid(), mid1))
        _run(mgr.connect(ws2, _uid(), mid2))
        _run(mgr.broadcast_to_match(mid1, "ping", {}))
        assert len(ws1.sent) == 1
        assert len(ws2.sent) == 0

    def test_noop_for_empty_room(self):
        mgr = ConnectionManager()
        _run(mgr.broadcast_to_match(_uid(), "ping", {}))  # must not raise


# ── 6. broadcast_to_user ─────────────────────────────────────────────────────

class TestBroadcastToUser:
    def test_sends_to_all_user_sessions(self):
        mgr = ConnectionManager()
        uid = _uid()
        ws1, ws2 = _FakeWs(), _FakeWs()
        _run(mgr.connect(ws1, uid))
        _run(mgr.connect(ws2, uid))
        _run(mgr.broadcast_to_user(uid, "notification:new", {"msg": "hi"}))
        for ws in (ws1, ws2):
            assert len(ws.sent) == 1
            assert json.loads(ws.sent[0])["data"]["msg"] == "hi"

    def test_does_not_send_to_other_user(self):
        mgr = ConnectionManager()
        ws1, ws2 = _FakeWs(), _FakeWs()
        uid1, uid2 = _uid(), _uid()
        _run(mgr.connect(ws1, uid1))
        _run(mgr.connect(ws2, uid2))
        _run(mgr.broadcast_to_user(uid1, "ping", {}))
        assert len(ws1.sent) == 1
        assert len(ws2.sent) == 0

    def test_noop_for_unknown_user(self):
        mgr = ConnectionManager()
        _run(mgr.broadcast_to_user(_uid(), "ping", {}))  # must not raise


# ── 7. broadcast_all ─────────────────────────────────────────────────────────

class TestBroadcastAll:
    def test_sends_to_every_socket(self):
        mgr = ConnectionManager()
        sockets = [_FakeWs() for _ in range(3)]
        for ws in sockets:
            _run(mgr.connect(ws, _uid()))
        _run(mgr.broadcast_all("ping", {"x": 1}))
        for ws in sockets:
            assert len(ws.sent) == 1

    def test_noop_when_no_connections(self):
        mgr = ConnectionManager()
        _run(mgr.broadcast_all("ping", {}))  # must not raise


# ── 8. _send_safe ─────────────────────────────────────────────────────────────

class TestSendSafe:
    def test_swallows_send_errors(self):
        mgr = ConnectionManager()
        ws  = _FakeWs()
        uid, mid = _uid(), _uid()
        _run(mgr.connect(ws, uid, mid))
        ws.fail_next_send(RuntimeError("client gone"))
        # broadcast must not raise even if send fails
        _run(mgr.broadcast_to_match(mid, "ping", {}))


# ── 9. stats ─────────────────────────────────────────────────────────────────

class TestStats:
    def test_counts_correctly(self):
        mgr = ConnectionManager()
        uid, mid = _uid(), _uid()
        ws1, ws2 = _FakeWs(), _FakeWs()
        _run(mgr.connect(ws1, uid, mid))
        _run(mgr.connect(ws2, uid))
        s = mgr.stats
        assert s["total_connections"] == 2
        assert s["user_channels"]     == 1  # both on same uid
        assert s["match_rooms"]       == 1

    def test_decrements_after_disconnect(self):
        mgr = ConnectionManager()
        ws  = _FakeWs()
        _run(mgr.connect(ws, _uid()))
        _run(mgr.disconnect(ws))
        assert mgr.stats["total_connections"] == 0


# ── 10. fire_match / fire_user ────────────────────────────────────────────────

class TestFireHelpers:
    def test_fire_match_noop_without_running_loop(self):
        mgr = ConnectionManager()
        # No running event loop — must not raise
        mgr.fire_match(_uid(), "ping", {})

    def test_fire_user_noop_without_running_loop(self):
        mgr = ConnectionManager()
        mgr.fire_user(_uid(), "ping", {})

    def test_fire_match_schedules_when_loop_running(self):
        """fire_match delegates to broadcast_to_match when a loop is active.

        call_soon_threadsafe schedules create_task (1 yield), then the task
        coroutine itself needs to run (1 more yield) — so we sleep twice.
        """
        async def _inner():
            mgr = ConnectionManager()
            ws  = _FakeWs()
            uid, mid = _uid(), _uid()
            await mgr.connect(ws, uid, mid)
            mgr.fire_match(mid, "match:status_changed", {"status": "completed"})
            await asyncio.sleep(0)  # let create_task be scheduled
            await asyncio.sleep(0)  # let broadcast coroutine run
            return ws.sent

        result = asyncio.run(_inner())
        assert len(result) == 1
        assert json.loads(result[0])["type"] == "match:status_changed"

    def test_fire_user_schedules_when_loop_running(self):
        async def _inner():
            mgr = ConnectionManager()
            ws  = _FakeWs()
            uid = _uid()
            await mgr.connect(ws, uid)
            mgr.fire_user(uid, "notification:new", {"count": 3})
            await asyncio.sleep(0)
            await asyncio.sleep(0)
            return ws.sent

        result = asyncio.run(_inner())
        assert len(result) == 1
        assert json.loads(result[0])["data"]["count"] == 3
