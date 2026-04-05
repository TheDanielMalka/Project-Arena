"""Tests for engine/src/contract/escrow_client.py - Web3 stubbed via sys.modules."""
from __future__ import annotations
import os, sys, uuid
from contextlib import contextmanager
from unittest.mock import MagicMock
import pytest

if "web3" not in sys.modules:
    _s = MagicMock()
    _s.Web3.HTTPProvider = MagicMock()
    _s.Web3.to_checksum_address = lambda x: x
    _s.Web3.from_wei = lambda v, u: v / 10**18
    _s.exceptions.ContractLogicError = Exception
    sys.modules["web3"] = _s
    sys.modules["web3.exceptions"] = _s.exceptions
    sys.modules["web3.middleware"] = MagicMock()
    sys.modules["web3.types"] = MagicMock()


def _sf(fns=None, fas=None):
    sess = MagicMock()
    fns = list(fns or []); fas = list(fas or [])
    fi = {"n": 0}; ai = {"n": 0}

    def _ex(q, p=None):
        r = MagicMock()
        def fn():
            v = fns[fi["n"]] if fi["n"] < len(fns) else None
            fi["n"] += 1; return v
        def fa():
            v = fas[ai["n"]] if ai["n"] < len(fas) else []
            ai["n"] += 1; return v
        r.fetchone.side_effect = fn; r.fetchall.side_effect = fa; return r
    sess.execute.side_effect = _ex

    @contextmanager
    def factory(): yield sess
    return factory, sess


def _client(fns=None, fas=None):
    from src.contract.escrow_client import EscrowClient
    w3 = MagicMock(); w3.is_connected.return_value = True
    w3.eth.chain_id = 97; w3.eth.block_number = 100
    ct = MagicMock()
    ct.address = "0x47bB9861263A1AB7dAF2353765e0fd3118b71d38"
    ct.functions.isPaused.return_value.call.return_value = False
    acc = MagicMock(); acc.address = "0xOracle"
    f, s = _sf(fns, fas)
    c = object.__new__(EscrowClient)
    c._w3 = w3; c._contract = ct; c._account = acc; c._session_factory = f
    return c, w3, ct, s


class TestBuildEscrowClient:
    def _clean(self):
        for k in ("BLOCKCHAIN_RPC_URL", "CONTRACT_ADDRESS", "PRIVATE_KEY"):
            os.environ.pop(k, None)

    def test_none_missing_rpc(self):
        from src.contract.escrow_client import build_escrow_client
        f, _ = _sf(); self._clean()
        os.environ["CONTRACT_ADDRESS"] = "0xA"
        os.environ["PRIVATE_KEY"] = "aa" * 32
        assert build_escrow_client(f) is None

    def test_none_missing_contract(self):
        from src.contract.escrow_client import build_escrow_client
        f, _ = _sf(); self._clean()
        os.environ["BLOCKCHAIN_RPC_URL"] = "http://x"
        os.environ["PRIVATE_KEY"] = "aa" * 32
        assert build_escrow_client(f) is None

    def test_none_missing_key(self):
        from src.contract.escrow_client import build_escrow_client
        f, _ = _sf(); self._clean()
        os.environ["BLOCKCHAIN_RPC_URL"] = "http://x"
        os.environ["CONTRACT_ADDRESS"] = "0xA"
        assert build_escrow_client(f) is None

    def test_returns_client(self):
        from src.contract.escrow_client import build_escrow_client, EscrowClient
        from unittest.mock import patch
        f, _ = _sf(); self._clean()
        os.environ["BLOCKCHAIN_RPC_URL"] = "http://x"
        os.environ["CONTRACT_ADDRESS"] = "0x47bB9861263A1AB7dAF2353765e0fd3118b71d38"
        os.environ["PRIVATE_KEY"] = "aa" * 32
        # Patch Web3 at module level so no real RPC connection is attempted.
        # On CI (Linux) web3 is installed for real; without this patch __init__
        # calls self._w3.eth.chain_id which tries to reach http://x and fails.
        with patch("src.contract.escrow_client.Web3") as MockWeb3:
            mock_w3 = MagicMock()
            MockWeb3.return_value = mock_w3
            MockWeb3.HTTPProvider.return_value = MagicMock()
            MockWeb3.to_checksum_address.side_effect = lambda x: x
            mock_w3.eth.account.from_key.return_value = MagicMock()
            mock_w3.eth.contract.return_value = MagicMock()
            result = build_escrow_client(f)
        assert isinstance(result, EscrowClient)


