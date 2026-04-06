"""
Tests for the new routes added in feat/complete-partial-features:

  GET    /notifications
  PATCH  /notifications/:id/read
  PATCH  /notifications/read-all
  DELETE /notifications/:id

  POST   /disputes
  GET    /disputes
  PATCH  /disputes/:id            (admin-only)

  POST   /support/tickets
  GET    /support/tickets

  GET    /forge/challenges
  POST   /forge/challenges/:id/claim

All tests mock SessionLocal so no real DB is needed.
Strategy: happy-path + key error paths for every route.
"""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch, call
from datetime import datetime, timezone, date

import pytest
from fastapi.testclient import TestClient

from main import app
import src.auth as auth

client = TestClient(app)

# ── Shared helpers ─────────────────────────────────────────────────────────────

_USER_ID  = str(uuid.uuid4())
_ADMIN_ID = str(uuid.uuid4())

_USER_TOKEN  = auth.issue_token(_USER_ID,  "user@arena.gg")
_ADMIN_TOKEN = auth.issue_token(_ADMIN_ID, "admin@arena.gg")

_USER_HEADERS  = {"Authorization": f"Bearer {_USER_TOKEN}"}
_ADMIN_HEADERS = {"Authorization": f"Bearer {_ADMIN_TOKEN}"}

_NOTIF_ID   = str(uuid.uuid4())
_MATCH_ID   = str(uuid.uuid4())
_DISPUTE_ID = str(uuid.uuid4())
_TICKET_ID  = str(uuid.uuid4())
_CHALLENGE_ID = str(uuid.uuid4())
_OTHER_ID   = str(uuid.uuid4())


def _make_session(fetchone=None, fetchall=None, rowcount=0):
    """Return a context-manager-compatible session mock."""
    session = MagicMock()
    session.execute.return_value.fetchone.return_value = fetchone
    session.execute.return_value.fetchall.return_value = fetchall or []
    session.execute.return_value.rowcount = rowcount
    ctx = MagicMock()
    ctx.__enter__ = MagicMock(return_value=session)
    ctx.__exit__  = MagicMock(return_value=False)
    return ctx, session


# ═══════════════════════════════════════════════════════════════════════════════
# Notifications
# ═══════════════════════════════════════════════════════════════════════════════

class TestGetNotifications:

    def test_returns_200_empty(self):
        ctx, _ = _make_session(fetchall=[])
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/notifications", headers=_USER_HEADERS)
        assert resp.status_code == 200
        assert resp.json()["notifications"] == []

    def test_returns_list(self):
        now = datetime.now(timezone.utc)
        row = (_NOTIF_ID, "match_invite", "Invite", "Join now", False, None, now)
        ctx, _ = _make_session(fetchall=[row])
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/notifications", headers=_USER_HEADERS)
        data = resp.json()
        assert resp.status_code == 200
        assert len(data["notifications"]) == 1
        n = data["notifications"][0]
        assert n["id"]    == _NOTIF_ID
        assert n["type"]  == "match_invite"
        assert n["read"]  is False

    def test_requires_auth(self):
        resp = client.get("/notifications")
        assert resp.status_code in (401, 422)

    def test_unread_only_param_accepted(self):
        ctx, _ = _make_session(fetchall=[])
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/notifications?unread_only=true", headers=_USER_HEADERS)
        assert resp.status_code == 200

    def test_limit_param_accepted(self):
        ctx, _ = _make_session(fetchall=[])
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/notifications?limit=10", headers=_USER_HEADERS)
        assert resp.status_code == 200


class TestMarkNotificationRead:

    def test_marks_read_200(self):
        ctx, session = _make_session(fetchone=(_NOTIF_ID,))
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.patch(f"/notifications/{_NOTIF_ID}/read", headers=_USER_HEADERS)
        assert resp.status_code == 200
        assert resp.json()["read"] is True
        assert resp.json()["id"] == _NOTIF_ID

    def test_404_when_not_found(self):
        ctx, _ = _make_session(fetchone=None)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.patch(f"/notifications/{_NOTIF_ID}/read", headers=_USER_HEADERS)
        assert resp.status_code == 404

    def test_requires_auth(self):
        resp = client.patch(f"/notifications/{_NOTIF_ID}/read")
        assert resp.status_code in (401, 422)


