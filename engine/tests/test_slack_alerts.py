"""Unit tests for src.slack_alerts (optional webhook)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


def test_slack_post_no_url_is_noop(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SLACK_ALERTS_WEBHOOK_URL", raising=False)
    from src.slack_alerts import slack_post

    with patch("src.slack_alerts.httpx.Client") as Client:
        slack_post("should not send")
        Client.assert_not_called()


def test_slack_post_posts_json(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SLACK_ALERTS_WEBHOOK_URL", "https://hooks.example/test")
    from src.slack_alerts import slack_post

    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_client = MagicMock()
    mock_client.post.return_value = mock_resp
    ctx = MagicMock()
    ctx.__enter__ = MagicMock(return_value=mock_client)
    ctx.__exit__ = MagicMock(return_value=False)

    with patch("src.slack_alerts.httpx.Client", return_value=ctx):
        slack_post("hello arena")

    mock_client.post.assert_called_once_with(
        "https://hooks.example/test",
        json={"text": "hello arena"},
    )
