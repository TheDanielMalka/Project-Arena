"""
Tests for Doc B backend sync — match routes improvements:

  POST  /matches                    — now saves password field
  POST  /matches/{id}/join          — password check + auto-start when full
  GET   /matches                    — has_password + ordered roster
  POST  /matches/{id}/invite        — pre-validates friend AT/CRYPTO balance

All tests mock SessionLocal; no real DB needed.
"""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from main import app
import src.auth as auth

client = TestClient(app)

# ── Shared helpers ─────────────────────────────────────────────────────────────

_USER_ID   = str(uuid.uuid4())
_FRIEND_ID = str(uuid.uuid4())
_MATCH_ID  = str(uuid.uuid4())

_USER_TOKEN   = auth.issue_token(_USER_ID,   "user@arena.gg")
_AUTH_HEADERS = {"Authorization": f"Bearer {_USER_TOKEN}"}


def _make_session(fetchone=None, fetchall=None):
    """Context-manager-compatible session mock."""
    session = MagicMock()
    session.execute.return_value.fetchone.return_value = fetchone
    session.execute.return_value.fetchall.return_value = fetchall or []
    session.execute.return_value.rowcount = 1
    ctx = MagicMock()
    ctx.__enter__ = MagicMock(return_value=session)
    ctx.__exit__  = MagicMock(return_value=False)
    return ctx, session


def _mock_match_row(
    game="CS2", status="waiting", bet=10, currency="AT",
    password=None, max_players=2, max_per_team=1,
):
    """7-element tuple matching the SELECT in join_match (+max_per_team)."""
    return (game, status, bet, currency, password, max_players, max_per_team)


def _steam_user(wallet="0xABC"):
    """User row: (steam_id, riot_id, wallet_address)."""
    return ("12345678901234567", None, wallet)


# ═══════════════════════════════════════════════════════════════════════════════
# Doc B §1 — Room password
# ═══════════════════════════════════════════════════════════════════════════════

class TestJoinMatchPassword:
    """POST /matches/{id}/join — password check (Doc B §1)."""

    def test_join_no_password_room_succeeds(self):
        """Room without a password accepts any join (password=None in DB).
        Uses CRYPTO currency to keep the mock chain simple (no at_balance call).
        """
        ctx, session = _make_session()
        session.execute.return_value.fetchone.side_effect = [
            _mock_match_row(password=None, currency="CRYPTO"),  # match — no password
            _steam_user(),                                        # user row (has wallet)
            None,                                                 # active-room guard
            None,                                                 # duplicate-join check
            (1, 0),                                               # (a_count=1, b_count=0) → Team B
            (1,),                                                 # COUNT(*) = 1 < max 2
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{_MATCH_ID}/join",
                json={},                     # no password needed
                headers=_AUTH_HEADERS,
            )
        assert resp.status_code == 200
        assert resp.json()["joined"] is True

    def test_join_correct_password_succeeds(self):
        """Correct password → 200 joined.
        Uses CRYPTO to keep the mock simple (no at_balance fetchone needed).
        """
        ctx, session = _make_session()
        session.execute.return_value.fetchone.side_effect = [
            _mock_match_row(password="secret", currency="CRYPTO"),
            _steam_user(),
            None,     # active-room guard
            None,     # duplicate-join check
            (1, 0),   # (a_count=1, b_count=0) → Team B
            (1,),     # COUNT(*) — below max, no auto-start
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{_MATCH_ID}/join",
                json={"password": "secret"},
                headers=_AUTH_HEADERS,
            )
        assert resp.status_code == 200
        assert resp.json()["joined"] is True

    def test_join_wrong_password_returns_403(self):
        """Wrong password → 403 Forbidden."""
        ctx, session = _make_session()
        session.execute.return_value.fetchone.side_effect = [
            _mock_match_row(password="correct"),  # DB password
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{_MATCH_ID}/join",
                json={"password": "wrong"},
                headers=_AUTH_HEADERS,
            )
        assert resp.status_code == 403
        assert "password" in resp.json()["detail"].lower()

    def test_join_omitting_password_on_locked_room_returns_403(self):
        """Sending no password (empty string) on a password-protected room → 403."""
        ctx, session = _make_session()
        session.execute.return_value.fetchone.side_effect = [
            _mock_match_row(password="abc123"),
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{_MATCH_ID}/join",
                json={},                     # password field absent → defaults to None → ""
                headers=_AUTH_HEADERS,
            )
        assert resp.status_code == 403