class TestIsHealthy:
    def test_true(self):
        c, *_ = _client(); assert c.is_healthy() is True

    def test_false_disconnected(self):
        c, w3, *_ = _client(); w3.is_connected.return_value = False
        assert c.is_healthy() is False

    def test_false_paused(self):
        c, _, ct, _ = _client()
        ct.functions.isPaused.return_value.call.return_value = True
        assert c.is_healthy() is False

    def test_false_exception(self):
        c, w3, *_ = _client(); w3.is_connected.side_effect = Exception("x")
        assert c.is_healthy() is False


class TestDeclareWinner:
    def test_team_a_passes_0(self):
        c, _, ct, _ = _client(fns=[(42,), ("A",)])
        c._send_tx = MagicMock(return_value="0xTX")
        c.declare_winner(str(uuid.uuid4()), str(uuid.uuid4()))
        ct.functions.declareWinner.assert_called_once_with(42, 0)

    def test_team_b_passes_1(self):
        c, _, ct, _ = _client(fns=[(7,), ("B",)])
        c._send_tx = MagicMock(return_value="0xTX")
        c.declare_winner(str(uuid.uuid4()), str(uuid.uuid4()))
        ct.functions.declareWinner.assert_called_once_with(7, 1)

    def test_returns_tx_hash(self):
        c, *_ = _client(fns=[(5,), ("A",)])
        c._send_tx = MagicMock(return_value="0xHASH")
        assert c.declare_winner(str(uuid.uuid4()), str(uuid.uuid4())) == "0xHASH"

    def test_raises_match_not_found(self):
        c, *_ = _client(fns=[None])
        with pytest.raises(ValueError, match="not found in DB"):
            c.declare_winner(str(uuid.uuid4()), str(uuid.uuid4()))

    def test_raises_no_on_chain_id(self):
        c, *_ = _client(fns=[(None,)])
        with pytest.raises(ValueError, match="no on_chain_match_id"):
            c.declare_winner(str(uuid.uuid4()), str(uuid.uuid4()))

    def test_raises_winner_not_in_players(self):
        c, *_ = _client(fns=[(42,), None])
        with pytest.raises(ValueError, match="not found in match_players"):
            c.declare_winner(str(uuid.uuid4()), str(uuid.uuid4()))


class TestCancelMatch:
    def test_happy(self):
        c, _, ct, _ = _client(fns=[(9,)])
        c._send_tx = MagicMock(return_value="0xC")
        assert c.cancel_match_on_chain(str(uuid.uuid4())) == "0xC"
        ct.functions.cancelMatch.assert_called_once_with(9)

    def test_raises_not_found(self):
        c, *_ = _client(fns=[None])
        with pytest.raises(ValueError, match="no on_chain_match_id"):
            c.cancel_match_on_chain(str(uuid.uuid4()))


class TestGetOnChainMatch:
    def test_returns_all_keys(self):
        c, _, ct, _ = _client()
        ct.functions.getMatch.return_value.call.return_value = ([], [], 0, 1, 0, 0, 0, 0)
        r = c.get_on_chain_match(1)
        assert set(r) == {"teamA", "teamB", "stakePerPlayer", "teamSize",
                          "depositsTeamA", "depositsTeamB", "state", "winningTeam"}

    def test_passes_id(self):
        c, _, ct, _ = _client()
        ct.functions.getMatch.return_value.call.return_value = ([], [], 0, 1, 0, 0, 0, 0)
        c.get_on_chain_match(99)
        ct.functions.getMatch.assert_called_once_with(99)


class TestProcessEvents:
    def _setup(self, c, logs_by_name):
        for h in ["_handle_match_created", "_handle_player_deposited",
                  "_handle_match_active", "_handle_winner_declared",
                  "_handle_match_refunded", "_handle_match_cancelled"]:
            setattr(c, h, MagicMock())
        for name in ["MatchCreated", "PlayerDeposited", "MatchActive",
                     "WinnerDeclared", "MatchRefunded", "MatchCancelled"]:
            ev = MagicMock()
            ev.get_logs.return_value = logs_by_name.get(name, [])
            setattr(c._contract.events, name, ev)

    def test_counts(self):
        c, *_ = _client(); self._setup(c, {"MatchCreated": [{}] * 3})
        assert c.process_events(1, 100) == 3

    def test_zero(self):
        c, *_ = _client(); self._setup(c, {})
        assert c.process_events(1, 100) == 0

    def test_continues_on_handler_error(self):
        c, *_ = _client(); self._setup(c, {"MatchCreated": [{}]})
        c._handle_match_created.side_effect = RuntimeError("boom")
        assert c.process_events(1, 100) == 0

    def test_continues_on_filter_error(self):
        c, *_ = _client(); self._setup(c, {})
        for name in ["MatchCreated", "PlayerDeposited", "MatchActive",
                     "WinnerDeclared", "MatchRefunded", "MatchCancelled"]:
            ev = MagicMock(); ev.get_logs.side_effect = Exception("rpc")
            setattr(c._contract.events, name, ev)
        assert c.process_events(1, 100) == 0


