"""
Tests for CRYPTO leave / delete guards added in migration 046.

POST /matches/{id}/leave:
  - CRYPTO + has_deposited=True  → 400 crypto_deposit_locked
  - CRYPTO + has_deposited=False → 200 left successfully
  - AT                            → 200 left + refund

DELETE /matches/{id}:
  - CRYPTO + deposits_received>0 → 400 requires_on_chain_cancel
  - CRYPTO + deposits_received=0 → 200 cancelled (no on-chain needed)
  - AT                            → 200 cancelled + refund

GET /matches/{id}/leave-status:
  - Returns correct flags for each scenario

GET /wallet/pending-withdrawals:
  - Returns wallet=null when user has no linked wallet
  - Returns has_pending=false when escrow_client=None
"""
from __future__ import annotations
import sys, uuid, pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

# ── Stub web3 (no real blockchain in unit tests) ──────────────────────────
if "web3" not in sys.modules:
    _w3 = MagicMock()
    _w3.Web3.HTTPProvider = MagicMock()
    _w3.Web3.to_checksum_address = lambda x: x
    _w3.Web3.from_wei = lambda v, u: float(v) / 10**18
    _w3.exceptions.ContractLogicError = Exception
    sys.modules["web3"] = _w3
    sys.modules["web3.exceptions"] = _w3.exceptions
    sys.modules["web3.middleware"] = MagicMock()
    sys.modules["web3.types"] = MagicMock()

import src.auth as _auth
from main import app

client = TestClient(app, raise_server_exceptions=False)


def _auth_headers(user_id: str):
    """Return Authorization header with a token whose sub=user_id."""
    token = _auth.issue_token(user_id, f"{user_id}@test.gg")
    return {"Authorization": f"Bearer {token}"}


# ── Helpers ──────────────────────────────────────────────────────────────────

def _uid() -> str:
    return str(uuid.uuid4())


def _patch_db(monkeypatch, fetchone_seq=None, fetchall_seq=None):
    """Patch SessionLocal so that execute() returns predictable rows."""
    fns = list(fetchone_seq or [])
    fi = {"n": 0}
    sess = MagicMock()

    from contextlib import contextmanager

    def _ex(q, p=None):
        r = MagicMock()
        def fn():
            v = fns[fi["n"]] if fi["n"] < len(fns) else None
            fi["n"] += 1
            return v
        r.fetchone.side_effect = fn
        r.scalar.side_effect = fn
        r.fetchall.return_value = fetchall_seq or []
        return r

    sess.execute.side_effect = _ex

    @contextmanager
    def _ctx():
        yield sess

    monkeypatch.setattr("main.SessionLocal", _ctx)
    return sess


# ── POST /matches/{id}/leave ─────────────────────────────────────────────────