# ═══════════════════════════════════════════════════════════════════════════════
# Doc B §3.2 — Auto-start when room fills
# ═══════════════════════════════════════════════════════════════════════════════

class TestJoinMatchAutoStart:
    """join_match transitions status to in_progress when player_count >= max_players."""

    def test_room_fills_returns_started_true(self):
        """Last player joins a 2-player AT room → started=True in response.
        AT fetchone chain: match → user → at_balance → active_guard → dup → COUNT
        """
        ctx, session = _make_session()
        session.execute.return_value.fetchone.side_effect = [
            _mock_match_row(currency="AT", max_players=2, max_per_team=1),  # match row
            _steam_user(),   # user row
            (500,),          # _assert_at_balance → at_balance = 500 ≥ 10 AT ✅
            None,            # active-room guard
            None,            # duplicate-join check
            (1, 0),          # (a_count=1, b_count=0) → Team B
            (2,),            # COUNT(*) = 2 == max_players → auto-start!
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{_MATCH_ID}/join",
                json={},
                headers=_AUTH_HEADERS,
            )
        assert resp.status_code == 200
        assert resp.json()["started"] is True

    def test_room_not_full_returns_started_false(self):
        """Room still has open slots → started=False.
        4-player AT room with only 1 player after join.
        """
        ctx, session = _make_session()
        session.execute.return_value.fetchone.side_effect = [
            _mock_match_row(currency="AT", max_players=4, max_per_team=2),  # 2v2
            _steam_user(),
            (500,),   # at_balance
            None,     # active-room guard
            None,     # duplicate-join check
            (0, 0),   # (a_count=0, b_count=0) → Team A
            (1,),     # COUNT(*) = 1 < 4 → no auto-start
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{_MATCH_ID}/join",
                json={},
                headers=_AUTH_HEADERS,
            )
        assert resp.status_code == 200
        assert resp.json()["started"] is False


# ═══════════════════════════════════════════════════════════════════════════════
# Team assignment — join_match assigns players to teams in order
# ═══════════════════════════════════════════════════════════════════════════════

class TestTeamAssignment:
    """join_match fills Team A first (up to max_per_team), then Team B.
    Also honors explicit team preference when the slot is free."""

    def _join(self, team_a_count: int, team_b_count: int = 0,
              max_per_team: int = 1, currency: str = "CRYPTO",
              req_team: str | None = None):
        ctx, session = _make_session()
        side: list = [
            _mock_match_row(currency=currency, max_players=max_per_team * 2,
                            max_per_team=max_per_team),
            _steam_user(),
        ]
        if currency == "AT":
            side.append((500,))   # at_balance
        side += [
            None,                           # active-room guard
            None,                           # duplicate-join check
            (team_a_count, team_b_count),   # (a_count, b_count) combined query
            (team_a_count + team_b_count + 1,),  # COUNT(*) total after join
        ]
        session.execute.return_value.fetchone.side_effect = side
        body = {} if req_team is None else {"team": req_team}
        with patch("main.SessionLocal", return_value=ctx):
            return client.post(
                f"/matches/{_MATCH_ID}/join",
                json=body,
                headers=_AUTH_HEADERS,
            )

    # ── Auto-assign tests ─────────────────────────────────────────────────────

    def test_second_player_in_1v1_gets_team_b(self):
        """1v1: host is Team A (1 slot, incl. NULL legacy hosts), second player → Team B."""
        resp = self._join(team_a_count=1, max_per_team=1)
        assert resp.status_code == 200
        assert resp.json()["team"] == "B"

    def test_first_joiner_in_empty_room_gets_team_a(self):
        """No one in Team A yet → joiner gets Team A."""
        resp = self._join(team_a_count=0, max_per_team=1)
        assert resp.status_code == 200
        assert resp.json()["team"] == "A"

    def test_5v5_fills_team_a_first(self):
        """5v5: Team A has 4 players → 5th joiner still gets Team A."""
        resp = self._join(team_a_count=4, team_b_count=3, max_per_team=5)
        assert resp.status_code == 200
        assert resp.json()["team"] == "A"

    def test_5v5_switches_to_team_b_when_a_full(self):
        """5v5: Team A is full (5) → next joiner gets Team B."""
        resp = self._join(team_a_count=5, team_b_count=4, max_per_team=5)
        assert resp.status_code == 200
        assert resp.json()["team"] == "B"

    def test_team_returned_in_response(self):
        """Response always includes 'team' field."""
        resp = self._join(team_a_count=0, max_per_team=1, currency="AT")
        assert resp.status_code == 200
        assert "team" in resp.json()

    # ── Explicit team preference tests ────────────────────────────────────────

    def test_explicit_team_b_preference_respected(self):
        """req.team='B' with space in B → assigned Team B even though A has room."""
        resp = self._join(team_a_count=0, team_b_count=0, max_per_team=1,
                         req_team="B")
        assert resp.status_code == 200
        assert resp.json()["team"] == "B"

    def test_explicit_team_a_preference_respected(self):
        """req.team='A' with space in A → assigned Team A."""
        resp = self._join(team_a_count=0, team_b_count=1, max_per_team=1,
                         req_team="A")
        assert resp.status_code == 200
        assert resp.json()["team"] == "A"

    def test_explicit_team_b_full_returns_409(self):
        """req.team='B' but Team B is full → 409 with helpful message."""
        resp = self._join(team_a_count=1, team_b_count=1, max_per_team=1,
                         req_team="B")
        assert resp.status_code == 409
        assert "full" in resp.json()["detail"].lower()
        assert "A" in resp.json()["detail"]  # suggests the other team

    def test_explicit_team_a_full_returns_409(self):
        """req.team='A' but Team A is full → 409."""
        resp = self._join(team_a_count=1, team_b_count=0, max_per_team=1,
                         req_team="A")
        assert resp.status_code == 409
        assert "full" in resp.json()["detail"].lower()

    def test_invalid_team_value_returns_400(self):
        """req.team='C' → 400."""
        resp = self._join(team_a_count=0, team_b_count=0, max_per_team=1,
                         req_team="C")
        assert resp.status_code == 400


