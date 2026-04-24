"""Tests for EscrowClient event listener wiring in FastAPI lifespan.

Verifies that:
- _listener_task is started when EscrowClient is available
- _listener_task is NOT started when EscrowClient is None
- _listener_task is cancelled and awaited on shutdown

These tests patch build_escrow_client and asyncio.to_thread so no real
blockchain connection or blocking loop is attempted.
"""
from __future__ import annotations
import asyncio
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ── stub web3 before any engine import ───────────────────────────────────────
if "web3" not in sys.modules:
    _s = MagicMock()
    _s.Web3.HTTPProvider = MagicMock()
    _s.Web3.to_checksum_address = lambda x: x
    _s.Web3.from_wei = lambda v, u: v / 10**18
    _s.exceptions.ContractLogicError = Exception
    sys.modules["web3"] = _s
    sys.modules["web3.exceptions"] = _s.exceptions
    sys.modules["web3.middleware"] = MagicMock()
    sys.modules["web3.types"] = MagicMock()


# ── helpers ───────────────────────────────────────────────────────────────────

def _run(coro):
    """Run a coroutine on a fresh event loop (avoids deprecation warning)."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


async def _drain_lifespan(app):
    """Enter and exit the lifespan context manager once."""
    async with app.router.lifespan_context(app):
        pass


# ── tests ─────────────────────────────────────────────────────────────────────

class TestListenerLifespan:
    def setup_method(self):
        """Reset the module-level _listener_task global before each test."""
        import main
        main._listener_task = None

    def test_listener_task_started_when_escrow_configured(self):
        """When build_escrow_client returns a client, _listener_task must be set."""
        import main

        mock_client = MagicMock()
        mock_client.contract.address = "0xABC"

        async def _never_end():
            await asyncio.sleep(9999)

        with (
            patch("main.build_escrow_client", return_value=mock_client),
            patch("asyncio.to_thread", return_value=_never_end()),
            patch("main.DisconnectMonitor") as MockRQ,
        ):
            MockRQ.return_value.run = AsyncMock()
            _run(_drain_lifespan(main.app))

        assert main._listener_task is not None

    def test_listener_task_not_started_without_escrow(self):
        """When build_escrow_client returns None, _listener_task stays None."""
        import main

        with (
            patch("main.build_escrow_client", return_value=None),
            patch("main.DisconnectMonitor") as MockRQ,
        ):
            MockRQ.return_value.run = AsyncMock()
            _run(_drain_lifespan(main.app))

        assert main._listener_task is None

    def test_listener_task_cancelled_on_shutdown(self):
        """On lifespan exit, _listener_task.cancel() must be called."""
        import main

        mock_client = MagicMock()
        mock_client.contract.address = "0xABC"

        cancel_called = []

        class _FakeTask:
            def cancel(self):
                cancel_called.append(True)

            def done(self):
                return False

            def __await__(self):
                # Simulate CancelledError when the lifespan awaits the task
                raise asyncio.CancelledError()
                yield  # noqa: unreachable — needed to make this an iterator

        async def _never_end():
            await asyncio.sleep(9999)

        _orig_create_task = asyncio.create_task
        call_count = [0]

        def _fake_create_task(coro, **kw):
            call_count[0] += 1
            # 1st call = DisconnectMonitor task (keep real)
            # 2nd call = listener task → return fake so we can spy on .cancel()
            if call_count[0] == 2:
                coro.close()  # discard coroutine cleanly
                return _FakeTask()
            return _orig_create_task(coro, **kw)

        with (
            patch("main.build_escrow_client", return_value=mock_client),
            patch("asyncio.to_thread", return_value=_never_end()),
            patch("asyncio.create_task", side_effect=_fake_create_task),
            patch("main.DisconnectMonitor") as MockRQ,
        ):
            MockRQ.return_value.run = AsyncMock()
            _run(_drain_lifespan(main.app))

        assert cancel_called, "_listener_task.cancel() was never called on shutdown"