class TestLeaveMatchCrypto:
    def test_crypto_deposited_returns_400(self, monkeypatch):
        """CRYPTO match where has_deposited=True → 400 with crypto_deposit_locked."""
        uid = _uid()
        match_id = str(uuid.uuid4())

        _patch_db(monkeypatch, fetchone_seq=[
            # match_row: host_id, status, stake_currency, bet_amount
            (_uid(), "waiting", "CRYPTO", 0.1),
            # player_row: has_deposited
            (True,),
        ])

        resp = client.post(
            f"/matches/{match_id}/leave",
            headers=_auth_headers(uid),
        )
        assert resp.status_code == 400
        body = resp.json()
        assert body["detail"]["code"] == "crypto_deposit_locked"

    def test_crypto_not_deposited_returns_200(self, monkeypatch):
        """CRYPTO match where has_deposited=False → 200 (removed from room, no on-chain needed)."""
        uid = _uid()
        match_id = str(uuid.uuid4())
        host_id = _uid()

        _patch_db(monkeypatch, fetchone_seq=[
            (host_id, "waiting", "CRYPTO", 0.1),
            (False,),
        ])

        resp = client.post(
            f"/matches/{match_id}/leave",
            headers=_auth_headers(uid),
        )
        assert resp.status_code == 200
        assert resp.json()["left"] is True

    def test_at_leave_returns_200(self, monkeypatch):
        """AT match leave → 200 with refund (unchanged behaviour)."""
        uid = _uid()
        host_id = _uid()
        match_id = str(uuid.uuid4())

        _patch_db(monkeypatch, fetchone_seq=[
            (host_id, "waiting", "AT", 100),
            (False,),
        ])

        with patch("main._credit_at"):
            resp = client.post(
                f"/matches/{match_id}/leave",
                headers=_auth_headers(uid),
            )
        assert resp.status_code == 200

    def test_host_cannot_leave(self, monkeypatch):
        """Host calling POST /leave → 400."""
        uid = _uid()
        match_id = str(uuid.uuid4())

        _patch_db(monkeypatch, fetchone_seq=[
            (uid, "waiting", "AT", 100),
        ])

        resp = client.post(
            f"/matches/{match_id}/leave",
            headers=_auth_headers(uid),
        )
        assert resp.status_code == 400

    def test_not_in_match_returns_400(self, monkeypatch):
        """Player not in match → 400."""
        uid = _uid()
        match_id = str(uuid.uuid4())

        _patch_db(monkeypatch, fetchone_seq=[
            (_uid(), "waiting", "AT", 100),
            None,  # player_row not found
        ])

        resp = client.post(
            f"/matches/{match_id}/leave",
            headers=_auth_headers(uid),
        )
        assert resp.status_code == 400


# ── DELETE /matches/{id} ─────────────────────────────────────────────────────

class TestDeleteMatchCrypto:
    def test_crypto_with_deposits_returns_400(self, monkeypatch):
        """CRYPTO match with deposits_received>0 → 400 requires_on_chain_cancel."""
        uid = _uid()
        match_id = str(uuid.uuid4())
        on_chain_id = 42

        _patch_db(monkeypatch, fetchone_seq=[
            (uid, "waiting", "CRYPTO", 3, on_chain_id),  # host_id=uid, deposits=3
        ])

        resp = client.delete(
            f"/matches/{match_id}",
            headers=_auth_headers(uid),
        )
        assert resp.status_code == 400
        body = resp.json()
        assert body["detail"]["code"] == "requires_on_chain_cancel"
        assert body["detail"]["on_chain_match_id"] == str(on_chain_id)

    def test_crypto_no_deposits_returns_200(self, monkeypatch):
        """CRYPTO match with 0 deposits → 200 (DB-only cancel)."""
        uid = _uid()
        match_id = str(uuid.uuid4())

        _patch_db(monkeypatch, fetchone_seq=[
            (uid, "waiting", "CRYPTO", 0, None),
        ])

        resp = client.delete(
            f"/matches/{match_id}",
            headers=_auth_headers(uid),
        )
        assert resp.status_code == 200
        assert resp.json()["cancelled"] is True

    def test_at_cancel_returns_200(self, monkeypatch):
        """AT match cancel → 200 with refund."""
        uid = _uid()
        match_id = str(uuid.uuid4())

        _patch_db(monkeypatch, fetchone_seq=[
            (uid, "waiting", "AT", 0, None),
        ])

        with patch("main._refund_at_match"):
            resp = client.delete(
                f"/matches/{match_id}",
                headers=_auth_headers(uid),
            )
        assert resp.status_code == 200

    def test_non_host_gets_403(self, monkeypatch):
        """Non-host calling DELETE → 403."""
        uid = _uid()
        match_id = str(uuid.uuid4())

        _patch_db(monkeypatch, fetchone_seq=[
            (_uid(), "waiting", "AT", 0, None),  # host_id != uid
        ])

        resp = client.delete(
            f"/matches/{match_id}",
            headers=_auth_headers(uid),
        )
        assert resp.status_code == 403


# ── GET /wallet/pending-withdrawals ─────────────────────────────────────────