# ═══════════════════════════════════════════════════════════════════════════════
# Doc B §2 — GET /matches returns has_password + roster
# ═══════════════════════════════════════════════════════════════════════════════

class TestListMatchesRoster:
    """GET /matches returns has_password flag and players array (Doc B §2)."""

    def _match_row(self, has_pw=False):
        return (
            str(uuid.uuid4()),                   # id
            "CS2",                               # game
            "1v1",                               # mode
            "public",                            # type
            10.00,                               # bet_amount
            "waiting",                           # status
            "ARENA-XXXXX",                       # code
            datetime.now(timezone.utc),          # created_at
            2,                                   # max_players
            "HostPlayer",                        # host_username
            str(uuid.uuid4()),                   # host_id
            None,                                # host_avatar
            1,                                   # player_count
            1,                                   # max_per_team
            "AT",                                # stake_currency
            has_pw,                              # has_password (index 15)
        )

    def test_has_password_false_when_no_password(self):
        ctx, session = _make_session()
        session.execute.return_value.fetchall.side_effect = [
            [self._match_row(has_pw=False)],
            [],  # roster query — no players in mock
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/matches")
        assert resp.status_code == 200
        m = resp.json()["matches"][0]
        assert m["has_password"] is False

    def test_has_password_true_when_password_set(self):
        ctx, session = _make_session()
        session.execute.return_value.fetchall.side_effect = [
            [self._match_row(has_pw=True)],
            [],
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/matches")
        assert resp.status_code == 200
        assert resp.json()["matches"][0]["has_password"] is True

    def test_players_array_present(self):
        ctx, session = _make_session()
        match_id = str(uuid.uuid4())
        host_id   = str(uuid.uuid4())
        roster_row = (
            match_id,    # mp.match_id
            host_id,     # u.id
            "HostPlayer",# u.username
            "A",         # mp.team
        )
        match_row = (
            match_id, "CS2", "1v1", "public", 10.0, "waiting",
            "ARENA-XXXXX", datetime.now(timezone.utc),
            2, "HostPlayer", host_id, None, 1, 1, "AT", False,
        )
        session.execute.return_value.fetchall.side_effect = [
            [match_row],
            [roster_row],
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/matches")
        assert resp.status_code == 200
        m = resp.json()["matches"][0]
        assert isinstance(m["players"], list)
        assert len(m["players"]) == 1
        assert m["players"][0]["username"] == "HostPlayer"
        assert m["players"][0]["team"] == "A"

    def test_team_counts_correct(self):
        ctx, session = _make_session()
        match_id = str(uuid.uuid4())
        host_id   = str(uuid.uuid4())
        p2_id     = str(uuid.uuid4())
        roster_rows = [
            (match_id, host_id, "HostPlayer", "A"),
            (match_id, p2_id,   "Player2",    "B"),
        ]
        match_row = (
            match_id, "CS2", "2v2", "public", 10.0, "waiting",
            "ARENA-XXXXX", datetime.now(timezone.utc),
            4, "HostPlayer", host_id, None, 2, 2, "AT", False,
        )
        session.execute.return_value.fetchall.side_effect = [
            [match_row],
            roster_rows,
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/matches")
        m = resp.json()["matches"][0]
        assert m["team_a_count"] == 1
        assert m["team_b_count"] == 1

    def test_empty_lobby_still_works(self):
        ctx, session = _make_session()
        session.execute.return_value.fetchall.return_value = []
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/matches")
        assert resp.status_code == 200
        assert resp.json()["matches"] == []


# ═══════════════════════════════════════════════════════════════════════════════
# Doc B §5 — Invite pre-validates friend AT/CRYPTO
# ═══════════════════════════════════════════════════════════════════════════════

class TestInvitePreValidation:
    """POST /matches/{id}/invite — blocks invite if friend can't afford to join."""

    def _session_for_invite(
        self,
        currency="AT",
        friend_at=0,
        friend_wallet=None,
    ):
        """
        Builds a mock session with the correct fetchone side_effect chain for
        invite_to_match.  Chain:
          1. match_row       (game, status, bet_amount, stake_currency, code)
          2. in_match        (caller is in the match)
          3. friend_in_match (friend NOT already in match → None)
          4. friendship      (accepted)
          5. friend_row      (wallet_address)
          6. at_balance row  (only relevant for AT currency)
          7. inviter username
        """
        ctx, session = _make_session()
        match_row = ("CS2", "waiting", 10, currency, "ARENA-XXXXX")
        side: list = [
            match_row,           # match lookup
            (1,),                # in_match — caller is a player
            None,                # friend_in_match — not already in room
            (1,),                # friendship — accepted friend
            (friend_wallet,),    # friend wallet_address row
        ]
        if currency == "AT":
            side.append((friend_at,))  # at_balance for the friend
        side.append((_USER_ID,))       # inviter username
        session.execute.return_value.fetchone.side_effect = side
        return ctx

    def test_at_match_friend_with_enough_at_sends_invite(self):
        """Friend has enough AT → notification inserted → 201."""
        ctx = self._session_for_invite(currency="AT", friend_at=500)
        # Re-add inviter name lookup after balance check
        ctx.__enter__.return_value.execute.return_value.fetchone.side_effect = [
            ("CS2", "waiting", 10, "AT", "ARENA-XXXXX"),
            (1,),          # in_match
            None,          # friend_in_match — not in room
            (1,),          # friendship
            (None,),       # friend wallet (AT doesn't need it)
            (500,),        # friend at_balance ≥ 10 → OK
            ("Inviter",),  # inviter username
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{_MATCH_ID}/invite",
                json={"friend_id": _FRIEND_ID},
                headers=_AUTH_HEADERS,
            )
        assert resp.status_code == 201

    def test_at_match_friend_with_insufficient_at_returns_402(self):
        """Friend has 0 AT but room costs 10 AT → 402 Payment Required."""
        ctx, session = _make_session()
        session.execute.return_value.fetchone.side_effect = [
            ("CS2", "waiting", 10, "AT", "ARENA-XXXXX"),  # match row
            (1,),          # in_match
            None,          # friend_in_match — not in room
            (1,),          # friendship
            (None,),       # friend wallet (irrelevant for AT)
            (0,),          # friend at_balance = 0 < 10 → 402
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{_MATCH_ID}/invite",
                json={"friend_id": _FRIEND_ID},
                headers=_AUTH_HEADERS,
            )
        assert resp.status_code == 402

    def test_crypto_match_friend_without_wallet_returns_400(self):
        """Friend has no wallet linked → 400 before invite is sent."""
        ctx, session = _make_session()
        session.execute.return_value.fetchone.side_effect = [
            ("CS2", "waiting", 10, "CRYPTO", "ARENA-XXXXX"),  # match row
            (1,),    # in_match
            None,    # friend_in_match — not in room
            (1,),    # friendship
            (None,), # friend wallet = None → 400
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{_MATCH_ID}/invite",
                json={"friend_id": _FRIEND_ID},
                headers=_AUTH_HEADERS,
            )
        assert resp.status_code == 400
        assert "wallet" in resp.json()["detail"].lower()

    def test_self_invite_returns_400(self):
        """Cannot invite yourself — caught before DB."""
        resp = client.post(
            f"/matches/{_MATCH_ID}/invite",
            json={"friend_id": _USER_ID},  # same as caller
            headers=_AUTH_HEADERS,
        )
        assert resp.status_code == 400

    def test_invite_requires_auth(self):
        resp = client.post(
            f"/matches/{_MATCH_ID}/invite",
            json={"friend_id": _FRIEND_ID},
        )
        assert resp.status_code == 422  # missing Authorization header → 422

    def test_friend_already_in_match_returns_409(self):
        """Friend joined the room themselves → 409 before friendship/balance checks."""
        ctx, session = _make_session()
        session.execute.return_value.fetchone.side_effect = [
            ("CS2", "waiting", 10, "AT", "ARENA-XXXXX"),  # match row
            (1,),   # in_match — inviter is in the room
            (1,),   # friend_in_match — friend is ALREADY in the room → 409
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{_MATCH_ID}/invite",
                json={"friend_id": _FRIEND_ID},
                headers=_AUTH_HEADERS,
            )
        assert resp.status_code == 409
        assert "already" in resp.json()["detail"].lower()


# ═══════════════════════════════════════════════════════════════════════════════
# POST /matches/{id}/heartbeat — lobby keep-alive + stale player cleanup
# ═══════════════════════════════════════════════════════════════════════════════

_HOST_ID = str(uuid.uuid4())

# Shared datetime for heartbeat match_info tuple
_CREATED_AT = datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone.utc)


class TestMatchHeartbeat:
    """POST /matches/{id}/heartbeat — keep-alive, roster refresh, stale cleanup."""

    def _session_heartbeat(
        self,
        in_match: bool = True,
        stale_rows: list | None = None,
        players: list | None = None,
        match_status: str = "waiting",
        match_type: str = "custom",
        bet_amount: int = 50,
        stake_currency: str = "AT",
    ):
        """Build a mock session for the heartbeat route.

        Fetchone chain:
          1. UPDATE match_players RETURNING → player row (or None if not in match)
          2. match_info SELECT → 11-column tuple
             (status, game, mode, code, max_players, max_per_team,
              host_id, type, bet_amount, stake_currency, created_at)
        Fetchall chain:
          1. stale SELECT → stale rows
          2. players SELECT → roster
        """
        ctx, session = _make_session()

        if not in_match:
            session.execute.return_value.fetchone.return_value = None
            return ctx

        stale = stale_rows or []
        roster = players or [
            (str(uuid.uuid4()), "HostPlayer", None, "ARENA-HH", "A"),
            (str(uuid.uuid4()), "Player2",    None, "ARENA-P2", "B"),
        ]

        # 11-element tuple — must match the expanded SELECT in match_heartbeat
        match_info = (
            match_status,   # [0] status
            "CS2",          # [1] game
            "1v1",          # [2] mode
            "ARENA-ABCDE",  # [3] code
            2,              # [4] max_players
            1,              # [5] max_per_team
            _HOST_ID,       # [6] host_id
            match_type,     # [7] type
            bet_amount,     # [8] bet_amount
            stake_currency, # [9] stake_currency
            _CREATED_AT,    # [10] created_at
        )

        session.execute.return_value.fetchone.side_effect = [
            (_USER_ID,),  # UPDATE RETURNING — in match
            match_info,   # match SELECT
        ]
        session.execute.return_value.fetchall.side_effect = [
            stale,   # stale players
            roster,  # fresh roster
        ]

        return ctx

    def test_heartbeat_returns_players(self):
        """Happy path: in match → returns roster."""
        ctx = self._session_heartbeat()
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{_MATCH_ID}/heartbeat",
                headers=_AUTH_HEADERS,
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["in_match"] is True
        assert isinstance(data["players"], list)
        assert "your_team" in data
        assert "your_user_id" in data

    def test_heartbeat_not_in_match_returns_in_match_false(self):
        """Player not in this match → in_match=False, no error."""
        ctx = self._session_heartbeat(in_match=False)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{_MATCH_ID}/heartbeat",
                headers=_AUTH_HEADERS,
            )
        assert resp.status_code == 200
        assert resp.json()["in_match"] is False

    def test_heartbeat_requires_auth(self):
        resp = client.post(f"/matches/{_MATCH_ID}/heartbeat")
        assert resp.status_code == 422

    def test_heartbeat_returns_match_status(self):
        """Response includes current match status."""
        ctx = self._session_heartbeat(match_status="in_progress")
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{_MATCH_ID}/heartbeat",
                headers=_AUTH_HEADERS,
            )
        assert resp.status_code == 200
        assert resp.json()["status"] == "in_progress"

    def test_heartbeat_returns_full_match_metadata(self):
        """Heartbeat response must include host_id, type, bet_amount,
        stake_currency, created_at — same fields as GET /match/active.
        Cursor uses these to render the lobby without a second API call.
        """
        ctx = self._session_heartbeat(
            match_type="custom",
            bet_amount=100,
            stake_currency="AT",
        )
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{_MATCH_ID}/heartbeat",
                headers=_AUTH_HEADERS,
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["host_id"] == _HOST_ID
        assert data["type"] == "custom"
        assert data["bet_amount"] == "100"
        assert data["stake_currency"] == "AT"
        assert data["created_at"] is not None  # ISO string

    def test_heartbeat_null_match_info_is_safe(self):
        """If match row is somehow missing, fields are None — no crash."""
        ctx, session = _make_session()
        session.execute.return_value.fetchone.side_effect = [
            (_USER_ID,),  # UPDATE RETURNING — in match
            None,          # match info row missing
        ]
        session.execute.return_value.fetchall.side_effect = [
            [],  # no stale
            [],  # empty roster
        ]
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{_MATCH_ID}/heartbeat",
                headers=_AUTH_HEADERS,
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["host_id"] is None
        assert data["bet_amount"] is None


# ═══════════════════════════════════════════════════════════════════════════════
# POST /matches/{id}/kick — host removes a player from a waiting lobby
# ═══════════════════════════════════════════════════════════════════════════════

_GUEST_ID = str(uuid.uuid4())
_GUEST_TOKEN = auth.issue_token(_GUEST_ID, "guest@arena.gg")


def _session_for_kick(
    host_id: str = _USER_ID,
    status: str = "waiting",
    currency: str = "AT",
    bet: float = 50.0,
    target_in_room: bool = True,
):
    """Mock session for kick_player.

    Fetchone chain:
      1. SELECT host_id, status, stake_currency, bet_amount FROM matches → match_row
      2. SELECT 1 FROM match_players (target in room?) → (1,) or None
    """
    ctx, session = _make_session()
    session.execute.return_value.fetchone.side_effect = [
        (host_id, status, currency, bet),  # match_row
        (1,) if target_in_room else None,  # in_room check
    ]
    return ctx, session


class TestKickPlayer:
    """POST /matches/{id}/kick — host removes a player from a waiting lobby."""

    def test_kick_happy_path_host_removes_guest(self):
        """Host kicks guest from AT room → 200, AT refunded."""
        ctx, session = _session_for_kick()
        with patch("main.SessionLocal", return_value=ctx), \
             patch("main._credit_at") as mock_credit:
            resp = client.post(
                f"/matches/{_MATCH_ID}/kick",
                json={"user_id": _GUEST_ID},
                headers=_AUTH_HEADERS,
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["kicked"] is True
        assert data["match_id"] == _MATCH_ID
        assert data["user_id"] == _GUEST_ID
        mock_credit.assert_called_once()
        _, kwargs_uid, kwargs_amt = mock_credit.call_args[0][:3]
        assert kwargs_uid == _GUEST_ID
        assert kwargs_amt == 50

    def test_kick_crypto_room_no_at_refund(self):
        """CRYPTO match: kick player without AT refund."""
        ctx, session = _session_for_kick(currency="CRYPTO")
        with patch("main.SessionLocal", return_value=ctx), \
             patch("main._credit_at") as mock_credit:
            resp = client.post(
                f"/matches/{_MATCH_ID}/kick",
                json={"user_id": _GUEST_ID},
                headers=_AUTH_HEADERS,
            )
        assert resp.status_code == 200
        mock_credit.assert_not_called()

    def test_kick_non_host_returns_403(self):
        """Guest cannot kick another player → 403."""
        ctx, session = _session_for_kick(host_id=str(uuid.uuid4()))  # different host
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{_MATCH_ID}/kick",
                json={"user_id": _GUEST_ID},
                headers=_AUTH_HEADERS,  # _USER_ID is not the host
            )
        assert resp.status_code == 403
        assert "host" in resp.json()["detail"].lower()

    def test_kick_in_progress_match_returns_409(self):
        """Cannot kick from a match that has already started."""
        ctx, session = _session_for_kick(status="in_progress")
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{_MATCH_ID}/kick",
                json={"user_id": _GUEST_ID},
                headers=_AUTH_HEADERS,
            )
        assert resp.status_code == 409

    def test_kick_target_not_in_room_returns_404(self):
        """Target player not in match_players → 404."""
        ctx, session = _session_for_kick(target_in_room=False)
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{_MATCH_ID}/kick",
                json={"user_id": _GUEST_ID},
                headers=_AUTH_HEADERS,
            )
        assert resp.status_code == 404

    def test_kick_yourself_returns_400(self):
        """Host cannot kick themselves."""
        ctx, session = _session_for_kick()
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{_MATCH_ID}/kick",
                json={"user_id": _USER_ID},  # same as caller
                headers=_AUTH_HEADERS,
            )
        assert resp.status_code == 400
        assert "yourself" in resp.json()["detail"].lower()

    def test_kick_match_not_found_returns_404(self):
        """Match doesn't exist → 404."""
        ctx, session = _make_session()
        session.execute.return_value.fetchone.return_value = None
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.post(
                f"/matches/{_MATCH_ID}/kick",
                json={"user_id": _GUEST_ID},
                headers=_AUTH_HEADERS,
            )
        assert resp.status_code == 404

    def test_kick_requires_auth(self):
        resp = client.post(
            f"/matches/{_MATCH_ID}/kick",
            json={"user_id": _GUEST_ID},
        )
        assert resp.status_code == 422


