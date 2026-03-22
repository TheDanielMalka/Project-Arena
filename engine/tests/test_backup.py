"""
Tests for engine/src/identity/backup.py
Covers: backup creation, cleanup of old backups.
"""

import pytest
from datetime import datetime
from pathlib import Path
from src.identity.backup import backup_database, cleanup_old_backups


# ── Helpers ───────────────────────────────────────────────────────────────────
@pytest.fixture
def mock_db(tmp_path):
    """קובץ players.db מזויף לבדיקות."""
    db_file = tmp_path / "players.db"
    db_file.write_bytes(b"fake db content")
    return db_file


@pytest.fixture
def backup_dir(tmp_path):
    return tmp_path / "backups"


# ── backup_database ───────────────────────────────────────────────────────────
class TestBackupDatabase:
    def test_backup_creates_file(self, mock_db, backup_dir):
        result = backup_database(db_path=mock_db, backup_dir=backup_dir)
        assert result.exists()

    def test_backup_file_has_todays_date(self, mock_db, backup_dir):
        result = backup_database(db_path=mock_db, backup_dir=backup_dir)
        today  = datetime.now().strftime("%Y-%m-%d")
        assert today in result.name

    def test_backup_filename_format(self, mock_db, backup_dir):
        result = backup_database(db_path=mock_db, backup_dir=backup_dir)
        assert result.name.startswith("players_")
        assert result.suffix == ".db"

    def test_backup_creates_dir_if_missing(self, mock_db, backup_dir):
        assert not backup_dir.exists()
        backup_database(db_path=mock_db, backup_dir=backup_dir)
        assert backup_dir.exists()

    def test_backup_raises_if_db_missing(self, tmp_path, backup_dir):
        missing = tmp_path / "nonexistent.db"
        with pytest.raises(FileNotFoundError):
            backup_database(db_path=missing, backup_dir=backup_dir)

    def test_backup_content_matches_original(self, mock_db, backup_dir):
        result = backup_database(db_path=mock_db, backup_dir=backup_dir)
        assert result.read_bytes() == mock_db.read_bytes()


# ── cleanup_old_backups ───────────────────────────────────────────────────────
class TestCleanupOldBackups:
    def test_cleanup_deletes_old_files(self, tmp_path):
        backup_dir = tmp_path / "backups"
        backup_dir.mkdir()
        old_file = backup_dir / "players_2020-01-01.db"
        old_file.write_bytes(b"old backup")

        count = cleanup_old_backups(backup_dir=backup_dir, keep_days=30)

        assert count == 1
        assert not old_file.exists()

    def test_cleanup_keeps_recent_files(self, tmp_path):
        backup_dir = tmp_path / "backups"
        backup_dir.mkdir()
        today       = datetime.now().strftime("%Y-%m-%d")
        recent_file = backup_dir / f"players_{today}.db"
        recent_file.write_bytes(b"recent backup")

        count = cleanup_old_backups(backup_dir=backup_dir, keep_days=30)

        assert count == 0
        assert recent_file.exists()

    def test_cleanup_returns_zero_if_no_dir(self, tmp_path):
        missing_dir = tmp_path / "no_backups"
        count = cleanup_old_backups(backup_dir=missing_dir)
        assert count == 0

    def test_cleanup_ignores_unknown_filenames(self, tmp_path):
        backup_dir = tmp_path / "backups"
        backup_dir.mkdir()
        strange = backup_dir / "players_not-a-date.db"
        strange.write_bytes(b"strange")

        count = cleanup_old_backups(backup_dir=backup_dir, keep_days=30)

        assert count == 0
        assert strange.exists()
