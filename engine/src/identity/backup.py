"""
ARENA Engine — Database Backup
מעתיק את players.db לתיקיית engine/data/backups/ עם תאריך.
"""

from __future__ import annotations

import shutil
import logging
from datetime import datetime, timedelta
from pathlib import Path

log = logging.getLogger("identity.backup")

# ── Default paths ─────────────────────────────────────────────────────────────
_DATA_DIR          = Path(__file__).parent.parent.parent / "data"
_DEFAULT_DB_PATH   = _DATA_DIR / "players.db"
_DEFAULT_BACKUP_DIR = _DATA_DIR / "backups"


def backup_database(
    db_path: Path = _DEFAULT_DB_PATH,
    backup_dir: Path = _DEFAULT_BACKUP_DIR,
) -> Path:
    """
    מעתיק את קובץ הדאטהבייס לתיקיית הגיבויים עם תאריך היום.
    מחזיר את הנתיב של קובץ הגיבוי שנוצר.
    """
    db_path    = Path(db_path)
    backup_dir = Path(backup_dir)
    backup_dir.mkdir(parents=True, exist_ok=True)

    if not db_path.exists():
        raise FileNotFoundError(f"Database file not found: {db_path}")

    stamp       = datetime.now().strftime("%Y-%m-%d")
    backup_path = backup_dir / f"players_{stamp}.db"
    shutil.copy2(db_path, backup_path)
    log.info("backup created | path=%s", backup_path)
    return backup_path


def cleanup_old_backups(
    backup_dir: Path = _DEFAULT_BACKUP_DIR,
    keep_days:  int  = 30,
) -> int:
    """
    מוחק גיבויים ישנים מעל keep_days ימים.
    מחזיר כמה קבצים נמחקו.
    """
    backup_dir = Path(backup_dir)
    if not backup_dir.exists():
        return 0

    cutoff  = datetime.now() - timedelta(days=keep_days)
    deleted = 0

    for f in backup_dir.glob("players_*.db"):
        try:
            date_str  = f.stem.replace("players_", "")
            file_date = datetime.strptime(date_str, "%Y-%m-%d")
            if file_date < cutoff:
                f.unlink()
                deleted += 1
                log.info("old backup deleted | path=%s", f)
        except ValueError:
            pass  # שמות קבצים לא תקינים — מדלגים

    return deleted