class TestHandleMatchActive:
    def test_commits(self):
        c, _, _, s = _client()
        c._handle_match_active({"args": {"matchId": 7}})
        s.commit.assert_called_once()


class TestHandleMatchCreated:
    def _ev(self):
        return {"args": {"matchId": 1, "creator": "0xDEAD",
                         "teamSize": 1, "stakePerPlayer": 10**17}}

    def test_skip_unknown_wallet(self):
        c, _, _, s = _client(fns=[None])
        c._handle_match_created(self._ev()); s.commit.assert_not_called()

    def test_skip_no_waiting_match(self):
        c, _, _, s = _client(fns=[(str(uuid.uuid4()),), None])
        c._handle_match_created(self._ev()); s.commit.assert_not_called()

    def test_commits_on_success(self):
        uid = str(uuid.uuid4()); mid = str(uuid.uuid4())
        c, _, _, s = _client(fns=[(uid,), (mid,)])
        c._handle_match_created(self._ev()); s.commit.assert_called_once()


class TestHandleWinnerDeclared:
    def _ev(self, wt=0):
        return {"args": {"matchId": 10, "winningTeam": wt,
                         "payoutPerWinner": 95 * 10**15, "fee": 5 * 10**15}}

    def test_skip_match_not_found(self):
        c, _, _, s = _client(fns=[None])
        c._handle_winner_declared(self._ev()); s.commit.assert_not_called()

    def test_commits_with_players(self):
        mid = str(uuid.uuid4()); w = str(uuid.uuid4()); lo = str(uuid.uuid4())
        c, _, _, s = _client(fns=[(mid,)], fas=[[(w, "A"), (lo, "B")]])
        c._handle_winner_declared(self._ev(0)); s.commit.assert_called_once()


class TestMappings:
    def test_team_to_int(self):
        from src.contract.escrow_client import _TEAM_TO_INT
        assert _TEAM_TO_INT == {"A": 0, "B": 1}

    def test_int_to_team(self):
        from src.contract.escrow_client import _INT_TO_TEAM
        assert _INT_TO_TEAM == {0: "A", 1: "B"}

    def test_team_size_to_mode(self):
        from src.contract.escrow_client import _TEAM_SIZE_TO_MODE
        assert _TEAM_SIZE_TO_MODE == {1: "1v1", 2: "2v2", 4: "4v4", 5: "5v5"}

    def test_roundtrip(self):
        from src.contract.escrow_client import _TEAM_TO_INT, _INT_TO_TEAM
        for letter in ("A", "B"):
            assert _INT_TO_TEAM[_TEAM_TO_INT[letter]] == letter


class TestLoadSaveLastBlock:
    def test_load_returns_saved_value(self):
        """DB has a row → returns last_block integer."""
        c, *_ = _client(fns=[(42,)])
        assert c._load_last_block() == 42

    def test_load_returns_zero_on_empty(self):
        """DB row is None (empty table) → returns 0 (cold-start fallback)."""
        c, *_ = _client(fns=[None])
        assert c._load_last_block() == 0

    def test_load_returns_zero_on_db_error(self):
        """DB raises → returns 0, never propagates."""
        c, *_ = _client()
        c._session_factory = None  # forces AttributeError inside _load_last_block
        assert c._load_last_block() == 0

    def test_save_calls_commit(self):
        """_save_last_block() must commit the session."""
        c, _, _, s = _client()
        c._save_last_block(999)
        s.commit.assert_called_once()

    def test_save_non_fatal_on_error(self):
        """DB commit raises → no exception propagated."""
        c, _, _, s = _client()
        s.commit.side_effect = RuntimeError("db down")
        c._save_last_block(1)  # must not raise

    def test_save_passes_correct_block(self):
        """UPSERT receives the exact block number we pass."""
        import re
        c, _, _, s = _client()
        c._save_last_block(12345)
        call_args = s.execute.call_args
        params = call_args[0][1] if len(call_args[0]) > 1 else call_args[1].get("parameters", {})
        assert params.get("block") == 12345


