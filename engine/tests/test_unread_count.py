"""
GET /messages/unread/count, POST /messages, POST /messages/{id}/read

# TODO[GOOGLE]: POST /auth/google — implement after Client ID received
# TODO[VERIF]: Steam/Riot API call — implement after API keys in platform_config
"""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app
import src.auth as auth

client = TestClient(app)

_ME = str(uuid.uuid4())
_FRIEND = str(uuid.uuid4())
_TOKEN = auth.issue_token(_ME, "unread@arena.gg", "UnreadUser")
_HEADERS = {"Authorization": f"Bearer {_TOKEN}"}


def _session_ctx(session: MagicMock):
    ctx = MagicMock()
    ctx.__enter__ = MagicMock(return_value=session)
    ctx.__exit__ = MagicMock(return_value=False)
    return ctx


@pytest.fixture(autouse=True)
def _daily_patches():
    with patch("main._get_daily_staked", return_value=0), patch("main._get_daily_limit", return_value=50_000):
        yield


class TestUnreadCount:
    def test_unread_count_zero_no_messages(self):
        session = MagicMock()
        session.execute.return_value.scalar.side_effect = [0, 0]
        with patch("main.SessionLocal", return_value=_session_ctx(session)):
            r = client.get("/messages/unread/count", headers=_HEADERS)
        assert r.status_code == 200
        assert r.json() == {"count": 0}

    def test_unread_count_with_messages(self):
        session = MagicMock()
        session.execute.return_value.scalar.side_effect = [2, 1]
        with patch("main.SessionLocal", return_value=_session_ctx(session)):
            r = client.get("/messages/unread/count", headers=_HEADERS)
        assert r.status_code == 200
        assert r.json() == {"count": 3}

    def test_three_outbound_messages_then_count_is_three(self):
        """Three POST /messages succeed; unread aggregate for receiver is tested via GET mock = 3."""
        fetch_seq = [
            (_FRIEND,),  # recipient exists
            (uuid.uuid4(), None),  # insert DM 1
            (_FRIEND,),
            (uuid.uuid4(), None),
            (_FRIEND,),
            (uuid.uuid4(), None),
        ]

        def _fetchone():
            return fetch_seq.pop(0) if fetch_seq else None

        s_send = MagicMock()
        s_send.execute.return_value.fetchone.side_effect = lambda *a, **k: _fetchone()

        s_count = MagicMock()
        s_count.execute.return_value.scalar.side_effect = [3, 0]

        ctxs = [_session_ctx(s_send), _session_ctx(s_send), _session_ctx(s_send), _session_ctx(s_count)]

        def _next_ctx():
            return ctxs.pop(0)

        with patch("main.SessionLocal", side_effect=_next_ctx):
            for i in range(3):
                rr = client.post(
                    "/messages",
                    json={"receiver_id": _FRIEND, "content": f"hello {i}"},
                    headers=_HEADERS,
                )
                assert rr.status_code == 201, rr.text
            r = client.get("/messages/unread/count", headers=_HEADERS)
        assert r.status_code == 200
        assert r.json() == {"count": 3}

    def test_unread_count_after_read(self):
        s_read = MagicMock()
        s_read.execute.return_value = MagicMock()
        s_count = MagicMock()
        s_count.execute.return_value.scalar.side_effect = [0, 0]
        ctx_read = _session_ctx(s_read)
        ctx_count = _session_ctx(s_count)
        with patch("main.SessionLocal", side_effect=[ctx_read, ctx_count]):
            r1 = client.post(f"/messages/{_FRIEND}/read", headers=_HEADERS)
            r2 = client.get("/messages/unread/count", headers=_HEADERS)
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r2.json() == {"count": 0}
