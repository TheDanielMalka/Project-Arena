"""
Arena Forum — FastAPI router.

Mounted at /forum in main.py.
All writes require a valid Bearer token (via _require_user).
Read endpoints are public (no auth required).

Rate limits (enforced via simple in-memory counters per user):
  - POST /forum/threads       → 3 threads / hour
  - POST /forum/threads/{id}/posts → 30 posts / hour
"""
from __future__ import annotations

import hashlib
import re
import time
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, field_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

router = APIRouter(prefix="/forum", tags=["forum"])

_bearer = HTTPBearer(auto_error=False)

# ── Rate-limit buckets (per user_id, reset every hour) ───────────────────────
_rl_threads: dict[str, list[float]] = defaultdict(list)
_rl_posts:   dict[str, list[float]] = defaultdict(list)
_THREAD_LIMIT = 3
_POST_LIMIT   = 30
_RL_WINDOW    = 3600.0

def _rl_check(bucket: dict[str, list[float]], uid: str, limit: int) -> None:
    now = time.time()
    bucket[uid] = [t for t in bucket[uid] if now - t < _RL_WINDOW]
    if len(bucket[uid]) >= limit:
        raise HTTPException(429, "Rate limit exceeded — slow down")
    bucket[uid].append(now)

# ── Auth helpers ──────────────────────────────────────────────────────────────

def _require_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    """Validate Bearer token; return {user_id, email, username}.
    Also blocks banned/suspended users from posting.
    """
    if not creds:
        raise HTTPException(401, "Authentication required")
    import src.auth as _auth
    payload = _auth.verify_token(creds.credentials)
    if not payload:
        raise HTTPException(401, "Invalid or expired token")
    # Block banned / suspended accounts from writing
    with _get_db() as session:
        row = session.execute(
            text("SELECT status FROM users WHERE id = :uid"),
            {"uid": payload["user_id"]},
        ).fetchone()
    if row and row[0] in ("banned", "suspended"):
        raise HTTPException(403, f"Account is {row[0]}. Forum access restricted.")
    return payload


def _get_db() -> Session:
    from main import SessionLocal  # noqa: PLC0415
    return SessionLocal()


def _is_admin(session: Session, user_id: str) -> bool:
    row = session.execute(
        text("SELECT 1 FROM user_roles WHERE user_id = :uid AND role IN ('admin','moderator')"),
        {"uid": user_id},
    ).fetchone()
    return row is not None


def _is_forum_mod(session: Session, user_id: str, category_id: str | None = None) -> bool:
    """Global mod (category_id IS NULL) or mod for this specific category."""
    if _is_admin(session, user_id):
        return True
    row = session.execute(
        text("""
            SELECT 1 FROM forum_moderators
            WHERE user_id = :uid
              AND (category_id IS NULL OR category_id = :cid)
        """),
        {"uid": user_id, "cid": category_id},
    ).fetchone()
    return row is not None


def _user_card(session: Session, user_id: str | None) -> dict:
    """Return minimal public user data for forum display."""
    if not user_id:
        return {"id": None, "username": "[deleted]", "avatar": None, "avatar_bg": None,
                "arena_id": None, "rank": None, "created_at": None,
                "forum_post_count": 0, "role": "user", "forum_signature": None, "forum_badge": None}
    row = session.execute(
        text("""
            SELECT u.id, u.username, u.avatar, u.avatar_bg, u.arena_id, u.rank,
                   u.created_at, u.forum_signature, u.forum_badge,
                   (SELECT COUNT(*) FROM forum_posts fp WHERE fp.author_id = u.id AND NOT fp.is_deleted) AS post_count,
                   COALESCE((SELECT role FROM user_roles WHERE user_id = u.id
                              ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END LIMIT 1), 'user') AS role
            FROM users u WHERE u.id = :uid
        """),
        {"uid": user_id},
    ).fetchone()
    if not row:
        return {"id": user_id, "username": "[deleted]", "avatar": None, "avatar_bg": None,
                "arena_id": None, "rank": None, "created_at": None,
                "forum_post_count": 0, "role": "user", "forum_signature": None, "forum_badge": None}
    return {
        "id":               str(row[0]),
        "username":         row[1],
        "avatar":           row[2],
        "avatar_bg":        row[3],
        "arena_id":         row[4],
        "rank":             row[5],
        "member_since":     row[6].isoformat() if row[6] else None,
        "forum_post_count": int(row[9] or 0),
        "role":             row[10],
        "forum_signature":  row[7],
        "forum_badge":      row[8],
    }


def _slugify(text_: str) -> str:
    s = text_.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"-+", "-", s)
    return s[:200]


def _unique_slug(session: Session, base: str) -> str:
    slug = _slugify(base)
    candidate = slug
    for i in range(1, 100):
        row = session.execute(
            text("SELECT 1 FROM forum_threads WHERE slug = :s"), {"s": candidate}
        ).fetchone()
        if not row:
            return candidate
        candidate = f"{slug}-{i}"
    return f"{slug}-{int(time.time())}"

# ── Pydantic models ───────────────────────────────────────────────────────────

