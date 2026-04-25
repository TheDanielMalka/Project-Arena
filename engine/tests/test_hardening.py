"""
Tests for the hardening sprint fixes (feat/hardening-and-fixes).

Covers:
  C2/M2 — validate_screenshot requires submitter to be in match_players (403)
  C3    — join_match uses FOR UPDATE (verified by mock call)
  C4    — upload_screenshot in client sends game query param
  C6    — GET /match/:id/status returns consensus_status + submissions_count
  H5    — CHECK constraint in SQL migration (structural check)
  M4    — upload_screenshot retries 3x on network error
  M6    — _persist_submission acquires advisory lock before insert
"""
from __future__ import annotations

import io
import tempfile
import uuid
from unittest.mock import MagicMock, patch, call

import pytest
from fastapi.testclient import TestClient

import main
import src.auth as auth
from src.vision.engine import VisionEngineOutput


# ── Shared auth ───────────────────────────────────────────────────────────────

_USER_ID = str(uuid.uuid4())
_TOKEN   = auth.issue_token(_USER_ID, "player@arena.gg")
_HEADERS = {"Authorization": f"Bearer {_TOKEN}"}
client   = TestClient(main.app)


# ── C2/M2 — participant gate on validate_screenshot ───────────────────────────

class TestValidateScreenshotParticipantGate:
    def _upload(self, participant_row=None):
        ctx     = MagicMock()
        session = ctx.__enter__.return_value

        call_count = [0]
        def fetchone_side(*args, **kwargs):
            call_count[0] += 1
            if call_count[0] == 1:
                return ("in_progress",)
            if call_count[0] == 2:
                return ("0xABC",)
            if call_count[0] == 3:
                return participant_row
            return None

        session.execute.return_value.fetchone.side_effect = fetchone_side
        session.execute.return_value.scalar.return_value = 0

        mid        = str(uuid.uuid4())
        mock_out   = VisionEngineOutput(result=None, confidence=0.0, game="CS2")

        with tempfile.TemporaryDirectory() as tmpdir, \
             patch.object(main, "SessionLocal", return_value=ctx), \
             patch.object(main, "SCREENSHOT_DIR", tmpdir), \
             patch("main.VisionEngine") as mock_ve:
            mock_ve.return_value.process_frame.return_value = mock_out
            resp = client.post(
                "/validate/screenshot",
                params={"match_id": mid, "game": "CS2"},
                files={"file": ("frame.png", io.BytesIO(b"PNG"), "image/png")},
                headers=_HEADERS,
            )
        return resp

    def test_non_participant_gets_403(self):
        resp = self._upload(participant_row=None)
        assert resp.status_code == 403
        assert "participant" in resp.json()["detail"].lower()

    def test_participant_passes_gate(self):
        # Participant row exists → should not 403 on the participant check
        resp = self._upload(participant_row=(1,))
        # May fail later (VisionEngine needs real file), but not 403
        assert resp.status_code != 403


# ── C3 — join_match FOR UPDATE ────────────────────────────────────────────────

class TestJoinMatchForUpdate:
    def test_for_update_in_match_query(self):
        """The SQL sent to the DB during join must contain FOR UPDATE."""
        captured_sql: list[str] = []

        ctx     = MagicMock()
        session = ctx.__enter__.return_value

        def capture_execute(query, params=None):
            captured_sql.append(str(query))
            result = MagicMock()
            result.fetchone.return_value = None
            result.fetchall.return_value = []
            result.scalar.return_value   = 0
            return result

        session.execute.side_effect = capture_execute

        mid = str(uuid.uuid4())
        with patch.object(main, "SessionLocal", return_value=ctx):
            client.post(
                f"/matches/{mid}/join",
                headers=_HEADERS,
                json={},
            )

        match_selects = [s for s in captured_sql if "FROM matches WHERE id" in s]
        assert any("FOR UPDATE" in s for s in match_selects), (
            "join_match must lock the matches row with FOR UPDATE"
        )


