"""
Arena — transactional email via Resend REST API.

All functions are synchronous (safe to run via asyncio.to_thread).
If RESEND_API_KEY is empty every function is a no-op that returns False.
"""
from __future__ import annotations

import logging

import httpx

from src.config import EMAIL_FROM, ENGINE_BASE_URL, FRONTEND_URL, RESEND_API_KEY

logger = logging.getLogger(__name__)

_RESEND_URL = "https://api.resend.com/emails"


def _send(to: str, subject: str, html: str) -> bool:
    if not RESEND_API_KEY:
        logger.warning("Email not sent (RESEND_API_KEY not configured): %s", subject)
        return False
    try:
        r = httpx.post(
            _RESEND_URL,
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json={"from": EMAIL_FROM, "to": to, "subject": subject, "html": html},
            timeout=10.0,
        )
        if r.status_code not in (200, 201):
            logger.error("Resend error %s: %s", r.status_code, r.text[:200])
            return False
        return True
    except Exception as exc:
        logger.error("Resend send failed: %s", exc)
        return False


def send_verification_email(to_email: str, username: str, token: str) -> bool:
    verify_url = f"{ENGINE_BASE_URL}/auth/verify-email?token={token}"
    html = f"""
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a0f;font-family:sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0">
  <tr><td align="center" style="padding:40px 20px;">
    <table width="480" cellpadding="0" cellspacing="0"
           style="background:#111827;border:1px solid #1f2937;border-radius:12px;overflow:hidden;">
      <tr><td style="background:#D32936;padding:24px 32px;text-align:center;">
        <span style="color:#fff;font-size:22px;font-weight:700;letter-spacing:2px;">⚔ ARENA</span>
      </td></tr>
      <tr><td style="padding:32px;">
        <p style="color:#f9fafb;font-size:18px;font-weight:600;margin:0 0 8px;">
          Verify your Arena account
        </p>
        <p style="color:#9ca3af;font-size:14px;margin:0 0 24px;">
          Hi {username}, one click and you're in.
        </p>
        <table width="100%"><tr><td align="center">
          <a href="{verify_url}"
             style="display:inline-block;background:#D32936;color:#fff;
                    font-size:15px;font-weight:700;padding:14px 36px;
                    border-radius:8px;text-decoration:none;letter-spacing:1px;">
            VERIFY EMAIL
          </a>
        </td></tr></table>
        <p style="color:#6b7280;font-size:12px;margin:24px 0 0;text-align:center;">
          Link expires in 24 hours. If you didn't create an Arena account, ignore this email.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>
"""
    return _send(to_email, "Verify your Arena account", html)


def send_password_reset_email(to_email: str, username: str, token: str) -> bool:
    reset_url = f"{FRONTEND_URL}/auth?reset_token={token}"
    html = f"""
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a0f;font-family:sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0">
  <tr><td align="center" style="padding:40px 20px;">
    <table width="480" cellpadding="0" cellspacing="0"
           style="background:#111827;border:1px solid #1f2937;border-radius:12px;overflow:hidden;">
      <tr><td style="background:#f59e0b;padding:24px 32px;text-align:center;">
        <span style="color:#fff;font-size:22px;font-weight:700;letter-spacing:2px;">⚔ ARENA</span>
      </td></tr>
      <tr><td style="padding:32px;">
        <p style="color:#f9fafb;font-size:18px;font-weight:600;margin:0 0 8px;">
          Reset your password
        </p>
        <p style="color:#9ca3af;font-size:14px;margin:0 0 24px;">
          Hi {username}, click below to set a new password for your Arena account.
        </p>
        <table width="100%"><tr><td align="center">
          <a href="{reset_url}"
             style="display:inline-block;background:#f59e0b;color:#fff;
                    font-size:15px;font-weight:700;padding:14px 36px;
                    border-radius:8px;text-decoration:none;letter-spacing:1px;">
            RESET PASSWORD
          </a>
        </td></tr></table>
        <p style="color:#6b7280;font-size:12px;margin:24px 0 0;text-align:center;">
          Link expires in 1 hour. If you didn't request this, ignore this email — your password won't change.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>
"""
    return _send(to_email, "Reset your Arena password", html)


def send_email_change_email(to_email: str, username: str, token: str) -> bool:
    verify_url = f"{ENGINE_BASE_URL}/auth/verify-email-change?token={token}"
    html = f"""
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a0f;font-family:sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0">
  <tr><td align="center" style="padding:40px 20px;">
    <table width="480" cellpadding="0" cellspacing="0"
           style="background:#111827;border:1px solid #1f2937;border-radius:12px;overflow:hidden;">
      <tr><td style="background:#06b6d4;padding:24px 32px;text-align:center;">
        <span style="color:#fff;font-size:22px;font-weight:700;letter-spacing:2px;">⚔ ARENA</span>
      </td></tr>
      <tr><td style="padding:32px;">
        <p style="color:#f9fafb;font-size:18px;font-weight:600;margin:0 0 8px;">
          Confirm your new email address
        </p>
        <p style="color:#9ca3af;font-size:14px;margin:0 0 24px;">
          Hi {username}, click below to confirm <strong style="color:#f9fafb;">{to_email}</strong>
          as your new Arena email. Your email won't change until you click this link.
        </p>
        <table width="100%"><tr><td align="center">
          <a href="{verify_url}"
             style="display:inline-block;background:#06b6d4;color:#fff;
                    font-size:15px;font-weight:700;padding:14px 36px;
                    border-radius:8px;text-decoration:none;letter-spacing:1px;">
            CONFIRM NEW EMAIL
          </a>
        </td></tr></table>
        <p style="color:#6b7280;font-size:12px;margin:24px 0 0;text-align:center;">
          Link expires in 24 hours. If you didn't request this change, ignore this email — your current address stays active.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>
"""
    return _send(to_email, "Confirm your new Arena email address", html)
