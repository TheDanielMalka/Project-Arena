"""Host desktop client silence → auto-cancel waiting match (engine/main.py)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch

import main


class TestTryCancelWaitingMatchHostClientTimeout:
    def test_noop_when_not_waiting(self) -> None:
        ctx = MagicMock()
        session = ctx.__enter__.return_value
        session.execute.return_value.fetchone.return_value = None

        with patch.object(main, "SessionLocal", return_value=ctx):
            with patch.object(main, "_refund_at_match") as refund:
                assert main._try_cancel_waiting_match_host_client_timeout(str(uuid.uuid4())) is False
                refund.assert_not_called()

    def test_cancels_and_refunds_at(self) -> None:
        mid = str(uuid.uuid4())
        ctx = MagicMock()
        session = ctx.__enter__.return_value
        session.execute.return_value.fetchone.return_value = ("AT",)

        with patch.object(main, "SessionLocal", return_value=ctx):
            with patch.object(main, "_refund_at_match") as refund:
                assert main._try_cancel_waiting_match_host_client_timeout(mid) is True
                refund.assert_called_once_with(mid)

    def test_cancels_crypto_no_refund_call(self) -> None:
        mid = str(uuid.uuid4())
        ctx = MagicMock()
        session = ctx.__enter__.return_value
        session.execute.return_value.fetchone.return_value = ("CRYPTO",)

        with patch.object(main, "SessionLocal", return_value=ctx):
            with patch.object(main, "_refund_at_match") as refund:
                assert main._try_cancel_waiting_match_host_client_timeout(mid) is True
                refund.assert_not_called()


class TestFindWaitingMatchesHostClientTimedOut:
    def test_returns_ids_from_query(self) -> None:
        mid = str(uuid.uuid4())
        ctx = MagicMock()
        session = ctx.__enter__.return_value
        session.execute.return_value.fetchall.return_value = [(mid,)]

        cutoff = datetime.now(timezone.utc) - timedelta(minutes=2)
        with patch.object(main, "SessionLocal", return_value=ctx):
            out = main._find_waiting_matches_host_client_timed_out(cutoff)

        assert out == [mid]
        assert session.execute.called

    def test_returns_empty_on_db_error(self) -> None:
        ctx = MagicMock()
        session = ctx.__enter__.return_value
        session.execute.side_effect = RuntimeError("db down")

        with patch.object(main, "SessionLocal", return_value=ctx):
            out = main._find_waiting_matches_host_client_timed_out(datetime.now(timezone.utc))

        assert out == []


class TestGetClientHostLobbyTimeoutSeconds:
    def test_default_when_no_row(self) -> None:
        ctx = MagicMock()
        session = ctx.__enter__.return_value
        session.execute.return_value.fetchone.return_value = None

        with patch.object(main, "SessionLocal", return_value=ctx):
            assert main._get_client_host_lobby_timeout_seconds() == 60

    def test_uses_config_value(self) -> None:
        ctx = MagicMock()
        session = ctx.__enter__.return_value
        session.execute.return_value.fetchone.return_value = ("120",)

        with patch.object(main, "SessionLocal", return_value=ctx):
            assert main._get_client_host_lobby_timeout_seconds() == 120

    def test_clamps_high_value(self) -> None:
        ctx = MagicMock()
        session = ctx.__enter__.return_value
        session.execute.return_value.fetchone.return_value = ("99999",)

        with patch.object(main, "SessionLocal", return_value=ctx):
            assert main._get_client_host_lobby_timeout_seconds() == 3600
