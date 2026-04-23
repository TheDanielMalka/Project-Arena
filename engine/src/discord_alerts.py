"""
Discord Incoming Webhook alerts (optional).

Requires env DISCORD_LOBBY_WEBHOOK_URL. Empty/missing → all calls are no-ops.
Used by the public match pool manager to announce new open rooms in #match-lobby.
"""

from __future__ import annotations

import logging
import os

import httpx

logger = logging.getLogger(__name__)

_DISCORD_TIMEOUT = 5.0


def discord_post(content: str, username: str = "Arena Bot") -> None:
    """
    POST a plain-text message to the configured Discord webhook.

    No-op when DISCORD_LOBBY_WEBHOOK_URL is unset/blank.
    Swallows errors — callers must not rely on delivery for control flow.
    """
    url = (os.getenv("DISCORD_LOBBY_WEBHOOK_URL") or "").strip()
    if not url:
        return
    try:
        with httpx.Client(timeout=_DISCORD_TIMEOUT) as client:
            resp = client.post(url, json={"content": content, "username": username})
            resp.raise_for_status()
    except Exception as exc:
        logger.warning("discord_post failed: %s", exc)
