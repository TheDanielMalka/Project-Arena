"""
Support ticket attachments + GET/DELETE /attachments/{id}

# TODO[GOOGLE]: POST /auth/google — implement after Client ID received
# TODO[VERIF]: Steam/Riot API call — implement after API keys in platform_config
"""
from __future__ import annotations

import os
import uuid
from io import BytesIO
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app
from main import require_admin as _require_admin
import src.auth as auth

client = TestClient(app)

_ADMIN_ID = str(uuid.uuid4())
_USER_ID = str(uuid.uuid4())
_ADMIN_TOKEN = auth.issue_token(_ADMIN_ID, "admin@arena.gg", "Admin")
_USER_TOKEN = auth.issue_token(_USER_ID, "rep@arena.gg", "Reporter")
_ADMIN_HEADERS = {"Authorization": f"Bearer {_ADMIN_TOKEN}"}
_USER_HEADERS = {"Authorization": f"Bearer {_USER_TOKEN}"}

TICKET_ID = str(uuid.uuid4())
ATTACH_ID = str(uuid.uuid4())

_MIN_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xdb\x00\x00\x00\x00IEND\xaeB`\x82"
)


@pytest.fixture
def as_admin():
    app.dependency_overrides[_require_admin] = lambda: {"sub": _ADMIN_ID, "email": "admin@arena.gg"}
    yield
    app.dependency_overrides.pop(_require_admin, None)


def _session_ctx(session: MagicMock):
    ctx = MagicMock()
    ctx.__enter__ = MagicMock(return_value=session)
    ctx.__exit__ = MagicMock(return_value=False)
    return ctx


class TestUploadAttachment:
    def test_upload_png_success(self, tmp_path, monkeypatch):
        monkeypatch.setattr("main.UPLOAD_REPORTS_DIR", str(tmp_path))
        session = MagicMock()
        session.execute.return_value.fetchone.side_effect = [
            (_USER_ID,),  # reporter
            (uuid.uuid4(),),  # RETURNING id
        ]
        with patch("main.SessionLocal", return_value=_session_ctx(session)):
            r = client.post(
                f"/support/tickets/{TICKET_ID}/attachments",
                headers=_USER_HEADERS,
                files={"file": ("shot.png", BytesIO(_MIN_PNG), "image/png")},
            )
        assert r.status_code == 201
        data = r.json()
        assert data.get("ticket_id") == TICKET_ID
        assert data.get("content_type") == "image/png"

    def test_upload_rejects_large_file(self, tmp_path, monkeypatch):
        monkeypatch.setattr("main.UPLOAD_REPORTS_DIR", str(tmp_path))
        big = b"x" * (10 * 1024 * 1024 + 1)
        r = client.post(
            f"/support/tickets/{TICKET_ID}/attachments",
            headers=_USER_HEADERS,
            files={"file": ("big.png", BytesIO(big), "image/png")},
        )
        assert r.status_code == 400
        assert "large" in r.json()["detail"].lower()

    def test_upload_rejects_invalid_type(self, tmp_path, monkeypatch):
        monkeypatch.setattr("main.UPLOAD_REPORTS_DIR", str(tmp_path))
        r = client.post(
            f"/support/tickets/{TICKET_ID}/attachments",
            headers=_USER_HEADERS,
            files={"file": ("malware.exe", BytesIO(b"MZ\x90\x00"), "application/octet-stream")},
        )
        assert r.status_code == 400


class TestServeAttachment:
    def test_serve_attachment_returns_image_bytes(self, tmp_path, monkeypatch):
        monkeypatch.setattr("main.UPLOAD_REPORTS_DIR", str(tmp_path))
        fname = "f1.png"
        abs_fp = os.path.join(str(tmp_path), fname)
        with open(abs_fp, "wb") as f:
            f.write(_MIN_PNG)

        session = MagicMock()

        def _exec(*args, **kwargs):
            stmt = str(args[0]) if args else ""
            m = MagicMock()
            if "user_roles" in stmt and "admin" in stmt:
                m.fetchone.return_value = (1,)
            elif "report_attachments ra" in stmt:
                m.fetchone.return_value = (abs_fp, "image/png", "f1.png", _USER_ID)
            else:
                m.fetchone.return_value = None
            return m

        session.execute.side_effect = _exec
        with patch("main.SessionLocal", return_value=_session_ctx(session)):
            r = client.get(f"/attachments/{ATTACH_ID}", headers=_ADMIN_HEADERS)
        assert r.status_code == 200
        assert r.content.startswith(b"\x89PNG")


class TestDeleteAttachment:
    def test_delete_attachment_admin_only(self, tmp_path, monkeypatch):
        monkeypatch.setattr("main.UPLOAD_REPORTS_DIR", str(tmp_path))
        r = client.request(
            "DELETE",
            f"/attachments/{ATTACH_ID}",
            headers=_USER_HEADERS,
        )
        assert r.status_code == 403

    def test_delete_attachment_admin_ok(self, tmp_path, monkeypatch, as_admin):
        monkeypatch.setattr("main.UPLOAD_REPORTS_DIR", str(tmp_path))
        fname = "del.png"
        abs_fp = os.path.join(str(tmp_path), fname)
        with open(abs_fp, "wb") as f:
            f.write(_MIN_PNG)

        session = MagicMock()
        session.execute.return_value.fetchone.return_value = (abs_fp,)
        with patch("main.SessionLocal", return_value=_session_ctx(session)):
            r = client.request(
                "DELETE",
                f"/attachments/{ATTACH_ID}",
                headers=_ADMIN_HEADERS,
            )
        assert r.status_code == 200
        assert not os.path.isfile(abs_fp)


class TestCascadeOnTicketClose:
    def test_cascade_delete_on_ticket_close_calls_cleanup(self, tmp_path, monkeypatch, as_admin):
        """resolved/dismissed triggers _cleanup_report_attachments_for_ticket (DB + disk)."""
        monkeypatch.setattr("main.UPLOAD_REPORTS_DIR", str(tmp_path))
        dead = os.path.join(str(tmp_path), "gone.png")
        with open(dead, "wb") as f:
            f.write(_MIN_PNG)

        def _exec(*args, **kwargs):
            stmt = str(args[0]) if args else ""
            m = MagicMock()
            if "SELECT status FROM support_tickets" in stmt:
                m.fetchone.return_value = ("open",)
            elif "SELECT file_path FROM report_attachments" in stmt:
                m.fetchall.return_value = [(dead,)]
            else:
                m.fetchone.return_value = None
                m.fetchall.return_value = []
            return m

        session = MagicMock()
        session.execute.side_effect = _exec
        with patch("main.SessionLocal", return_value=_session_ctx(session)):
            r = client.patch(
                f"/admin/support/tickets/{TICKET_ID}",
                json={"status": "resolved"},
                headers=_ADMIN_HEADERS,
            )
        assert r.status_code == 200
        texts = [str(c.args[0]) for c in session.execute.call_args_list if c.args]
        assert any("DELETE FROM report_attachments" in t for t in texts)
        assert not os.path.isfile(dead), "attachment file should be removed from filesystem"