# ═══════════════════════════════════════════════════════════════════════════════
# _expired_match_cleanup_loop — SQL covers both expires_at < NOW() and NULL
# ═══════════════════════════════════════════════════════════════════════════════

class TestExpiredMatchCleanupSQL:
    """
    Verify that _expired_match_cleanup_loop executes a query that handles:
      1. Rooms with expires_at < NOW()   — normal case, trigger was applied
      2. Rooms with expires_at IS NULL   — legacy rooms created before migration 009

    Both must be cancelled; a room with expires_at IS NULL that was created
    less than 1 hour ago must NOT be cancelled.

    We test by running one iteration of the loop and inspecting the SQL string
    that was passed to session.execute().
    """

    def test_cleanup_sql_covers_null_expires_at(self):
        """The UPDATE query must include the IS NULL fallback."""
        import asyncio
        from main import _expired_match_cleanup_loop

        ctx, session = _make_session()
        session.execute.return_value.fetchall.return_value = []  # no expired matches
        ctx.__enter__.return_value = session

        call_count = 0

        async def _run_once():
            nonlocal call_count

            async def _fast_sleep(n):
                nonlocal call_count
                call_count += 1
                if call_count >= 2:
                    raise asyncio.CancelledError()

            with patch("main.SessionLocal", return_value=ctx):
                with patch("asyncio.sleep", side_effect=_fast_sleep):
                    try:
                        await _expired_match_cleanup_loop(interval=0)
                    except asyncio.CancelledError:
                        pass

        asyncio.run(_run_once())

        # Grab the SQL string from the first execute call
        assert session.execute.called, "session.execute was never called"
        sql_arg = session.execute.call_args_list[0][0][0]
        sql_text = str(sql_arg).lower()

        assert "expires_at is null" in sql_text, (
            "Cleanup query must handle legacy rooms where expires_at IS NULL. "
            f"Got: {sql_text}"
        )
        assert "created_at" in sql_text, (
            "Cleanup query must fall back to created_at for NULL expires_at rooms. "
            f"Got: {sql_text}"
        )

    def test_cleanup_cancels_at_match_and_refunds(self):
        """When an expired AT match is found, _refund_at_match must be called."""
        import asyncio
        from main import _expired_match_cleanup_loop

        expired_match_id = str(uuid.uuid4())
        ctx, session = _make_session()
        session.execute.return_value.fetchall.return_value = [(expired_match_id, "AT")]
        ctx.__enter__.return_value = session

        call_count = 0

        async def _run_once():
            nonlocal call_count

            async def _fast_sleep(n):
                nonlocal call_count
                call_count += 1
                if call_count >= 2:
                    raise asyncio.CancelledError()

            with patch("main.SessionLocal", return_value=ctx):
                with patch("main._refund_at_match") as mock_refund:
                    with patch("asyncio.sleep", side_effect=_fast_sleep):
                        try:
                            await _expired_match_cleanup_loop(interval=0)
                        except asyncio.CancelledError:
                            pass
                    mock_refund.assert_called_once_with(expired_match_id)

        asyncio.run(_run_once())


