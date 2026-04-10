"""
DELETE /users/me — account deletion (Phase 4).

# TODO[GOOGLE]: POST /auth/google — implement after Client ID received
# TODO[VERIF]: Steam/Riot API call — implement after API keys in platform_config
"""
from __future__ import annotations

import hashlib
import uuid
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app
import src.auth as auth

client = TestClient(app)

_USER_ID = str(uuid.uuid4())
_USER_TOKEN = auth.issue_token(_USER_ID, "deluser@arena.gg", "DelUser")
_HEADERS = {"Authorization": f"Bearer {_USER_TOKEN}"}


@pytest.fixture(autouse=True)
def _patches():
    with patch("main._get_daily_staked", return_value=0), patch("main._get_daily_limit", return_value=50_000):
        yield


class TestDeleteAccount:
    def test_delete_requires_exact_confirm_text(self):
        """Wrong casing (DELETE) → 400; must be lowercase 'delete'."""
        r = client.request(
            "DELETE",
            "/users/me",
            json={"confirm_text": "DELETE"},
            headers=_HEADERS,
        )
        assert r.status_code == 400
        assert "delete" in r.json()["detail"].lower()

    def test_delete_success_cleans_all_tables(self):
        """Happy path: _delete_user_account runs and user row removed."""
        ctx, session = _session_delete_success()
        with patch("main.SessionLocal", return_value=ctx):
            r = client.request(
                "DELETE",
                "/users/me",
                json={"confirm_text": "delete"},
                headers=_HEADERS,
            )
        assert r.status_code == 200
        assert r.json() == {"deleted": True}
        # INSERT deleted_accounts + final DELETE users should have been invoked
        texts = [str(c.args[0].text) for c in session.execute.call_args_list if c.args]
        assert any("INSERT INTO deleted_accounts" in t for t in texts)
        assert any("DELETE FROM users WHERE id" in t for t in texts)

    def test_delete_saves_hashed_identifiers(self):
        """deleted_accounts row gets sha256 of email and username."""
        ctx, session = _session_delete_success()
        email = "person@example.com"
        username = "personname"
        # Override user row fetch
        session.execute.return_value.fetchone.side_effect = [
            None,  # no active match
            ("76561198000000001", None, "0xabc", email, username),
            None,  # was_banned check (migration 025)
            None,  # rem check
        ]
        with patch("main.SessionLocal", return_value=ctx):
            r = client.request(
                "DELETE",
                "/users/me",
                json={"confirm_text": "delete"},
                headers=_HEADERS,
            )
        assert r.status_code == 200
        want_eh = hashlib.sha256(email.encode()).hexdigest()
        want_uh = hashlib.sha256(username.encode()).hexdigest()
        params = None
        for call in session.execute.call_args_list:
            args = call.args
            if len(args) < 2 or not isinstance(args[1], dict):
                continue
            if "INSERT INTO deleted_accounts" not in str(args[0]):
                continue
            params = args[1]
            break
        assert params is not None, "expected INSERT INTO deleted_accounts with params dict"
        assert params["eh"] == want_eh
        assert params["uh"] == want_uh

    @pytest.mark.xfail(
        reason="Engine currently DELETEs match_players rows; spec expects SET user_id=NULL to preserve history",
        strict=False,
    )
    def test_delete_preserves_match_history(self):
        """Roadmap: match_players.user_id = NULL, match row remains."""
        # Placeholder — enable when _delete_user_account anonymizes instead of deleting MP rows.
        assert False


def _session_delete_success():
    """Session mock for successful deletion (no open tickets, no host rem snag)."""
    session = MagicMock()
    session.execute.return_value.fetchall.return_value = []
    session.execute.return_value.fetchone.side_effect = [
        None,  # active match guard
        ("76561198000000001", None, "0xabc", "u@u.com", "uname"),
        None,  # was_banned check (migration 025)
        None,  # rem: no remaining host rows
    ]
    ctx = MagicMock()
    ctx.__enter__ = MagicMock(return_value=session)
    ctx.__exit__ = MagicMock(return_value=False)
    return ctx, session
