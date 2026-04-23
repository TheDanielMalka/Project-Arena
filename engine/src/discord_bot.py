"""
Arena — Discord Bot client (REST only, no gateway).

Creates per-match private text channels and invite links when a match
goes LIVE.  Requires three environment variables:

  DISCORD_BOT_TOKEN          Bot token from Discord Developer Portal.
  DISCORD_GUILD_ID           Numeric ID of your Arena Discord server.
  DISCORD_MATCH_CATEGORY_ID  (optional) Category under which match
                              channels are created.

All public functions are synchronous and safe to run via
asyncio.to_thread() from an async FastAPI endpoint.

If DISCORD_BOT_TOKEN or DISCORD_GUILD_ID are not set every function
is a no-op that returns None — the rest of the engine carries on
without Discord.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

import httpx

from src.config import (
    DISCORD_BOT_TOKEN,
    DISCORD_GUILD_ID,
    DISCORD_MATCH_CATEGORY_ID,
)

log = logging.getLogger("arena.discord_bot")

_API_BASE   = "https://discord.com/api/v10"
_TIMEOUT    = 10.0   # seconds per HTTP call
_INVITE_TTL = 7200   # 2 hours — invite links expire after the match window


# ── Public data ────────────────────────────────────────────── #

@dataclass(frozen=True)
class DiscordMatchChannels:
    team_a_channel_id: str
    team_b_channel_id: str
    team_a_invite: str   # full https://discord.gg/... URL
    team_b_invite: str


# ── Internal helpers ───────────────────────────────────────── #

def _configured() -> bool:
    return bool(DISCORD_BOT_TOKEN and DISCORD_GUILD_ID)


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bot {DISCORD_BOT_TOKEN}",
        "Content-Type":  "application/json",
    }


def _call(
    client:  httpx.Client,
    method:  str,
    path:    str,
    *,
    payload: dict | None = None,
    reason:  str | None  = None,
) -> httpx.Response:
    """
    Single Discord REST call with one automatic retry on 429 rate-limit.
    Raises httpx.HTTPStatusError for any other non-2xx response.
    """
    headers = _headers()
    if reason:
        headers["X-Audit-Log-Reason"] = reason[:512]

    url  = f"{_API_BASE}{path}"
    resp = client.request(method, url, headers=headers, json=payload)

    if resp.status_code == 429:
        try:
            delay = float(resp.json().get("retry_after", 1.0))
        except Exception:
            delay = 1.0
        log.warning("discord_bot: rate limited on %s — retrying in %.2fs", path, delay)
        time.sleep(delay)
        resp = client.request(method, url, headers=headers, json=payload)

    resp.raise_for_status()
    return resp


def _create_channel(client: httpx.Client, name: str, match_code: str) -> str:
    """Create a private text channel; return its Discord channel ID."""
    payload: dict = {
        "name":  name,
        "type":  0,      # GUILD_TEXT
        "topic": f"Arena · {match_code} · auto-closes after match ends",
        "permission_overwrites": [
            {
                "id":   DISCORD_GUILD_ID,   # @everyone role = guild ID
                "type": 0,                  # role
                "deny": str(1 << 10),       # deny VIEW_CHANNEL (1024)
            }
        ],
    }
    if DISCORD_MATCH_CATEGORY_ID:
        payload["parent_id"] = DISCORD_MATCH_CATEGORY_ID

    resp = _call(
        client, "POST",
        f"/guilds/{DISCORD_GUILD_ID}/channels",
        payload=payload,
        reason=f"Arena match {match_code}",
    )
    return resp.json()["id"]


def _create_invite(
    client:     httpx.Client,
    channel_id: str,
    max_uses:   int,
) -> str:
    """Create a time-limited invite for channel_id; return full URL."""
    resp = _call(
        client, "POST",
        f"/channels/{channel_id}/invites",
        payload={
            "max_age":   _INVITE_TTL,
            "max_uses":  max(max_uses + 1, 2),
            "temporary": True,
            "unique":    True,
        },
    )
    code = resp.json()["code"]
    return f"https://discord.gg/{code}"


def _delete_channel(client: httpx.Client, channel_id: str, match_code: str) -> None:
    """Delete a single Discord channel. Errors are logged but not raised."""
    try:
        _call(
            client, "DELETE",
            f"/channels/{channel_id}",
            reason=f"Arena match {match_code} ended",
        )
    except Exception as exc:
        log.warning(
            "discord_bot: failed to delete channel=%s match=%s: %s",
            channel_id, match_code, exc,
        )


# ── Public API ─────────────────────────────────────────────── #

def create_match_channels(
    match_id:    str,
    match_code:  str,
    team_a_size: int = 1,
    team_b_size: int = 1,
) -> DiscordMatchChannels | None:
    """
    Create two private Discord text channels (one per team) for a match
    that just went LIVE, and generate time-limited invite links.

    Channel names:  match-{code}-team-a  /  match-{code}-team-b
    Invite TTL:     2 hours (INVITE_TTL = 7200 s)
    max_uses:       team_size + 1  (small buffer for reconnects)
    temporary:      True — Discord removes the member on disconnect

    Returns DiscordMatchChannels with channel IDs + invite URLs, or
    None if Discord is not configured or any API call fails.

    Designed to run inside asyncio.to_thread() from join_match().
    Handles one rate-limit retry per call automatically.
    """
    if not _configured():
        return None

    safe_code = match_code.lower()[:12]
    names = {
        "a": f"match-{safe_code}-team-a",
        "b": f"match-{safe_code}-team-b",
    }
    sizes = {"a": team_a_size, "b": team_b_size}
    created: dict[str, str] = {}   # team → channel_id

    try:
        with httpx.Client(timeout=_TIMEOUT) as client:
            for team in ("a", "b"):
                channel_id = _create_channel(client, names[team], match_code)
                created[team] = channel_id
                log.debug(
                    "discord_bot: created channel=%s name=%s match=%s",
                    channel_id, names[team], match_id,
                )

            invites: dict[str, str] = {}
            for team in ("a", "b"):
                invites[team] = _create_invite(client, created[team], sizes[team])

        result = DiscordMatchChannels(
            team_a_channel_id=created["a"],
            team_b_channel_id=created["b"],
            team_a_invite=invites["a"],
            team_b_invite=invites["b"],
        )
        log.info(
            "discord_bot: channels ready | match=%s code=%s "
            "ch_a=%s ch_b=%s",
            match_id, match_code, created["a"], created["b"],
        )
        return result

    except Exception as exc:
        log.error(
            "discord_bot: create_match_channels failed (non-fatal) | "
            "match=%s code=%s error=%s",
            match_id, match_code, exc,
        )
        # Best-effort cleanup of any channel that was created before the failure
        if created:
            try:
                with httpx.Client(timeout=_TIMEOUT) as client:
                    for cid in created.values():
                        _delete_channel(client, cid, match_code)
            except Exception:
                pass
        return None


def delete_match_channels(
    match_code:        str,
    team_a_channel_id: str | None,
    team_b_channel_id: str | None,
) -> None:
    """
    Delete both Discord channels after a match ends (completed / cancelled).

    Accepts None IDs gracefully — channels that were never created (e.g.
    because Discord was not configured at match start) are silently skipped.

    Non-fatal: every individual delete error is logged and swallowed.
    """
    if not _configured():
        return
    ids = [i for i in (team_a_channel_id, team_b_channel_id) if i]
    if not ids:
        return

    try:
        with httpx.Client(timeout=_TIMEOUT) as client:
            for cid in ids:
                _delete_channel(client, cid, match_code)
        log.info(
            "discord_bot: deleted %d channel(s) for match_code=%s",
            len(ids), match_code,
        )
    except Exception as exc:
        log.error(
            "discord_bot: delete_match_channels error (non-fatal): "
            "match_code=%s error=%s",
            match_code, exc,
        )