class TestMarkAllNotificationsRead:

    def test_marks_all_read_200(self):
        ctx, session = _make_session()
        session.execute.return_value.rowcount = 3
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.patch("/notifications/read-all", headers=_USER_HEADERS)
        assert resp.status_code == 200
        assert resp.json()["marked_read"] == 3

    def test_requires_auth(self):
        resp = client.patch("/notifications/read-all")
        assert resp.status_code in (401, 422)


class TestDeleteNotification:

    def test_deletes_200(self):
        ctx, _ = _make_session(fetchone=(_NOTIF_ID,))
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.delete(f"/notifications/{_NOTIF_ID}", headers=_USER_HEADERS)
        assert resp.status_code == 200
        assert resp.json()["deleted"] is True

    def test_404_when_not_found(self):
        ctx, _ = _make_session(fetchone=None)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.delete(f"/notifications/{_NOTIF_ID}", headers=_USER_HEADERS)
        assert resp.status_code == 404

    def test_requires_auth(self):
        resp = client.delete(f"/notifications/{_NOTIF_ID}")
        assert resp.status_code in (401, 422)


# ═══════════════════════════════════════════════════════════════════════════════
# Disputes
# ═══════════════════════════════════════════════════════════════════════════════

class TestCreateDispute:

    def _session_for_create(self, match_status="completed"):
        """Returns (ctx, session) with all the right execute side-effects for create_dispute."""
        now = datetime.now(timezone.utc)

        session = MagicMock()

        # Call sequence for create_dispute:
        #   1. SELECT match row
        #   2. SELECT match_players
        #   3. INSERT disputes → returns (id, created_at)
        #   4. UPDATE matches SET status='disputed'
        call_results = [
            MagicMock(fetchone=lambda: (_MATCH_ID, match_status),
                      fetchall=lambda: []),
            MagicMock(fetchone=lambda: None,
                      fetchall=lambda: [(_USER_ID,), (_OTHER_ID,)]),
            MagicMock(fetchone=lambda: (_DISPUTE_ID, now),
                      fetchall=lambda: []),
            MagicMock(fetchone=lambda: None,
                      fetchall=lambda: []),
        ]
        call_results[0].fetchone = MagicMock(return_value=(_MATCH_ID, match_status))
        call_results[1].fetchall = MagicMock(return_value=[(_USER_ID,), (_OTHER_ID,)])
        call_results[2].fetchone = MagicMock(return_value=(_DISPUTE_ID, now))
        call_results[3].fetchone = MagicMock(return_value=None)

        side_effects = iter(call_results)
        session.execute = MagicMock(side_effect=lambda *a, **kw: next(side_effects))
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__  = MagicMock(return_value=False)
        return ctx, session

    def test_create_dispute_201(self):
        ctx, _ = self._session_for_create("completed")
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/disputes",
                json={"match_id": _MATCH_ID, "reason": "fake screenshot"},
                headers=_USER_HEADERS,
            )
        assert resp.status_code == 201
        data = resp.json()
        assert data["id"] == _DISPUTE_ID
        assert data["status"] == "open"
        assert data["resolution"] == "pending"

    def test_empty_reason_400(self):
        resp = client.post(
            "/disputes",
            json={"match_id": _MATCH_ID, "reason": "   "},
            headers=_USER_HEADERS,
        )
        assert resp.status_code == 400

    def test_wrong_match_status_409(self):
        ctx, _ = self._session_for_create("waiting")
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/disputes",
                json={"match_id": _MATCH_ID, "reason": "bad"},
                headers=_USER_HEADERS,
            )
        assert resp.status_code == 409

    def test_requires_auth(self):
        resp = client.post("/disputes", json={"match_id": _MATCH_ID, "reason": "bad"})
        assert resp.status_code in (401, 422)