class TestGetPendingWithdrawals:
    def test_no_wallet_linked(self, monkeypatch):
        """User with no wallet_address returns wallet=null, has_pending=false."""
        uid = _uid()

        _patch_db(monkeypatch, fetchone_seq=[
            (None,),   # wallet_address is NULL
            (0,),      # DB sum = 0
        ])

        with patch("main._escrow_client", None):
            resp = client.get(
                "/wallet/pending-withdrawals",
                headers=_auth_headers(uid),
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["has_pending"] is False
        assert body["wallet"] is None

    def test_no_escrow_client_returns_zero(self, monkeypatch):
        """When escrow_client is None, on_chain_wei=0, only DB is checked."""
        uid = _uid()

        _patch_db(monkeypatch, fetchone_seq=[
            ("0xwallet",),
            (0,),
        ])

        with patch("main._escrow_client", None):
            resp = client.get(
                "/wallet/pending-withdrawals",
                headers=_auth_headers(uid),
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["on_chain_wei"] == "0"
        assert body["has_pending"] is False

    def test_with_on_chain_pending(self, monkeypatch):
        """When escrow_client returns non-zero, has_pending=true."""
        uid = _uid()

        _patch_db(monkeypatch, fetchone_seq=[
            ("0xwallet",),
            (0,),
        ])

        mock_escrow = MagicMock()
        mock_escrow.read_pending_withdrawals.return_value = 5 * 10**16

        with patch("main._escrow_client", mock_escrow):
            resp = client.get(
                "/wallet/pending-withdrawals",
                headers=_auth_headers(uid),
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["has_pending"] is True
        assert body["on_chain_wei"] == str(5 * 10**16)


# ── GET /matches/{id}/leave-status ──────────────────────────────────────────

class TestLeaveStatus:
    def test_at_match_can_leave_now(self, monkeypatch):
        """AT match → can_leave_now=True, rescue_available=False."""
        uid = _uid()
        match_id = str(uuid.uuid4())
        import datetime
        created = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=5)

        _patch_db(monkeypatch, fetchone_seq=[
            (uid, "waiting", "AT", created, 0, None),  # match row (host_id=uid)
            (False,),  # has_deposited
        ])

        resp = client.get(
            f"/matches/{match_id}/leave-status",
            headers=_auth_headers(uid),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["can_leave_now"] is True
        assert body["rescue_available"] is False
        assert body["stake_currency"] == "AT"

    def test_crypto_deposited_past_timeout_rescue_available(self, monkeypatch):
        """CRYPTO + deposited + created >1h ago → rescue_available=True."""
        uid = _uid()
        match_id = str(uuid.uuid4())
        import datetime
        created = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=2)

        _patch_db(monkeypatch, fetchone_seq=[
            (_uid(), "waiting", "CRYPTO", created, 1, 99),  # host!=uid, deposits=1
            (True,),   # has_deposited
        ])

        resp = client.get(
            f"/matches/{match_id}/leave-status",
            headers=_auth_headers(uid),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["rescue_available"] is True
        assert body["can_leave_now"] is False
        assert body["has_deposited"] is True

    def test_crypto_deposited_within_timeout_no_rescue(self, monkeypatch):
        """CRYPTO + deposited + created <1h ago → rescue_available=False."""
        uid = _uid()
        match_id = str(uuid.uuid4())
        import datetime
        created = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=30)

        _patch_db(monkeypatch, fetchone_seq=[
            (_uid(), "waiting", "CRYPTO", created, 1, 99),
            (True,),
        ])

        resp = client.get(
            f"/matches/{match_id}/leave-status",
            headers=_auth_headers(uid),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["rescue_available"] is False

    def test_host_crypto_with_deposits_requires_cancel(self, monkeypatch):
        """Host CRYPTO + deposits_received>0 → requires_cancel=True."""
        uid = _uid()
        match_id = str(uuid.uuid4())
        import datetime
        created = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=10)

        _patch_db(monkeypatch, fetchone_seq=[
            (uid, "waiting", "CRYPTO", created, 2, 77),  # host_id=uid, deposits=2
            (True,),
        ])

        resp = client.get(
            f"/matches/{match_id}/leave-status",
            headers=_auth_headers(uid),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["is_host"] is True
        assert body["requires_cancel"] is True
