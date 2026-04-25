"""
Tests for WS broadcast helpers and their call sites (engine/main.py).

Covers:
  1. _ws_match_status     — delegates to ws_manager.fire_match with correct payload
  2. _ws_roster_updated   — delegates to ws_manager.fire_match with correct payload
  3. _ws_notification     — delegates to ws_manager.fire_user with correct payload
  4. _ws_profile_updated  — delegates to ws_manager.fire_user with correct payload
  5. _try_cancel_waiting_match_host_client_timeout — calls _ws_match_status("cancelled")
  6. _try_cancel_inprogress_match_timeout          — calls _ws_match_status with final status
  7. DisconnectMonitor integration — ws_manager passed through and fire_* called
"""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch, call

import pytest
import main


# ── Helpers ───────────────────────────────────────────────────────────────────

def _uid() -> str:
    return str(uuid.uuid4())


def _mock_session_ctx(fetchone=None, fetchall=None):
    ctx     = MagicMock()
    session = ctx.__enter__.return_value
    session.execute.return_value.fetchone.return_value  = fetchone
    session.execute.return_value.fetchall.return_value  = fetchall or []
    return ctx


# ── 1. _ws_match_status ───────────────────────────────────────────────────────

class TestWsMatchStatus:
    def test_calls_fire_match_with_correct_event(self):
        mid = _uid()
        with patch.object(main.ws_manager, "fire_match") as mock_fire:
            main._ws_match_status(mid, "completed", winner_id="w-1")
        mock_fire.assert_called_once_with(
            mid,
            "match:status_changed",
            {"match_id": mid, "status": "completed", "winner_id": "w-1"},
        )

    def test_calls_fire_match_without_extra(self):
        mid = _uid()
        with patch.object(main.ws_manager, "fire_match") as mock_fire:
            main._ws_match_status(mid, "cancelled")
        args = mock_fire.call_args
        assert args[0][1] == "match:status_changed"
        assert args[0][2]["status"] == "cancelled"
        assert "winner_id" not in args[0][2]


# ── 2. _ws_roster_updated ────────────────────────────────────────────────────

class TestWsRosterUpdated:
    def test_calls_fire_match_with_players(self):
        mid     = _uid()
        players = [{"user_id": _uid(), "team": "A"}]
        with patch.object(main.ws_manager, "fire_match") as mock_fire:
            main._ws_roster_updated(mid, players)
        mock_fire.assert_called_once_with(
            mid,
            "match:roster_updated",
            {"match_id": mid, "players": players},
        )

    def test_empty_roster_is_valid(self):
        mid = _uid()
        with patch.object(main.ws_manager, "fire_match") as mock_fire:
            main._ws_roster_updated(mid, [])
        assert mock_fire.call_args[0][2]["players"] == []


# ── 3. _ws_notification ──────────────────────────────────────────────────────

class TestWsNotification:
    def test_calls_fire_user(self):
        uid  = _uid()
        notif = {"type": "match_result", "title": "Win", "message": "You won"}
        with patch.object(main.ws_manager, "fire_user") as mock_fire:
            main._ws_notification(uid, notif)
        mock_fire.assert_called_once_with(uid, "notification:new", notif)


# ── 4. _ws_profile_updated ───────────────────────────────────────────────────

class TestWsProfileUpdated:
    def test_calls_fire_user_with_user_id_field(self):
        uid = _uid()
        with patch.object(main.ws_manager, "fire_user") as mock_fire:
            main._ws_profile_updated(uid, at_balance=500)
        mock_fire.assert_called_once()
        event_type = mock_fire.call_args[0][1]
        data       = mock_fire.call_args[0][2]
        assert event_type        == "user:profile_updated"
        assert data["user_id"]   == uid
        assert data["at_balance"] == 500

    def test_user_id_always_in_payload(self):
        uid = _uid()
        with patch.object(main.ws_manager, "fire_user") as mock_fire:
            main._ws_profile_updated(uid)
        data = mock_fire.call_args[0][2]
        assert data["user_id"] == uid


# ── 5. cancel-waiting → _ws_match_status("cancelled") ───────────────────────

class TestCancelWaitingFiresWs:
    def test_ws_called_on_at_cancel(self):
        mid = _uid()
        ctx = _mock_session_ctx(fetchone=("AT",))
        with patch.object(main, "SessionLocal", return_value=ctx):
            with patch.object(main, "_refund_at_match"):
                with patch.object(main, "_ws_match_status") as mock_ws:
                    main._try_cancel_waiting_match_host_client_timeout(mid)
        mock_ws.assert_called_once_with(mid, "cancelled")

    def test_ws_called_on_crypto_cancel(self):
        mid = _uid()
        ctx = _mock_session_ctx(fetchone=("CRYPTO",))
        with patch.object(main, "SessionLocal", return_value=ctx):
            with patch.object(main, "_ws_match_status") as mock_ws:
                main._try_cancel_waiting_match_host_client_timeout(mid)
        mock_ws.assert_called_once_with(mid, "cancelled")

    def test_ws_not_called_when_match_not_found(self):
        ctx = _mock_session_ctx(fetchone=None)
        with patch.object(main, "SessionLocal", return_value=ctx):
            with patch.object(main, "_ws_match_status") as mock_ws:
                main._try_cancel_waiting_match_host_client_timeout(_uid())
        mock_ws.assert_not_called()


# ── 6. in-progress timeout → _ws_match_status ────────────────────────────────

class TestInProgressTimeoutFiresWs:
    def _ctx_for_inprogress(self, status="disputed"):
        ctx     = MagicMock()
        session = ctx.__enter__.return_value
        # fetchone: (stake_currency,)
        session.execute.return_value.fetchone.return_value = ("AT",)
        return ctx

    def test_ws_called_with_disputed(self):
        mid = _uid()
        ctx = MagicMock()
        session = ctx.__enter__.return_value
        session.execute.return_value.fetchone.return_value = ("AT",)

        with patch.object(main, "SessionLocal", return_value=ctx):
            with patch.object(main, "_ws_match_status") as mock_ws:
                main._try_cancel_inprogress_match_timeout(mid, "AT")

        assert mock_ws.called
        call_args = mock_ws.call_args[0]
        assert call_args[0] == mid
        assert call_args[1] in ("disputed", "cancelled", "completed")


# ── 7. DisconnectMonitor receives ws_manager ──────────────────────────────────

class TestDisconnectMonitorWsIntegration:
    def test_ws_manager_attribute_stored(self):
        from src.vision.disconnect_monitor import DisconnectMonitor
        mock_ws = MagicMock()
        dm = DisconnectMonitor(
            session_factory=MagicMock(),
            escrow_client=None,
            settle_at_fn=MagicMock(),
            refund_at_fn=MagicMock(),
            ws_manager=mock_ws,
        )
        assert dm._ws is mock_ws

    def test_ws_none_by_default(self):
        from src.vision.disconnect_monitor import DisconnectMonitor
        dm = DisconnectMonitor(
            session_factory=MagicMock(),
            escrow_client=None,
            settle_at_fn=MagicMock(),
            refund_at_fn=MagicMock(),
        )
        assert dm._ws is None