class TestGetDisputes:

    def test_returns_200_empty(self):
        ctx, _ = _make_session(fetchall=[])
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/disputes", headers=_USER_HEADERS)
        assert resp.status_code == 200
        assert resp.json()["disputes"] == []

    def test_returns_list(self):
        now = datetime.now(timezone.utc)
        row = (
            _DISPUTE_ID, _MATCH_ID, _USER_ID, _OTHER_ID,
            "fake screenshot", "open", "pending",
            None, None, None,
            now, None,
            "CS2", 50.0,
            "alice", "bob",
        )
        ctx, _ = _make_session(fetchall=[row])
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/disputes", headers=_USER_HEADERS)
        data = resp.json()
        assert resp.status_code == 200
        assert len(data["disputes"]) == 1
        d = data["disputes"][0]
        assert d["id"]     == _DISPUTE_ID
        assert d["status"] == "open"
        assert d["player_a_username"] == "alice"

    def test_requires_auth(self):
        resp = client.get("/disputes")
        assert resp.status_code in (401, 422)


class TestUpdateDispute:

    def _admin_session(self):
        """Admin role + dispute row exist."""
        session = MagicMock()
        call_results = [
            MagicMock(fetchone=MagicMock(return_value=(_ADMIN_ID,))),   # user_roles check
            MagicMock(fetchone=MagicMock(return_value=(_DISPUTE_ID,))), # dispute SELECT
            MagicMock(fetchone=MagicMock(return_value=None)),            # UPDATE
        ]
        side_effects = iter(call_results)
        session.execute = MagicMock(side_effect=lambda *a, **kw: next(side_effects))
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__  = MagicMock(return_value=False)
        return ctx

    def test_admin_can_update_200(self):
        ctx = self._admin_session()
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.patch(
                f"/disputes/{_DISPUTE_ID}",
                json={"status": "reviewing"},
                headers=_ADMIN_HEADERS,
            )
        assert resp.status_code == 200
        assert resp.json()["updated"] is True

    def test_non_admin_403(self):
        # user_roles check returns None → 403
        session = MagicMock()
        session.execute.return_value.fetchone.return_value = None
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__  = MagicMock(return_value=False)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.patch(
                f"/disputes/{_DISPUTE_ID}",
                json={"status": "reviewing"},
                headers=_USER_HEADERS,
            )
        assert resp.status_code == 403

    def test_invalid_status_400(self):
        ctx = self._admin_session()
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.patch(
                f"/disputes/{_DISPUTE_ID}",
                json={"status": "invalid_status"},
                headers=_ADMIN_HEADERS,
            )
        assert resp.status_code == 400

    def test_invalid_resolution_400(self):
        ctx = self._admin_session()
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.patch(
                f"/disputes/{_DISPUTE_ID}",
                json={"resolution": "bad_value"},
                headers=_ADMIN_HEADERS,
            )
        assert resp.status_code == 400

    def test_no_fields_400(self):
        ctx = self._admin_session()
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.patch(
                f"/disputes/{_DISPUTE_ID}",
                json={},
                headers=_ADMIN_HEADERS,
            )
        assert resp.status_code == 400


# ═══════════════════════════════════════════════════════════════════════════════
# Support Tickets
# ═══════════════════════════════════════════════════════════════════════════════

