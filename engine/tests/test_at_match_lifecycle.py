"""
AT match room lifecycle — mocked SessionLocal (same style as test_doc_b_match_routes).

Covers leave/kick refunds, AT create, heartbeat + stale removal isolation, roster response.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app
import src.auth as auth

client = TestClient(app)

_HOST_ID = str(uuid.uuid4())
_GUEST_ID = str(uuid.uuid4())
_MATCH_ID = str(uuid.uuid4())
_BAD_UID = str(uuid.uuid4())
_GOOD_UID = str(uuid.uuid4())

_VALID_STEAM = "76561198000000001"

_HOST_TOKEN = auth.issue_token(_HOST_ID, "host@arena.gg", "HostUser")
_GUEST_TOKEN = auth.issue_token(_GUEST_ID, "guest@arena.gg", "GuestUser")

_HOST_HEADERS = {"Authorization": f"Bearer {_HOST_TOKEN}"}
_GUEST_HEADERS = {"Authorization": f"Bearer {_GUEST_TOKEN}"}


@pytest.fixture(autouse=True)
def no_suspension_check():
    with patch("main._assert_not_suspended", return_value=None):
        yield


def _ctx(session: MagicMock):
    ctx = MagicMock()
    ctx.__enter__ = MagicMock(return_value=session)
    ctx.__exit__ = MagicMock(return_value=False)
    return ctx


def _at_match_row(host_id=_HOST_ID):
    return (host_id, "waiting", "AT", 10)


class TestAtLeaveKickCreate:
    def test_at_leave_returns_200_and_refunds(self):
        session = MagicMock()
        session.execute.return_value.fetchone.side_effect = [
            _at_match_row(),
            (1,),  # in_match
        ]
        ctx = _ctx(session)
        credit = MagicMock()
        with patch("main.SessionLocal", return_value=ctx), patch("main._credit_at", credit):
            resp = client.post(
                f"/matches/{_MATCH_ID}/leave",
                headers=_GUEST_HEADERS,
            )
        assert resp.status_code == 200
        assert resp.json() == {"left": True, "match_id": _MATCH_ID}
        credit.assert_called_once()
        args, kwargs = credit.call_args
        assert args[1] == _GUEST_ID
        assert args[2] == 10
        assert args[3] == _MATCH_ID
        assert args[4] == "escrow_refund_leave"

    def test_at_kick_returns_200_and_refunds(self):
        session = MagicMock()
        session.execute.return_value.fetchone.side_effect = [
            _at_match_row(),
            (1,),  # in_room
        ]
        ctx = _ctx(session)
        credit = MagicMock()
        with patch("main.SessionLocal", return_value=ctx), patch("main._credit_at", credit):
            resp = client.post(
                f"/matches/{_MATCH_ID}/kick",
                json={"user_id": _GUEST_ID},
                headers=_HOST_HEADERS,
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["kicked"] is True
        assert body["user_id"] == _GUEST_ID
        credit.assert_called_once()
        assert credit.call_args[0][1] == _GUEST_ID
        assert credit.call_args[0][4] == "escrow_refund_kicked"

    def test_create_match_at_returns_201(self):
        new_mid = str(uuid.uuid4())
        session = MagicMock()
        session.execute.return_value.fetchone.side_effect = [
            (_VALID_STEAM, None, "0xABC"),
            None,  # no active room
            (200,),  # _assert_at_balance
            (0,),  # _get_daily_staked
            (new_mid,),  # INSERT RETURNING id
        ]
        ctx = _ctx(session)
        deduct = MagicMock()
        with patch("main.SessionLocal", return_value=ctx), patch("main._deduct_at", deduct):
            resp = client.post(
                "/matches",
                json={
                    "game": "CS2",
                    "stake_amount": 10,
                    "stake_currency": "AT",
                    "mode": "1v1",
                    "match_type": "custom",
                },
                headers=_HOST_HEADERS,
            )
        assert resp.status_code == 201
        data = resp.json()
        assert data["match_id"] == new_mid
        assert data["code"].startswith("ARENA-")
        assert data["status"] == "waiting"
        assert data["stake_currency"] == "AT"
        deduct.assert_called_once()
        assert deduct.call_args[0][3] == new_mid
        assert deduct.call_args[0][4] == "escrow_lock"


class TestHeartbeatStaleIsolation:
    def _phase1_session(self, *, stale_rows: list):
        """First heartbeat block: UPDATE last_seen + list stale players."""
        n = [0]

        def ex_side(*args, **kwargs):
            m = MagicMock()
            n[0] += 1
            sql = str(args[0])
            if "UPDATE match_players SET last_seen" in sql:
                m.fetchone.return_value = (_HOST_ID,)
            elif "mp.last_seen < NOW()" in sql:
                m.fetchall.return_value = stale_rows
            return m

        s = MagicMock()
        s.execute.side_effect = ex_side
        return s

    def _roster_session(self):
        """Final block: roster + match_info."""
        created = datetime.now(timezone.utc)
        n = [0]

        def ex_side(*args, **kwargs):
            m = MagicMock()
            n[0] += 1
            sql = str(args[0])
            if "JOIN users u" in sql and "match_players mp" in sql:
                m.fetchall.return_value = [
                    (_HOST_ID, "hostuser", None, "H001", "A"),
                ]
            elif "FROM matches WHERE id" in sql:
                m.fetchone.return_value = (
                    "waiting",
                    "CS2",
                    "1v1",
                    "ARENA-TEST1",
                    2,
                    1,
                    _HOST_ID,
                    "custom",
                    10,
                    "AT",
                    created,
                )
            return m

        s = MagicMock()
        s.execute.side_effect = ex_side
        return s

    def test_stale_cleanup_per_player_isolation(self):
        """One stale refund failure must not block the other stale player's removal + commit."""
        s1 = self._phase1_session(
            stale_rows=[
                (_BAD_UID, "AT", 10),
                (_GOOD_UID, "AT", 10),
            ]
        )
        s_bad = MagicMock()
        s_good = MagicMock()
        s4 = self._roster_session()

        credit_calls: list[tuple[str, str]] = []

        def credit_side_effect(sess, uid, amount, mid, tx_type):
            credit_calls.append((str(uid), tx_type))
            if str(uid) == _BAD_UID:
                raise RuntimeError("refund failed for bad_uid")
            return None

        contexts = [_ctx(s1), _ctx(s_bad), _ctx(s_good), _ctx(s4)]
        with patch("main.SessionLocal", side_effect=contexts), patch(
            "main._credit_at", side_effect=credit_side_effect
        ):
            resp = client.post(
                f"/matches/{_MATCH_ID}/heartbeat",
                headers=_HOST_HEADERS,
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["in_match"] is True
        assert body["stale_removed"] == 1
        assert credit_calls == [
            (_BAD_UID, "escrow_refund_disconnect"),
            (_GOOD_UID, "escrow_refund_disconnect"),
        ]
        s_bad.execute.assert_called()
        s_good.execute.assert_called()
        s_good.commit.assert_called_once()
        s_bad.commit.assert_not_called()

    def test_heartbeat_updates_last_seen(self):
        s1 = self._phase1_session(stale_rows=[])
        s2 = self._roster_session()
        contexts = [_ctx(s1), _ctx(s2)]
        with patch("main.SessionLocal", side_effect=contexts):
            resp = client.post(
                f"/matches/{_MATCH_ID}/heartbeat",
                headers=_HOST_HEADERS,
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["in_match"] is True
        assert data["stale_removed"] == 0
        assert len(data["players"]) >= 1
        assert data["players"][0]["user_id"] == _HOST_ID
        assert data["status"] == "waiting"
