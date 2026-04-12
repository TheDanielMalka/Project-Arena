"""
Slack Incoming Webhook alerts (optional).

Requires env SLACK_ALERTS_WEBHOOK_URL. Empty/missing → all calls are no-ops.
"""

from __future__ import annotations

import logging
import os

import httpx

logger = logging.getLogger(__name__)

_SLACK_TIMEOUT = 5.0


def slack_post(text: str) -> None:
    """
    POST {"text": ...} to the configured Slack webhook.

    No-op when SLACK_ALERTS_WEBHOOK_URL is unset/blank.
    Swallows errors — callers must not rely on delivery for control flow.
    """
    url = (os.getenv("SLACK_ALERTS_WEBHOOK_URL") or "").strip()
    if not url:
        return
    try:
        with httpx.Client(timeout=_SLACK_TIMEOUT) as client:
            resp = client.post(url, json={"text": text})
            resp.raise_for_status()
    except Exception as exc:
        logger.warning("slack_post failed: %s", exc)