class TestCreateSupportTicket:

    def _session_for_create(self):
        now = datetime.now(timezone.utc)
        ctx, session = _make_session(fetchone=(_TICKET_ID, now))
        return ctx

    def test_create_ticket_201(self):
        ctx = self._session_for_create()
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/support/tickets",
                json={
                    "reason":      "cheating",
                    "description": "Player was clearly using aimbot.",
                    "reported_id": _OTHER_ID,
                    "category":    "player_report",
                },
                headers=_USER_HEADERS,
            )
        assert resp.status_code == 201
        data = resp.json()
        assert data["id"]     == _TICKET_ID
        assert data["status"] == "open"
        assert data["reason"] == "cheating"

    def test_invalid_reason_400(self):
        resp = client.post(
            "/support/tickets",
            json={"reason": "bad_reason", "description": "test"},
            headers=_USER_HEADERS,
        )
        assert resp.status_code == 400

    def test_invalid_category_400(self):
        resp = client.post(
            "/support/tickets",
            json={"reason": "cheating", "description": "test", "category": "unknown"},
            headers=_USER_HEADERS,
        )
        assert resp.status_code == 400

    def test_self_report_400(self):
        resp = client.post(
            "/support/tickets",
            json={
                "reason":      "cheating",
                "description": "I am reporting myself.",
                "reported_id": _USER_ID,
            },
            headers=_USER_HEADERS,
        )
        assert resp.status_code == 400

    def test_empty_description_400(self):
        resp = client.post(
            "/support/tickets",
            json={"reason": "cheating", "description": "   "},
            headers=_USER_HEADERS,
        )
        assert resp.status_code == 400

    def test_requires_auth(self):
        resp = client.post(
            "/support/tickets",
            json={"reason": "cheating", "description": "test"},
        )
        assert resp.status_code in (401, 422)

    def test_general_support_with_topic(self):
        ctx = self._session_for_create()
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                "/support/tickets",
                json={
                    "reason":      "other",
                    "description": "Cannot access my account.",
                    "category":    "general_support",
                    "topic":       "account_access",
                },
                headers=_USER_HEADERS,
            )
        assert resp.status_code == 201


class TestGetSupportTickets:

    def test_returns_200_empty(self):
        ctx, _ = _make_session(fetchall=[])
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/support/tickets", headers=_USER_HEADERS)
        assert resp.status_code == 200
        assert resp.json()["tickets"] == []

    def test_returns_list(self):
        now = datetime.now(timezone.utc)
        row = (
            _TICKET_ID, "cheating", "Player used aimbot.", "open",
            "player_report", None, None,
            None, now, now,
            _OTHER_ID, "opponent_user",
        )
        ctx, _ = _make_session(fetchall=[row])
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/support/tickets", headers=_USER_HEADERS)
        data = resp.json()
        assert resp.status_code == 200
        assert len(data["tickets"]) == 1
        t = data["tickets"][0]
        assert t["id"]     == _TICKET_ID
        assert t["status"] == "open"

    def test_status_filter_accepted(self):
        ctx, _ = _make_session(fetchall=[])
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/support/tickets?status=open", headers=_USER_HEADERS)
        assert resp.status_code == 200

    def test_requires_auth(self):
        resp = client.get("/support/tickets")
        assert resp.status_code in (401, 422)


# ═══════════════════════════════════════════════════════════════════════════════
# Forge Challenges
# ═══════════════════════════════════════════════════════════════════════════════