# ═══════════════════════════════════════════════════════════════════════════════
# GET /match/active — restore lobby state + last_seen keep-alive
# ═══════════════════════════════════════════════════════════════════════════════

class TestGetActiveMatch:
    """
    GET /match/active — returns current active match and touches last_seen
    so the 3-second frontend poll acts as a keep-alive (no separate heartbeat call needed).
    """

    # 13-field tuple matching the SELECT in get_active_match:
    # id, game, status, bet_amount, stake_currency, type, code, created_at,
    # mode, host_id, host_username, max_players, max_per_team
    _MATCH_ROW = (
        _MATCH_ID,        # id
        "CS2",            # game
        "waiting",        # status
        "10.00",          # bet_amount
        "AT",             # stake_currency
        "public",         # type
        "ARENA-ABCDE",    # code
        datetime(2026, 4, 7, 12, 0, 0, tzinfo=timezone.utc),  # created_at
        "1v1",            # mode
        _USER_ID,         # host_id
        "HostPlayer",     # host_username
        2,                # max_players
        1,                # max_per_team
    )

    _PLAYERS = [
        (_USER_ID, "HostPlayer", None, "ARENA-HH", "A"),
    ]

    def _make_active_session(self, match_row=None, players=None):
        """
        Build a session mock for get_active_match.

        Execute call order:
          1. SELECT match → fetchone()
          2. UPDATE last_seen → execute() (no fetchone/fetchall needed)
          3. SELECT players → fetchall()
        """
        ctx, session = _make_session()
        session.execute.return_value.fetchone.return_value = match_row or self._MATCH_ROW
        session.execute.return_value.fetchall.return_value = players or self._PLAYERS
        return ctx, session

    def test_active_match_returns_match_and_players(self):
        """When user is in a match → returns full match object with players."""
        ctx, session = self._make_active_session()
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/match/active", headers=_AUTH_HEADERS)
        assert resp.status_code == 200
        data = resp.json()
        assert data["match"] is not None
        assert data["match"]["match_id"] == _MATCH_ID
        assert data["match"]["status"] == "waiting"
        assert data["match"]["your_user_id"] == _USER_ID
        assert isinstance(data["match"]["players"], list)

    def test_active_match_returns_your_team(self):
        """your_team is correctly extracted from the players list."""
        ctx, session = self._make_active_session()
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/match/active", headers=_AUTH_HEADERS)
        assert resp.status_code == 200
        assert resp.json()["match"]["your_team"] == "A"

    def test_active_match_updates_last_seen(self):
        """get_active_match must execute an UPDATE last_seen statement (keep-alive)."""
        ctx, session = self._make_active_session()
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/match/active", headers=_AUTH_HEADERS)
        assert resp.status_code == 200

        # Collect all SQL strings passed to session.execute
        sql_calls = [
            str(call.args[0]).lower()
            for call in session.execute.call_args_list
            if call.args
        ]
        assert any("last_seen" in sql for sql in sql_calls), (
            "get_active_match must UPDATE last_seen so the 3-second frontend poll "
            "acts as a keep-alive and prevents false stale-player removal.\n"
            f"SQL calls seen: {sql_calls}"
        )
        assert session.commit.called, "session.commit() must be called after updating last_seen"

    def test_active_match_no_match_returns_none(self):
        """When user is not in any match → returns {match: None}."""
        ctx, session = _make_session(fetchone=None, fetchall=[])
        with patch("main.SessionLocal", return_value=ctx):
            resp = client.get("/match/active", headers=_AUTH_HEADERS)
        assert resp.status_code == 200
        assert resp.json()["match"] is None

    def test_active_match_requires_auth(self):
        resp = client.get("/match/active")
        assert resp.status_code in (401, 422)