class TestListenerStartup:
    def test_listen_resumes_from_saved_block(self):
        """When DB has last_block=50, listener starts from 51 (not from lookback)."""
        import time
        c, w3, *_ = _client(fns=[(50,)])  # _load_last_block → 50
        w3.eth.block_number = 55

        processed = []

        def fake_process(frm, to):
            processed.append((frm, to))
            return 0

        c.process_events = fake_process
        c._save_last_block = MagicMock()

        calls = []
        _orig_sleep = time.sleep

        def _one_iteration(secs):
            # Stop after the first poll by raising StopIteration
            raise StopIteration

        import unittest.mock as um
        with um.patch("time.sleep", side_effect=_one_iteration):
            try:
                c.listen(poll_interval=1, lookback_blocks=10)
            except StopIteration:
                pass

        # First poll must scan from saved_block+1 = 51, not from 55-10 = 45
        assert processed and processed[0][0] == 51

    def test_listen_cold_start_uses_lookback(self):
        """When DB returns 0, listener falls back to current_block - lookback_blocks."""
        import time, unittest.mock as um
        c, w3, *_ = _client(fns=[None])  # _load_last_block → 0
        w3.eth.block_number = 200

        processed = []
        c.process_events = lambda f, t: processed.append((f, t)) or 0
        c._save_last_block = MagicMock()

        with um.patch("time.sleep", side_effect=StopIteration):
            try:
                c.listen(poll_interval=1, lookback_blocks=50)
            except StopIteration:
                pass

        # Cold start: from = 200 - 50 = 150
        assert processed and processed[0][0] == 151  # last_block=150 → scan 151..200

    def test_listen_saves_block_after_poll(self):
        """After each poll cycle, _save_last_block is called with current_block."""
        import time, unittest.mock as um
        c, w3, *_ = _client(fns=[(10,)])
        w3.eth.block_number = 20
        c.process_events = MagicMock(return_value=0)
        c._save_last_block = MagicMock()

        with um.patch("time.sleep", side_effect=StopIteration):
            try:
                c.listen(poll_interval=1)
            except StopIteration:
                pass

        c._save_last_block.assert_called_once_with(20)


class TestAdminOracleRoutes:
    """Tests for GET /admin/oracle/status and POST /admin/oracle/sync."""

    def _auth(self):
        """Return a valid JWT token header for a test user."""
        import src.auth as auth
        token = auth.issue_token(str(__import__("uuid").uuid4()), "oracle_test@arena.gg")
        return {"Authorization": f"Bearer {token}"}

    def test_oracle_status_returns_health(self):
        """GET /admin/oracle/status returns expected shape when escrow is disabled."""
        from fastapi.testclient import TestClient
        import engine.main as main
        import sys
        # Ensure no live escrow client interferes
        original = main._escrow_client
        main._escrow_client = None
        try:
            client = TestClient(main.app, raise_server_exceptions=True)
            resp = client.get("/admin/oracle/status", headers=self._auth())
            assert resp.status_code == 200
            data = resp.json()
            assert "escrow_enabled" in data
            assert "listener_active" in data
            assert "last_block" in data
            assert data["escrow_enabled"] is False
            assert data["listener_active"] is False
        finally:
            main._escrow_client = original

    def test_oracle_sync_requires_escrow(self):
        """POST /admin/oracle/sync returns 503 when EscrowClient is not configured."""
        from fastapi.testclient import TestClient
        import engine.main as main
        original = main._escrow_client
        main._escrow_client = None
        try:
            client = TestClient(main.app, raise_server_exceptions=False)
            resp = client.post("/admin/oracle/sync", headers=self._auth())
            assert resp.status_code == 503
        finally:
            main._escrow_client = original

    def test_oracle_sync_calls_process_events(self):
        """POST /admin/oracle/sync triggers process_events and saves last_block."""
        from fastapi.testclient import TestClient
        from unittest.mock import MagicMock
        import engine.main as main

        mock_client = MagicMock()
        mock_client._w3.eth.block_number = 500
        mock_client._load_last_block.return_value = 450
        mock_client.process_events.return_value = 3

        original = main._escrow_client
        main._escrow_client = mock_client
        try:
            client = TestClient(main.app, raise_server_exceptions=True)
            resp = client.post("/admin/oracle/sync", headers=self._auth())
            assert resp.status_code == 200
            data = resp.json()
            assert data["synced"] is True
            assert data["events_processed"] == 3
            assert data["from_block"] == 451
            assert data["to_block"] == 500
            mock_client.process_events.assert_called_once_with(451, 500)
            mock_client._save_last_block.assert_called_once_with(500)
        finally:
            main._escrow_client = original