class TestGetForgeChallenges:

    def test_returns_200_empty(self):
        ctx, _ = _make_session(fetchall=[])
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/forge/challenges", headers=_USER_HEADERS)
        assert resp.status_code == 200
        assert resp.json()["challenges"] == []

    def test_returns_list_with_status(self):
        row = (
            _CHALLENGE_ID, "Win 3 Matches", "Win 3 ranked matches today",
            "trophy", "daily", 150, 50, 3,
            3,        # progress == target → claimable
            "active", # db_status
        )
        ctx, _ = _make_session(fetchall=[row])
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/forge/challenges", headers=_USER_HEADERS)
        data = resp.json()
        assert resp.status_code == 200
        ch = data["challenges"][0]
        assert ch["id"]       == _CHALLENGE_ID
        assert ch["status"]   == "claimable"   # progress(3) >= target(3) → claimable
        assert ch["rewardAT"] == 150
        assert ch["rewardXP"] == 50
        assert "expiresAt" in ch

    def test_claimed_status_preserved(self):
        row = (
            _CHALLENGE_ID, "Title", "Desc", "icon",
            "weekly", 200, 100, 5,
            5, "claimed",
        )
        ctx, _ = _make_session(fetchall=[row])
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/forge/challenges", headers=_USER_HEADERS)
        ch = resp.json()["challenges"][0]
        assert ch["status"] == "claimed"

    def test_active_when_progress_below_target(self):
        row = (
            _CHALLENGE_ID, "Title", "Desc", "icon",
            "daily", 100, 25, 5,
            2, "active",
        )
        ctx, _ = _make_session(fetchall=[row])
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/forge/challenges", headers=_USER_HEADERS)
        ch = resp.json()["challenges"][0]
        assert ch["status"] == "active"

    def test_requires_auth(self):
        resp = client.get("/forge/challenges")
        assert resp.status_code in (401, 422)


class TestClaimForgeChallenge:

    def _session_for_claim(
        self,
        ch_exists=True,
        prog_exists=True,
        already_claimed=False,
        progress=3,
        target=3,
    ):
        """Returns ctx with the right side-effects for claim_forge_challenge."""
        now = datetime.now(timezone.utc)
        session = MagicMock()

        ch_row  = (_CHALLENGE_ID, "daily", 150, 50, target) if ch_exists else None
        prog_row = (progress, "claimed" if already_claimed else "active") if prog_exists else None
        bal_row  = (5000,)

        results = [
            MagicMock(fetchone=MagicMock(return_value=ch_row)),    # SELECT challenge
            MagicMock(fetchone=MagicMock(return_value=prog_row)),  # SELECT progress
            MagicMock(fetchone=MagicMock(return_value=None)),      # UPDATE claimed
            MagicMock(fetchone=MagicMock(return_value=None)),      # UPDATE at_balance
            MagicMock(fetchone=MagicMock(return_value=None)),      # UPDATE xp
            MagicMock(fetchone=MagicMock(return_value=None)),      # INSERT tx
            MagicMock(fetchone=MagicMock(return_value=bal_row)),   # SELECT new balance
        ]
        side_effects = iter(results)
        session.execute = MagicMock(side_effect=lambda *a, **kw: next(side_effects))
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=session)
        ctx.__exit__  = MagicMock(return_value=False)
        return ctx

    def test_claim_200(self):
        ctx = self._session_for_claim()
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/forge/challenges/{_CHALLENGE_ID}/claim",
                headers=_USER_HEADERS,
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["claimed"]   is True
        assert data["reward_at"] == 150
        assert data["reward_xp"] == 50
        assert data["at_balance"] == 5000

    def test_404_when_challenge_not_found(self):
        ctx = self._session_for_claim(ch_exists=False)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/forge/challenges/{_CHALLENGE_ID}/claim",
                headers=_USER_HEADERS,
            )
        assert resp.status_code == 404

    def test_400_when_no_progress_row(self):
        ctx = self._session_for_claim(prog_exists=False)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/forge/challenges/{_CHALLENGE_ID}/claim",
                headers=_USER_HEADERS,
            )
        assert resp.status_code == 400

    def test_409_when_already_claimed(self):
        ctx = self._session_for_claim(already_claimed=True)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/forge/challenges/{_CHALLENGE_ID}/claim",
                headers=_USER_HEADERS,
            )
        assert resp.status_code == 409

    def test_400_when_progress_below_target(self):
        ctx = self._session_for_claim(progress=1, target=3)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/forge/challenges/{_CHALLENGE_ID}/claim",
                headers=_USER_HEADERS,
            )
        assert resp.status_code == 400

    def test_requires_auth(self):
        resp = client.post(f"/forge/challenges/{_CHALLENGE_ID}/claim")
        assert resp.status_code in (401, 422)