class ThreadCreate(BaseModel):
    category_id: str
    title: str
    body: str
    tags: list[str] = []

    @field_validator("title")
    @classmethod
    def title_len(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 300:
            raise ValueError("Title must be 1–300 characters")
        return v

    @field_validator("body")
    @classmethod
    def body_len(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 20000:
            raise ValueError("Body must be 1–20 000 characters")
        return v


class ThreadPatch(BaseModel):
    title: str | None = None
    body:  str | None = None
    tags:  list[str] | None = None


class PostCreate(BaseModel):
    body: str
    parent_post_id: str | None = None

    @field_validator("body")
    @classmethod
    def body_len(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 20000:
            raise ValueError("Body must be 1–20 000 characters")
        return v


class PostPatch(BaseModel):
    body: str

    @field_validator("body")
    @classmethod
    def body_len(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 20000:
            raise ValueError("Body must be 1–20 000 characters")
        return v


class ReactionBody(BaseModel):
    emoji: str

    @field_validator("emoji")
    @classmethod
    def allowed(cls, v: str) -> str:
        if v not in ("👍", "❤️", "😂", "😮", "🔥", "👀"):
            raise ValueError("Unsupported reaction")
        return v


class ModeratorGrant(BaseModel):
    user_id: str
    category_id: str | None = None


class ProfilePatch(BaseModel):
    forum_signature: str | None = None
    forum_badge: str | None = None

    @field_validator("forum_signature")
    @classmethod
    def sig_len(cls, v: str | None) -> str | None:
        if v and len(v) > 200:
            raise ValueError("Signature max 200 chars")
        return v


class ReportBody(BaseModel):
    reason: str

    @field_validator("reason")
    @classmethod
    def reason_len(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 200:
            raise ValueError("Reason must be 1–200 characters")
        return v

# ── Categories ────────────────────────────────────────────────────────────────

@router.get("/categories")
def get_categories() -> Any:
    """Full category tree for the forum homepage."""
    with _get_db() as session:
        rows = session.execute(text("""
            SELECT c.id, c.parent_id, c.slug, c.name, c.description,
                   c.icon, c.color, c.sort_order, c.post_count, c.thread_count,
                   c.last_post_at, c.is_announcements,
                   u.username AS last_poster
            FROM forum_categories c
            LEFT JOIN users u ON u.id = c.last_post_user_id
            ORDER BY c.parent_id NULLS FIRST, c.sort_order
        """)).fetchall()

    cats: dict[str, dict] = {}
    tops: list[dict] = []
    for r in rows:
        cat = {
            "id":              str(r[0]),
            "parent_id":       str(r[1]) if r[1] else None,
            "slug":            r[2],
            "name":            r[3],
            "description":     r[4],
            "icon":            r[5],
            "color":           r[6],
            "sort_order":      r[7],
            "post_count":      r[8],
            "thread_count":    r[9],
            "last_post_at":    r[10].isoformat() if r[10] else None,
            "is_announcements":r[11],
            "last_poster":     r[12],
            "children":        [],
        }
        cats[cat["id"]] = cat
        if not cat["parent_id"]:
            tops.append(cat)
        else:
            parent = cats.get(cat["parent_id"])
            if parent:
                parent["children"].append(cat)
    return {"categories": tops}


@router.get("/categories/{slug}")
def get_category(slug: str) -> Any:
    with _get_db() as session:
        row = session.execute(
            text("SELECT id, name, description, color, icon FROM forum_categories WHERE slug = :s"),
            {"s": slug},
        ).fetchone()
        if not row:
            raise HTTPException(404, "Category not found")
        cat_id = str(row[0])
        threads = session.execute(text("""
            SELECT t.id, t.title, t.slug, t.status, t.is_pinned, t.is_announcement,
                   t.views, t.reply_count, t.last_reply_at, t.tags, t.created_at,
                   u.username, u.avatar, u.arena_id,
                   lu.username AS last_reply_username,
                   t.category_id, c.slug AS category_slug, c.name AS category_name
            FROM forum_threads t
            JOIN users u ON u.id = t.author_id
            LEFT JOIN users lu ON lu.id = t.last_reply_user_id
            LEFT JOIN forum_categories c ON c.id = t.category_id
            WHERE t.category_id = :cid AND t.status != 'deleted'
            ORDER BY t.is_pinned DESC, COALESCE(t.last_reply_at, t.created_at) DESC
            LIMIT 50
        """), {"cid": cat_id}).fetchall()

    return {
        "category": {"id": cat_id, "name": row[1], "description": row[2], "color": row[3], "icon": row[4]},
        "threads": [_fmt_thread(t) for t in threads],
    }

# ── Threads ───────────────────────────────────────────────────────────────────

def _fmt_thread(r: Any) -> dict:
    # r[0..14] = id, title, slug, status, is_pinned, is_announcement,
    #             views, reply_count, last_reply_at, tags, created_at,
    #             u.username, u.avatar, u.arena_id, lu.username,
    # r[15..17] = t.category_id, c.slug, c.name  (added in queries below)
    return {
        "id":              str(r[0]),
        "title":           r[1],
        "slug":            r[2],
        "status":          r[3],
        "is_pinned":       bool(r[4]),
        "is_locked":       False,
        "is_announcement": bool(r[5]),
        "view_count":      r[6],
        "reply_count":     r[7],
        "last_post_at":    r[8].isoformat() if r[8] else None,
        "tags":            list(r[9] or []),
        "created_at":      r[10].isoformat(),
        "author": {
            "id":               None,
            "username":         r[11],
            "avatar":           r[12],
            "avatar_bg":        None,
            "arena_id":         r[13],
            "rank":             None,
            "member_since":     None,
            "forum_post_count": 0,
            "role":             "user",
            "forum_signature":  None,
            "forum_badge":      None,
        },
        "last_reply_by":   r[14],
        "category_id":     str(r[15]) if len(r) > 15 and r[15] else "",
        "category_slug":   r[16] if len(r) > 16 and r[16] else "",
        "category_name":   r[17] if len(r) > 17 and r[17] else "",
    }


@router.get("/threads")
def list_threads(
    category: str | None = Query(None),
    page: int = Query(1, ge=1),
    sort: str = Query("latest"),
) -> Any:
    offset = (page - 1) * 30
    order = {
        "latest": "COALESCE(t.last_reply_at, t.created_at) DESC",
        "hot":    "t.reply_count DESC",
        "pinned": "t.is_pinned DESC, t.created_at DESC",
    }.get(sort, "COALESCE(t.last_reply_at, t.created_at) DESC")

    with _get_db() as session:
        if category:
            cat_row = session.execute(
                text("SELECT id FROM forum_categories WHERE slug = :s"), {"s": category}
            ).fetchone()
            if not cat_row:
                raise HTTPException(404, "Category not found")
            where = "t.category_id = :cid AND"
            params: dict = {"cid": str(cat_row[0]), "limit": 30, "offset": offset}
            count_row = session.execute(
                text("SELECT COUNT(*) FROM forum_threads WHERE category_id = :cid AND status != 'deleted'"),
                {"cid": str(cat_row[0])},
            ).fetchone()
        else:
            where = ""
            params = {"limit": 30, "offset": offset}
            count_row = session.execute(
                text("SELECT COUNT(*) FROM forum_threads WHERE status != 'deleted'")
            ).fetchone()

        total = int(count_row[0]) if count_row else 0
        pages = max(1, (total + 29) // 30)

        rows = session.execute(text(f"""
            SELECT t.id, t.title, t.slug, t.status, t.is_pinned, t.is_announcement,
                   t.views, t.reply_count, t.last_reply_at, t.tags, t.created_at,
                   u.username, u.avatar, u.arena_id,
                   lu.username AS last_reply_username,
                   t.category_id, c.slug AS category_slug, c.name AS category_name
            FROM forum_threads t
            JOIN users u ON u.id = t.author_id
            LEFT JOIN users lu ON lu.id = t.last_reply_user_id
            LEFT JOIN forum_categories c ON c.id = t.category_id
            WHERE {where} t.status != 'deleted'
            ORDER BY {order}
            LIMIT :limit OFFSET :offset
        """), params).fetchall()

    return {"threads": [_fmt_thread(r) for r in rows], "total": total, "pages": pages, "page": page}


def _fmt_post(p: Any, card: dict, thread_id: str, post_number: int) -> dict:
    return {
        "id":             str(p[0]),
        "thread_id":      thread_id,
        "author":         card,
        "parent_post_id": str(p[2]) if p[2] else None,
        "body":           "[deleted]" if p[4] else p[3],
        "is_deleted":     bool(p[4]),
        "edit_count":     p[5] or 0,
        "updated_at":     p[6].isoformat() if p[6] else p[8].isoformat(),
        "reactions":      dict(p[7] or {}),
        "created_at":     p[8].isoformat(),
        "post_number":    post_number,
    }


@router.get("/threads/{thread_id}/posts")
def get_thread_posts(thread_id: str, page: int = Query(1, ge=1)) -> Any:
    """Paginated posts for a thread (called with thread UUID)."""
    offset = (page - 1) * 20
    with _get_db() as session:
        total_row = session.execute(
            text("SELECT COUNT(*) FROM forum_posts WHERE thread_id = :tid"),
            {"tid": thread_id},
        ).fetchone()
        total = int(total_row[0]) if total_row else 0
        pages = max(1, (total + 19) // 20)

        rows = session.execute(text("""
            SELECT p.id, p.author_id, p.parent_post_id, p.body, p.is_deleted,
                   p.edit_count, p.edited_at, p.reactions, p.created_at,
                   ROW_NUMBER() OVER (ORDER BY p.created_at ASC) AS post_number
            FROM forum_posts p
            WHERE p.thread_id = :tid
            ORDER BY p.created_at ASC
            LIMIT 20 OFFSET :offset
        """), {"tid": thread_id, "offset": offset}).fetchall()

        post_list = []
        for p in rows:
            card = _user_card(session, str(p[1]) if p[1] else None)
            post_list.append(_fmt_post(p, card, thread_id, int(p[9])))

    return {"posts": post_list, "total": total, "pages": pages}


@router.get("/threads/{thread_slug}")
def get_thread(thread_slug: str) -> Any:
    """Fetch a single thread by slug (or UUID). Returns ForumThreadDetail."""
    import uuid as _uuid
    try:
        _uuid.UUID(thread_slug)
        where_clause = "t.id = :val"
    except ValueError:
        where_clause = "t.slug = :val"

    with _get_db() as session:
        t = session.execute(text(f"""
            SELECT t.id, t.category_id, t.author_id, t.title, t.body, t.slug,
                   t.status, t.is_pinned, t.is_announcement, t.views, t.reply_count,
                   t.tags, t.created_at, t.last_reply_at,
                   c.slug AS category_slug, c.name AS category_name
            FROM forum_threads t
            LEFT JOIN forum_categories c ON c.id = t.category_id
            WHERE {where_clause} AND t.status != 'deleted'
        """), {"val": thread_slug}).fetchone()
        if not t:
            raise HTTPException(404, "Thread not found")

        thread_id = str(t[0])
        session.execute(
            text("UPDATE forum_threads SET views = views + 1 WHERE id = :id"),
            {"id": thread_id},
        )
        session.commit()

        first_post_row = session.execute(text("""
            SELECT p.id, p.author_id, p.parent_post_id, p.body, p.is_deleted,
                   p.edit_count, p.edited_at, p.reactions, p.created_at
            FROM forum_posts p
            WHERE p.thread_id = :tid
            ORDER BY p.created_at ASC
            LIMIT 1
        """), {"tid": thread_id}).fetchone()

        author_card = _user_card(session, str(t[2]))
        first_post = None
        if first_post_row:
            fp_card = _user_card(session, str(first_post_row[1]) if first_post_row[1] else None)
            first_post = _fmt_post(first_post_row, fp_card, thread_id, 1)

    return {
        "id":              thread_id,
        "category_id":     str(t[1]),
        "category_slug":   t[14] or "",
        "category_name":   t[15] or "",
        "title":           t[3],
        "body":            t[4],
        "slug":            t[5],
        "status":          t[6],
        "is_pinned":       bool(t[7]),
        "is_locked":       t[6] == "locked",
        "is_announcement": bool(t[8]),
        "view_count":      (t[9] or 0) + 1,
        "reply_count":     t[10] or 0,
        "tags":            list(t[11] or []),
        "created_at":      t[12].isoformat(),
        "last_post_at":    t[13].isoformat() if t[13] else None,
        "author":          author_card,
        "first_post":      first_post,
    }


@router.post("/threads", status_code=201)
def create_thread(body: ThreadCreate, user: dict = Depends(_require_user)) -> Any:
    uid = user["user_id"]
    _rl_check(_rl_threads, uid, _THREAD_LIMIT)

    with _get_db() as session:
        cat = session.execute(
            text("SELECT id, is_announcements FROM forum_categories WHERE id = :id"),
            {"id": body.category_id},
        ).fetchone()
        if not cat:
            raise HTTPException(404, "Category not found")
        if cat[1] and not _is_forum_mod(session, uid, body.category_id):
            raise HTTPException(403, "Only moderators can post in Announcements")

        slug = _unique_slug(session, body.title)
        row = session.execute(text("""
            INSERT INTO forum_threads (category_id, author_id, title, body, slug, tags)
            VALUES (:cid, :uid, :title, :body, :slug, :tags)
            RETURNING id, slug
        """), {
            "cid":   body.category_id,
            "uid":   uid,
            "title": body.title,
            "body":  body.body,
            "slug":  slug,
            "tags":  body.tags,
        }).fetchone()
        session.execute(text("""
            UPDATE forum_categories
            SET thread_count = thread_count + 1,
                last_post_at = NOW(), last_post_user_id = :uid
            WHERE id = :cid
        """), {"uid": uid, "cid": body.category_id})
        session.commit()

    return {"id": str(row[0]), "slug": row[1]}


@router.patch("/threads/{thread_id}")
def patch_thread(thread_id: str, body: ThreadPatch, user: dict = Depends(_require_user)) -> Any:
    uid = user["user_id"]
    with _get_db() as session:
        t = session.execute(
            text("SELECT author_id, category_id, status FROM forum_threads WHERE id = :id"),
            {"id": thread_id},
        ).fetchone()
        if not t:
            raise HTTPException(404, "Thread not found")
        if t[2] == "deleted":
            raise HTTPException(404, "Thread not found")
        is_author = str(t[0]) == uid
        if not is_author and not _is_forum_mod(session, uid, str(t[1])):
            raise HTTPException(403, "Not allowed")

        updates: dict[str, Any] = {}
        if body.title is not None:
            updates["title"] = body.title
        if body.body is not None:
            updates["body"] = body.body
        if body.tags is not None:
            updates["tags"] = body.tags
        if not updates:
            return {"ok": True}

        set_clause = ", ".join(f"{k} = :{k}" for k in updates)
        updates["id"] = thread_id
        session.execute(text(f"UPDATE forum_threads SET {set_clause} WHERE id = :id"), updates)
        session.commit()
    return {"ok": True}


@router.post("/threads/{thread_id}/pin")
def pin_thread(thread_id: str, user: dict = Depends(_require_user)) -> Any:
    uid = user["user_id"]
    with _get_db() as session:
        t = session.execute(
            text("SELECT category_id, is_pinned FROM forum_threads WHERE id = :id"),
            {"id": thread_id},
        ).fetchone()
        if not t:
            raise HTTPException(404, "Thread not found")
        if not _is_forum_mod(session, uid, str(t[0])):
            raise HTTPException(403, "Moderators only")
        session.execute(
            text("UPDATE forum_threads SET is_pinned = NOT is_pinned WHERE id = :id"),
            {"id": thread_id},
        )
        session.commit()
    return {"ok": True, "is_pinned": not t[1]}


@router.post("/threads/{thread_id}/lock")
def lock_thread(thread_id: str, user: dict = Depends(_require_user)) -> Any:
    uid = user["user_id"]
    with _get_db() as session:
        t = session.execute(
            text("SELECT category_id, status FROM forum_threads WHERE id = :id"),
            {"id": thread_id},
        ).fetchone()
        if not t:
            raise HTTPException(404, "Thread not found")
        if not _is_forum_mod(session, uid, str(t[0])):
            raise HTTPException(403, "Moderators only")
        new_status = "open" if t[1] == "locked" else "locked"
        session.execute(
            text("UPDATE forum_threads SET status = :s WHERE id = :id"),
            {"s": new_status, "id": thread_id},
        )
        session.commit()
    return {"ok": True, "status": new_status}


@router.delete("/threads/{thread_id}")
def delete_thread(thread_id: str, user: dict = Depends(_require_user)) -> Any:
    uid = user["user_id"]
    with _get_db() as session:
        t = session.execute(
            text("SELECT author_id, category_id FROM forum_threads WHERE id = :id"),
            {"id": thread_id},
        ).fetchone()
        if not t:
            raise HTTPException(404, "Thread not found")
        if str(t[0]) != uid and not _is_forum_mod(session, uid, str(t[1])):
            raise HTTPException(403, "Not allowed")
        session.execute(
            text("UPDATE forum_threads SET status = 'deleted' WHERE id = :id"),
            {"id": thread_id},
        )
        session.commit()
    return {"ok": True}

# ── Posts ─────────────────────────────────────────────────────────────────────

@router.post("/threads/{thread_id}/posts", status_code=201)
def create_post(thread_id: str, body: PostCreate, user: dict = Depends(_require_user)) -> Any:
    uid = user["user_id"]
    _rl_check(_rl_posts, uid, _POST_LIMIT)

    with _get_db() as session:
        t = session.execute(
            text("SELECT status, category_id FROM forum_threads WHERE id = :id"),
            {"id": thread_id},
        ).fetchone()
        if not t:
            raise HTTPException(404, "Thread not found")
        if t[0] == "locked":
            raise HTTPException(403, "Thread is locked")
        if t[0] == "deleted":
            raise HTTPException(404, "Thread not found")

        row = session.execute(text("""
            INSERT INTO forum_posts (thread_id, author_id, parent_post_id, body)
            VALUES (:tid, :uid, :ppid, :body)
            RETURNING id, created_at
        """), {
            "tid":  thread_id,
            "uid":  uid,
            "ppid": body.parent_post_id,
            "body": body.body,
        }).fetchone()

        session.execute(text("""
            UPDATE forum_threads
            SET reply_count = reply_count + 1,
                last_reply_at = NOW(), last_reply_user_id = :uid
            WHERE id = :tid
        """), {"uid": uid, "tid": thread_id})
        session.execute(text("""
            UPDATE forum_categories
            SET post_count = post_count + 1,
                last_post_at = NOW(), last_post_user_id = :uid
            WHERE id = :cid
        """), {"uid": uid, "cid": str(t[1])})

        import json as _json

        # Notify thread author of reply (skip self-reply)
        thread_meta = session.execute(
            text("SELECT author_id, title, slug FROM forum_threads WHERE id = :id"),
            {"id": thread_id},
        ).fetchone()
        if thread_meta and str(thread_meta[0]) != uid:
            session.execute(text("""
                INSERT INTO notifications (user_id, type, title, message, metadata)
                VALUES (:uid, 'forum_reply', :title, :msg, :meta::jsonb)
            """), {
                "uid":   str(thread_meta[0]),
                "title": "New reply to your thread",
                "msg":   f'Someone replied to "{thread_meta[1]}"',
                "meta":  _json.dumps({"thread_id": thread_id, "slug": thread_meta[2], "post_id": str(row[0])}),
            })

        # Notify @mentioned users (depth-1, skip self)
        mentions = set(re.findall(r"@([\w\-]{2,32})", body.body))
        for username in mentions:
            mentioned = session.execute(
                text("SELECT id FROM users WHERE username = :u"), {"u": username}
            ).fetchone()
            if mentioned and str(mentioned[0]) != uid:
                session.execute(text("""
                    INSERT INTO notifications (user_id, type, title, message, metadata)
                    VALUES (:uid, 'forum_mention', :title, :msg, :meta::jsonb)
                    ON CONFLICT DO NOTHING
                """), {
                    "uid":   str(mentioned[0]),
                    "title": "You were mentioned in a forum post",
                    "msg":   f'@{user["username"]} mentioned you in "{thread_meta[1] if thread_meta else "a thread"}"',
                    "meta":  _json.dumps({"thread_id": thread_id, "post_id": str(row[0])}),
                })

        session.commit()
        card = _user_card(session, uid)

    return {
        "id":         str(row[0]),
        "created_at": row[1].isoformat(),
        "author":     card,
    }


@router.patch("/posts/{post_id}")
def patch_post(post_id: str, body: PostPatch, user: dict = Depends(_require_user)) -> Any:
    uid = user["user_id"]
    with _get_db() as session:
        p = session.execute(
            text("SELECT author_id, created_at, thread_id FROM forum_posts WHERE id = :id"),
            {"id": post_id},
        ).fetchone()
        if not p or p[2] is None:
            raise HTTPException(404, "Post not found")

        is_author = str(p[0]) == uid
        age_ok = (datetime.now(timezone.utc) - p[1].replace(tzinfo=timezone.utc)) < timedelta(minutes=15)

        t = session.execute(
            text("SELECT category_id FROM forum_threads WHERE id = :tid"), {"tid": str(p[2])}
        ).fetchone()
        cat_id = str(t[0]) if t else None

        if is_author and age_ok:
            pass  # allowed
        elif _is_forum_mod(session, uid, cat_id):
            pass  # mod can edit any post
        else:
            raise HTTPException(403, "Cannot edit this post (15-minute window expired or not the author)")

        session.execute(text("""
            UPDATE forum_posts
            SET body = :body, edit_count = edit_count + 1, edited_at = NOW()
            WHERE id = :id
        """), {"body": body.body, "id": post_id})
        session.commit()
    return {"ok": True}


@router.delete("/posts/{post_id}")
def delete_post(post_id: str, user: dict = Depends(_require_user)) -> Any:
    uid = user["user_id"]
    with _get_db() as session:
        p = session.execute(
            text("SELECT author_id, thread_id FROM forum_posts WHERE id = :id"),
            {"id": post_id},
        ).fetchone()
        if not p:
            raise HTTPException(404, "Post not found")
        t = session.execute(
            text("SELECT category_id FROM forum_threads WHERE id = :tid"), {"tid": str(p[1])}
        ).fetchone()
        cat_id = str(t[0]) if t else None
        if str(p[0]) != uid and not _is_forum_mod(session, uid, cat_id):
            raise HTTPException(403, "Not allowed")
        session.execute(
            text("UPDATE forum_posts SET is_deleted = TRUE WHERE id = :id"), {"id": post_id}
        )
        session.commit()
    return {"ok": True}


@router.post("/posts/{post_id}/react")
def react_post(post_id: str, body: ReactionBody, user: dict = Depends(_require_user)) -> Any:
    uid = user["user_id"]
    with _get_db() as session:
        p = session.execute(
            text("SELECT reactions FROM forum_posts WHERE id = :id AND NOT is_deleted"),
            {"id": post_id},
        ).fetchone()
        if not p:
            raise HTTPException(404, "Post not found")

        reactions: dict = dict(p[0] or {})
        emoji = body.emoji
        # Toggle: track per-user per-post in a sub-key
        user_key = f"_users_{emoji}"
        users_set: list = reactions.get(user_key, [])
        count = int(reactions.get(emoji, 0))

        if uid in users_set:
            users_set.remove(uid)
            count = max(0, count - 1)
        else:
            users_set.append(uid)
            count += 1

        reactions[emoji] = count
        reactions[user_key] = users_set

        import json as _json
        session.execute(
            text("UPDATE forum_posts SET reactions = :r WHERE id = :id"),
            {"r": _json.dumps(reactions), "id": post_id},
        )

        # forum_reaction batch notification at thresholds 5 / 10 / 25 / 50
        total_reactions = sum(
            v for k, v in reactions.items() if not k.startswith("_users_")
        )
        _REACTION_THRESHOLDS = (5, 10, 25, 50)
        if total_reactions in _REACTION_THRESHOLDS:
            post_author = session.execute(
                text("SELECT author_id, thread_id FROM forum_posts WHERE id = :id"),
                {"id": post_id},
            ).fetchone()
            if post_author and str(post_author[0]) != uid:
                session.execute(text("""
                    INSERT INTO notifications (user_id, type, title, message, metadata)
                    VALUES (:uid, 'forum_reaction', :title, :msg, :meta::jsonb)
                """), {
                    "uid":   str(post_author[0]),
                    "title": f"Your post got {total_reactions} reactions!",
                    "msg":   f"{total_reactions} people reacted to your forum post",
                    "meta":  _json.dumps({"post_id": post_id, "thread_id": str(post_author[1]), "count": total_reactions}),
                })

        session.commit()

    public = {k: v for k, v in reactions.items() if not k.startswith("_users_")}
    my_reactions = [e for e in ("👍", "❤️", "😂", "😮", "🔥", "👀") if uid in reactions.get(f"_users_{e}", [])]
    return {"reactions": public, "my_reactions": my_reactions}

# ── Search ────────────────────────────────────────────────────────────────────

@router.get("/search")
def search_forum(
    q: str = Query(..., min_length=2, max_length=200),
    category: str | None = Query(None),
    page: int = Query(1, ge=1),
) -> Any:
    offset = (page - 1) * 20
    with _get_db() as session:
        params: dict = {"q": q, "limit": 20, "offset": offset}
        cat_filter = ""
        if category:
            cat_row = session.execute(
                text("SELECT id FROM forum_categories WHERE slug = :s"), {"s": category}
            ).fetchone()
            if cat_row:
                cat_filter = "AND t.category_id = :cid"
                params["cid"] = str(cat_row[0])

        rows = session.execute(text(f"""
            SELECT t.id, t.title, t.slug, t.reply_count, t.created_at,
                   u.username, u.avatar,
                   ts_headline('english', t.body, plainto_tsquery('english', :q),
                               'MaxWords=30, MinWords=15') AS excerpt
            FROM forum_threads t
            JOIN users u ON u.id = t.author_id
            WHERE t.status != 'deleted'
              {cat_filter}
              AND to_tsvector('english', t.title || ' ' || t.body) @@ plainto_tsquery('english', :q)
            ORDER BY ts_rank(to_tsvector('english', t.title || ' ' || t.body), plainto_tsquery('english', :q)) DESC
            LIMIT :limit OFFSET :offset
        """), params).fetchall()

    return {
        "results": [
            {
                "id":          str(r[0]),
                "title":       r[1],
                "slug":        r[2],
                "reply_count": r[3],
                "created_at":  r[4].isoformat(),
                "author":      r[5],
                "excerpt":     r[7],
            }
            for r in rows
        ],
        "page": page,
    }

# ── Moderators (admin-only management) ───────────────────────────────────────

@router.post("/moderators", status_code=201)
def grant_moderator(body: ModeratorGrant, user: dict = Depends(_require_user)) -> Any:
    uid = user["user_id"]
    with _get_db() as session:
        if not _is_admin(session, uid):
            raise HTTPException(403, "Admin only")
        session.execute(text("""
            INSERT INTO forum_moderators (user_id, category_id, granted_by)
            VALUES (:uid, :cid, :gby)
            ON CONFLICT (user_id, category_id) DO NOTHING
        """), {"uid": body.user_id, "cid": body.category_id, "gby": uid})
        session.commit()
    return {"ok": True}


@router.delete("/moderators/{mod_id}")
def revoke_moderator(mod_id: str, user: dict = Depends(_require_user)) -> Any:
    uid = user["user_id"]
    with _get_db() as session:
        if not _is_admin(session, uid):
            raise HTTPException(403, "Admin only")
        session.execute(
            text("DELETE FROM forum_moderators WHERE id = :id"), {"id": mod_id}
        )
        session.commit()
    return {"ok": True}


@router.get("/moderators")
def list_moderators(user: dict = Depends(_require_user)) -> Any:
    uid = user["user_id"]
    with _get_db() as session:
        if not _is_admin(session, uid):
            raise HTTPException(403, "Admin only")
        rows = session.execute(text("""
            SELECT fm.id, u.username, u.arena_id, c.name AS category_name, fm.granted_at
            FROM forum_moderators fm
            JOIN users u ON u.id = fm.user_id
            LEFT JOIN forum_categories c ON c.id = fm.category_id
            ORDER BY fm.granted_at DESC
        """)).fetchall()
    return {"moderators": [
        {"id": str(r[0]), "username": r[1], "arena_id": r[2],
         "category": r[3] or "Global", "granted_at": r[4].isoformat()}
        for r in rows
    ]}

# ── User profile forum settings (signature, badge) ───────────────────────────

@router.patch("/profile")
def patch_forum_profile(body: ProfilePatch, user: dict = Depends(_require_user)) -> Any:
    """Set forum signature and display badge."""
    uid = user["user_id"]
    with _get_db() as session:
        # Ensure columns exist (added in migration 039)
        session.execute(text("""
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS forum_signature VARCHAR(200),
            ADD COLUMN IF NOT EXISTS forum_badge     VARCHAR(80)
        """))
        session.execute(text("""
            UPDATE users SET forum_signature = :sig, forum_badge = :badge WHERE id = :uid
        """), {"sig": body.forum_signature, "badge": body.forum_badge, "uid": uid})
        session.commit()
    return {"ok": True}


# ── Posts since (polling for live updates) ───────────────────────────────────

@router.get("/threads/{thread_id}/posts/since/{post_id}")
def posts_since(thread_id: str, post_id: str) -> Any:
    """Return posts created after post_id — used for 15s polling in open threads."""
    with _get_db() as session:
        ref = session.execute(
            text("SELECT created_at FROM forum_posts WHERE id = :id"), {"id": post_id}
        ).fetchone()
        if not ref:
            raise HTTPException(404, "Reference post not found")

        rows = session.execute(text("""
            SELECT p.id, p.author_id, p.parent_post_id, p.body, p.is_deleted,
                   p.edit_count, p.edited_at, p.reactions, p.created_at
            FROM forum_posts p
            WHERE p.thread_id = :tid AND p.created_at > :since
            ORDER BY p.created_at ASC
            LIMIT 50
        """), {"tid": thread_id, "since": ref[0]}).fetchall()

        post_list = []
        for p in rows:
            card = _user_card(session, str(p[1]) if p[1] else None)
            post_list.append({
                "id":             str(p[0]),
                "author":         card,
                "parent_post_id": str(p[2]) if p[2] else None,
                "body":           "[post removed]" if p[4] else p[3],
                "is_deleted":     p[4],
                "edit_count":     p[5],
                "edited_at":      p[6].isoformat() if p[6] else None,
                "reactions":      {k: v for k, v in (p[7] or {}).items() if not k.startswith("_users_")},
                "created_at":     p[8].isoformat(),
            })
    return {"posts": post_list}


# ── User forum activity ───────────────────────────────────────────────────────

@router.get("/users/{user_id}/activity")
def get_user_forum_activity(user_id: str) -> Any:
    """Public endpoint — returns forum stats + recent threads for a user's profile."""
    with _get_db() as session:
        thread_count = session.execute(
            text("SELECT COUNT(*) FROM forum_threads WHERE author_id = :uid AND status != 'deleted'"),
            {"uid": user_id},
        ).scalar() or 0

        post_count = session.execute(
            text("SELECT COUNT(*) FROM forum_posts WHERE author_id = :uid AND NOT is_deleted"),
            {"uid": user_id},
        ).scalar() or 0

        threads = session.execute(text("""
            SELECT t.id, t.title, t.slug, t.reply_count, t.created_at,
                   c.slug AS cat_slug, c.name AS cat_name
            FROM forum_threads t
            JOIN forum_categories c ON c.id = t.category_id
            WHERE t.author_id = :uid AND t.status != 'deleted'
            ORDER BY t.created_at DESC
            LIMIT 5
        """), {"uid": user_id}).fetchall()

    return {
        "thread_count": int(thread_count),
        "post_count":   int(post_count),
        "threads": [
            {
                "id":            str(t[0]),
                "title":         t[1],
                "slug":          t[2],
                "reply_count":   t[3],
                "created_at":    t[4].isoformat(),
                "category_slug": t[5],
                "category_name": t[6],
            }
            for t in threads
        ],
    }


# ── Forum profile — GET ───────────────────────────────────────────────────────

@router.get("/profile/me")
def get_forum_profile(user: dict = Depends(_require_user)) -> Any:
    uid = user["user_id"]
    with _get_db() as session:
        row = session.execute(
            text("SELECT forum_signature, forum_badge FROM users WHERE id = :uid"),
            {"uid": uid},
        ).fetchone()
    if not row:
        raise HTTPException(404, "User not found")
    return {"signature": row[0], "badge": row[1]}


# ── Report system ─────────────────────────────────────────────────────────────

@router.post("/posts/{post_id}/report", status_code=201)
def report_post(post_id: str, body: ReportBody, user: dict = Depends(_require_user)) -> Any:
    uid = user["user_id"]
    with _get_db() as session:
        p = session.execute(
            text("SELECT 1 FROM forum_posts WHERE id = :id AND NOT is_deleted"),
            {"id": post_id},
        ).fetchone()
        if not p:
            raise HTTPException(404, "Post not found")
        try:
            session.execute(text("""
                INSERT INTO forum_reports (post_id, reporter_id, reason)
                VALUES (:pid, :uid, :reason)
            """), {"pid": post_id, "uid": uid, "reason": body.reason})
            session.commit()
        except Exception:
            raise HTTPException(409, "You already reported this post")
    return {"ok": True}


@router.get("/admin/reported")
def list_reported_posts(user: dict = Depends(_require_user)) -> Any:
    uid = user["user_id"]
    with _get_db() as session:
        if not _is_forum_mod(session, uid):
            raise HTTPException(403, "Moderators only")
        rows = session.execute(text("""
            SELECT r.id, r.reason, r.status, r.created_at,
                   p.id AS post_id, p.body, p.thread_id,
                   u.username AS reporter, pu.username AS post_author
            FROM forum_reports r
            JOIN forum_posts  p  ON p.id = r.post_id
            JOIN users        u  ON u.id = r.reporter_id
            JOIN users        pu ON pu.id = p.author_id
            WHERE r.status = 'pending'
            ORDER BY r.created_at ASC
            LIMIT 100
        """)).fetchall()
    return {"reports": [
        {
            "id":          str(r[0]),
            "reason":      r[1],
            "status":      r[2],
            "created_at":  r[3].isoformat(),
            "post_id":     str(r[4]),
            "post_body":   r[5][:200] if r[5] else "",
            "thread_id":   str(r[6]),
            "reporter":    r[7],
            "post_author": r[8],
        }
        for r in rows
    ]}


@router.post("/admin/reported/{report_id}/resolve")
def resolve_report(
    report_id: str,
    action: str = Query(..., pattern="^(dismiss|remove_post)$"),
    user: dict = Depends(_require_user),
) -> Any:
    uid = user["user_id"]
    with _get_db() as session:
        if not _is_forum_mod(session, uid):
            raise HTTPException(403, "Moderators only")
        r = session.execute(
            text("SELECT post_id FROM forum_reports WHERE id = :id"), {"id": report_id}
        ).fetchone()
        if not r:
            raise HTTPException(404, "Report not found")
        if action == "remove_post":
            session.execute(
                text("UPDATE forum_posts SET is_deleted = TRUE WHERE id = :id"), {"id": str(r[0])}
            )
        session.execute(text("""
            UPDATE forum_reports
            SET status = 'resolved', reviewed_by = :uid, reviewed_at = NOW()
            WHERE id = :id
        """), {"uid": uid, "id": report_id})
        session.commit()
    return {"ok": True}