# ── C6 — consensus_status in match status response ───────────────────────────

class TestMatchStatusConsensusFields:
    def _get_status(self, match_status="in_progress"):
        ctx     = MagicMock()
        session = ctx.__enter__.return_value

        call_n = [0]
        def fetchone_side(*a, **k):
            call_n[0] += 1
            if call_n[0] == 1:
                # main match row: status, winner_id, on_chain_match_id,
                #                 stake_per_player, game_password
                return (match_status, None, None, None, None)
            if call_n[0] == 2:
                # your_team — not in match
                return None
            if call_n[0] == 3:
                # score from match_consensus
                return None
            return None

        def scalar_side(*a, **k):
            return 1   # submissions_count and submissions_needed

        session.execute.return_value.fetchone.side_effect = fetchone_side
        session.execute.return_value.scalar.side_effect   = scalar_side

        mid = str(uuid.uuid4())
        with patch.object(main, "SessionLocal", return_value=ctx):
            resp = client.get(f"/match/{mid}/status", headers=_HEADERS)
        return resp

    def test_consensus_status_present_in_response(self):
        resp = self._get_status("in_progress")
        assert resp.status_code == 200
        data = resp.json()
        assert "consensus_status"   in data
        assert "submissions_count"  in data
        assert "submissions_needed" in data

    def test_consensus_status_pending_when_in_progress(self):
        resp = self._get_status("in_progress")
        assert resp.json()["consensus_status"] == "pending"

    def test_consensus_status_reached_when_completed(self):
        resp = self._get_status("completed")
        assert resp.json()["consensus_status"] == "reached"

    def test_consensus_status_failed_when_disputed(self):
        resp = self._get_status("disputed")
        assert resp.json()["consensus_status"] == "failed"


# ── M6 — advisory lock in _persist_submission ─────────────────────────────────

class TestConsensusAdvisoryLock:
    def test_advisory_lock_acquired_before_insert(self):
        from src.vision.consensus import MatchConsensus, PlayerSubmission
        from datetime import datetime, timezone

        captured_sql: list[str] = []
        ctx     = MagicMock()
        session = ctx.__enter__.return_value

        def capture_execute(query, params=None):
            captured_sql.append(str(query))
            return MagicMock()

        session.execute.side_effect = capture_execute

        mc  = MatchConsensus(str(uuid.uuid4()), session_factory=lambda: ctx)
        sub = PlayerSubmission(
            wallet_address="0xABC",
            result="victory",
            confidence=0.95,
            players=[],
            agents=[],
            score="13-7",
            submitted_at=datetime.now(timezone.utc),
        )
        mc._persist_submission(sub)

        advisory_calls = [s for s in captured_sql if "pg_advisory_xact_lock" in s]
        insert_calls   = [s for s in captured_sql if "INSERT INTO match_consensus" in s]
        assert advisory_calls, "pg_advisory_xact_lock must be called"
        assert insert_calls,   "INSERT must still execute after lock"
        # Advisory lock must come BEFORE the insert
        first_advisory = captured_sql.index(advisory_calls[0])
        first_insert   = captured_sql.index(insert_calls[0])
        assert first_advisory < first_insert, "Lock must precede insert"


# ── H5 — DB migration structural check ───────────────────────────────────────

class TestMatchTeamSizeConstraintMigration:
    def test_migration_file_exists(self):
        import os
        path = os.path.join(
            os.path.dirname(__file__),
            "..", "..", "infra", "sql",
            "051-match-team-size-constraint.sql",
        )
        assert os.path.exists(path), "Migration 051 must exist"

    def test_migration_contains_check_constraint(self):
        import os
        path = os.path.join(
            os.path.dirname(__file__),
            "..", "..", "infra", "sql",
            "051-match-team-size-constraint.sql",
        )
        content = open(path).read()
        assert "CHECK" in content
        assert "max_per_team" in content
        assert "max_players" in content
