"""
Tournament API — CS2 seasons, divisions, registration.
Uses Bearer JWT (same as /auth/me). Public read for listings.

Mount (choose one in your deployment; not hard-wired in main.py in this branch):
    app.include_router(router)   # router = APIRouter from this module, prefix already /tournaments
"""
from __future__ import annotations

import uuid as _uuid
from datetime import datetime, timezone
from typing import Any

import jwt
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

import src.auth as auth

_bearer = HTTPBearer(auto_error=False)
router = APIRouter(prefix="/tournaments", tags=["tournaments"])


def _get_session() -> Session:
    from main import SessionLocal  # noqa: PLC0415

    return SessionLocal()


async def _require_bearer(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    if not creds:
        raise HTTPException(401, "Authentication required")
    try:
        payload = auth.decode_token(creds.credentials)
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")
    if payload.get("token_use") == "2fa_pending":
        raise HTTPException(401, "Complete 2FA first")
    return payload


def _uid(payload: dict) -> str:
    return str(payload["sub"])


@router.get("/seasons")
def list_seasons() -> dict[str, Any]:
    with _get_session() as session:
        rows = session.execute(
            text(
                """
                SELECT s.id, s.slug, s.title, s.title_he, s.subtitle, s.game::text, s.network_phase, s.state,
                       s.warm_up_minutes, s.registration_opens_at, s.registration_closes_at, s.main_starts_at,
                       s.test_disclaimer_md, s.future_rewards_md, s.marketing_blurb_md
                FROM tournament_seasons s
                WHERE s.state NOT IN ('cancelled', 'draft')
                ORDER BY s.main_starts_at NULLS LAST, s.created_at DESC
                """
            )
        ).fetchall()
    seasons: list[dict[str, Any]] = []
    for r in rows:
        sid = str(r[0])
        with _get_session() as session:
            divs = session.execute(
                text(
                    """
                    SELECT d.id, d.mode::text, d.title, d.title_he, d.position, d.prize1_ils, d.prize2_ils, d.prize3_ils,
                           d.format_markdown, d.max_slots, d.is_team_mode,
                           (SELECT COUNT(*)::int FROM tournament_registrations r
                            WHERE r.division_id = d.id AND r.status = 'confirmed') AS reg_count
                    FROM tournament_divisions d
                    WHERE d.season_id = :sid
                    ORDER BY d.position ASC, d.mode::text
                    """
                ),
                {"sid": sid},
            ).fetchall()
        seasons.append(
            {
                "id": sid,
                "slug": r[1],
                "title": r[2],
                "titleHe": r[3],
                "subtitle": r[4],
                "game": r[5],
                "networkPhase": r[6],
                "state": r[7],
                "warmUpMinutes": r[8],
                "registrationOpensAt": r[9].isoformat() if r[9] else None,
                "registrationClosesAt": r[10].isoformat() if r[10] else None,
                "mainStartsAt": r[11].isoformat() if r[11] else None,
                "testDisclaimerMd": r[12],
                "futureRewardsMd": r[13],
                "marketingBlurbMd": r[14],
                "divisions": [
                    {
                        "id": str(d[0]),
                        "mode": d[1],
                        "title": d[2],
                        "titleHe": d[3],
                        "position": d[4],
                        "prize1Ils": d[5],
                        "prize2Ils": d[6],
                        "prize3Ils": d[7],
                        "formatMarkdown": d[8],
                        "maxSlots": d[9],
                        "isTeamMode": d[10],
                        "registeredCount": d[11] or 0,
                    }
                    for d in divs
                ],
            }
        )
    return {"seasons": seasons}


@router.get("/seasons/{slug}")
def get_season(slug: str) -> dict[str, Any]:
    with _get_session() as session:
        r = session.execute(
            text(
                """
                SELECT s.id, s.slug, s.title, s.title_he, s.subtitle, s.game::text, s.network_phase, s.state,
                       s.warm_up_minutes, s.registration_opens_at, s.registration_closes_at, s.main_starts_at,
                       s.test_disclaimer_md, s.future_rewards_md, s.marketing_blurb_md
                FROM tournament_seasons s WHERE s.slug = :slug
                """
            ),
            {"slug": slug},
        ).fetchone()
    if not r:
        raise HTTPException(404, "Tournament not found")
    sid = str(r[0])
    with _get_session() as session:
        divs = session.execute(
            text(
                """
                SELECT d.id, d.mode::text, d.title, d.title_he, d.position, d.prize1_ils, d.prize2_ils, d.prize3_ils,
                       d.format_markdown, d.max_slots, d.is_team_mode,
                       (SELECT COUNT(*)::int FROM tournament_registrations r
                        WHERE r.division_id = d.id AND r.status = 'confirmed') AS reg_count
                FROM tournament_divisions d
                WHERE d.season_id = :sid
                ORDER BY d.position ASC
                """
            ),
            {"sid": sid},
        ).fetchall()
    return {
        "season": {
            "id": sid,
            "slug": r[1],
            "title": r[2],
            "titleHe": r[3],
            "subtitle": r[4],
            "game": r[5],
            "networkPhase": r[6],
            "state": r[7],
            "warmUpMinutes": r[8],
            "registrationOpensAt": r[9].isoformat() if r[9] else None,
            "registrationClosesAt": r[10].isoformat() if r[10] else None,
            "mainStartsAt": r[11].isoformat() if r[11] else None,
            "testDisclaimerMd": r[12],
            "futureRewardsMd": r[13],
            "marketingBlurbMd": r[14],
            "divisions": [
                {
                    "id": str(d[0]),
                    "mode": d[1],
                    "title": d[2],
                    "titleHe": d[3],
                    "position": d[4],
                    "prize1Ils": d[5],
                    "prize2Ils": d[6],
                    "prize3Ils": d[7],
                    "formatMarkdown": d[8],
                    "maxSlots": d[9],
                    "isTeamMode": d[10],
                    "registeredCount": d[11] or 0,
                }
                for d in divs
            ],
        }
    }


class PlayerDetail(BaseModel):
    ign: str = Field(min_length=1, max_length=64)
    steam_id: str | None = Field(default=None, max_length=32)
    country: str | None = Field(default=None, max_length=64)
    email: str | None = Field(default=None, max_length=120)


class RegisterBody(BaseModel):
    division_id: str
    team_label: str | None = Field(default=None, max_length=64)
    ack_arena_client: bool = False
    ack_testnet: bool = False
    ack_cs2_ownership: bool = False
    wants_demo_at: bool = False
    met_wallet_connected: bool = False
    players: list[PlayerDetail] = Field(default_factory=list)


@router.post("/seasons/{slug}/register", status_code=201)
def register_tournament(
    slug: str,
    body: RegisterBody,
    payload: dict = Depends(_require_bearer),
) -> dict[str, Any]:
    uid = _uid(payload)
    if not (body.ack_arena_client and body.ack_testnet and body.ack_cs2_ownership):
        raise HTTPException(400, "All acknowledgements (Arena client, test event, CS2) are required")
    with _get_session() as session:
        srow = session.execute(
            text("SELECT id, state, registration_closes_at FROM tournament_seasons WHERE slug = :s"),
            {"s": slug},
        ).fetchone()
        if not srow:
            raise HTTPException(404, "Tournament not found")
        if srow[1] not in ("registration_open", "warmup"):
            raise HTTPException(400, "Registration is not open for this event")
        closes = srow[2]
        if closes and datetime.now(timezone.utc) > closes:
            raise HTTPException(400, "Registration is closed")
        drow = session.execute(
            text(
                "SELECT id, season_id, max_slots FROM tournament_divisions "
                "WHERE id = :did::uuid AND season_id = :sid::uuid"
            ),
            {"did": body.division_id, "sid": str(srow[0])},
        ).fetchone()
        if not drow:
            raise HTTPException(400, "Invalid division for this season")
        urow = session.execute(
            text("SELECT steam_id, steam_verified, COALESCE(TRIM(wallet_address), '') AS w FROM users WHERE id = :uid::uuid"),
            {"uid": uid},
        ).fetchone()
        if not urow or not (urow[0] and str(urow[0]).strip()):
            raise HTTPException(
                400,
                "Set your Steam / SteamID64 on your Arena profile (Settings) — required for CS2 events.",
            )
        steam_id = str(urow[0]).strip()
        count = session.execute(
            text("SELECT COUNT(*) FROM tournament_registrations WHERE division_id = :d::uuid AND status = 'confirmed'"),
            {"d": body.division_id},
        ).scalar()
        cnt = int(count or 0)
        if cnt >= int(drow[2]):
            status = "waitlist"
        else:
            status = "confirmed"
        reg_id = str(_uuid.uuid4())
        try:
            session.execute(
                text(
                    """
                    INSERT INTO tournament_registrations (
                        id, season_id, division_id, user_id, steam_id_at_register, team_label,
                        ack_arena_client, ack_testnet, ack_cs2_ownership, wants_demo_at, met_wallet_connected, status
                    ) VALUES (
                        :id::uuid, :sid::uuid, :did::uuid, :uid::uuid, :steam, :team,
                        :ac, :at, :c2, :wda, :mw, :st
                    )
                    """
                ),
                {
                    "id": reg_id,
                    "sid": str(srow[0]),
                    "did": body.division_id,
                    "uid": uid,
                    "steam": steam_id,
                    "team": (body.team_label or "").strip() or None,
                    "ac": body.ack_arena_client,
                    "at": body.ack_testnet,
                    "c2": body.ack_cs2_ownership,
                    "wda": body.wants_demo_at,
                    "mw": bool(body.met_wallet_connected),
                    "st": status,
                },
            )
            for i, p in enumerate(body.players):
                session.execute(
                    text(
                        """
                        INSERT INTO tournament_registration_players
                            (registration_id, slot, ign, steam_id, country, email)
                        VALUES (:rid::uuid, :slot, :ign, :sid, :country, :email)
                        ON CONFLICT (registration_id, slot) DO NOTHING
                        """
                    ),
                    {
                        "rid": reg_id,
                        "slot": i,
                        "ign": p.ign,
                        "sid": p.steam_id,
                        "country": p.country,
                        "email": p.email,
                    },
                )
            session.commit()
        except Exception as exc:  # noqa: BLE001
            session.rollback()
            exc_str = str(exc)
            if "tournament_reg_user_division" in exc_str or "unique" in exc_str.lower():
                raise HTTPException(409, "Already registered in this division") from exc
            if "invalid input syntax for type uuid" in exc_str:
                raise HTTPException(400, "Invalid division — reload the page and try again") from exc
            raise HTTPException(500, "Registration failed") from exc
    return {"ok": True, "status": status, "divisionId": body.division_id, "registrationId": reg_id}


@router.get("/seasons/{slug}/teams")
def list_teams(slug: str) -> dict[str, Any]:
    with _get_session() as session:
        srow = session.execute(
            text("SELECT id FROM tournament_seasons WHERE slug = :s"),
            {"s": slug},
        ).fetchone()
        if not srow:
            raise HTTPException(404, "Tournament not found")
        sid = str(srow[0])
        rows = session.execute(
            text(
                """
                SELECT
                    d.mode::text, d.title, d.position,
                    r.id, r.team_label, r.status, r.created_at,
                    u.username,
                    COALESCE(
                        (SELECT json_agg(json_build_object(
                            'slot', p.slot, 'ign', p.ign,
                            'steamId', p.steam_id, 'country', p.country
                        ) ORDER BY p.slot)
                         FROM tournament_registration_players p
                         WHERE p.registration_id = r.id),
                        '[]'::json
                    ) AS players
                FROM tournament_registrations r
                JOIN tournament_divisions d ON d.id = r.division_id
                JOIN users u ON u.id = r.user_id
                WHERE r.season_id = :sid AND r.status IN ('confirmed', 'waitlist')
                ORDER BY d.position, r.created_at
                """
            ),
            {"sid": sid},
        ).fetchall()
    teams: list[dict[str, Any]] = []
    for row in rows:
        teams.append(
            {
                "mode": row[0],
                "divisionTitle": row[1],
                "registrationId": str(row[3]),
                "teamLabel": row[4] or row[7],
                "status": row[5],
                "registeredAt": row[6].isoformat() if row[6] else None,
                "captain": row[7],
                "players": row[8] if isinstance(row[8], list) else [],
            }
        )
    return {"teams": teams}


@router.get("/me")
def my_tournament_regs(payload: dict = Depends(_require_bearer)) -> dict[str, Any]:
    uid = _uid(payload)
    with _get_session() as session:
        rows = session.execute(
            text(
                """
                SELECT r.id, s.slug, d.mode::text, d.title, r.status, r.created_at, s.title
                FROM tournament_registrations r
                JOIN tournament_seasons s ON s.id = r.season_id
                JOIN tournament_divisions d ON d.id = r.division_id
                WHERE r.user_id = :uid::uuid
                ORDER BY r.created_at DESC
                """
            ),
            {"uid": uid},
        ).fetchall()
    return {
        "registrations": [
            {
                "id": str(x[0]),
                "seasonSlug": x[1],
                "mode": x[2],
                "divisionTitle": x[3],
                "status": x[4],
                "createdAt": x[5].isoformat() if x[5] else None,
                "seasonTitle": x[6],
            }
            for x in rows
        ]
    }
