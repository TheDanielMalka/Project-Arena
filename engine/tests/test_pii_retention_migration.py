"""
Static sanity checks for the PII retention migration (036).

We cannot run Postgres in the unit-test suite, so this is not an integration
test — it simply verifies the migration file is shaped the way the engine
expects at runtime:

  - Defines `pii_retention_config` with the 7 retention windows and a
    singleton CHECK(id = 1).
  - Defines `pii_retention_run_log` with the six per-table counters.
  - Defines `run_pii_retention_purge(TEXT)` and returns rows deleted.
  - The engine code in main.py references the function name by the same
    signature (run_pii_retention_purge('system')).

If any of these shapes drift the daily purge task would silently start
failing in production; catching it here prevents that class of bug.
"""
from __future__ import annotations

import pathlib

MIGRATION_PATH = (
    pathlib.Path(__file__).resolve().parents[2] / "infra" / "sql" / "036-pii-retention.sql"
)


def _read() -> str:
    assert MIGRATION_PATH.exists(), f"missing migration file: {MIGRATION_PATH}"
    return MIGRATION_PATH.read_text(encoding="utf-8")


def test_migration_file_present():
    sql = _read()
    assert "Migration 036" in sql
    assert "BEGIN;" in sql and "COMMIT;" in sql


def test_pii_retention_config_table_has_all_windows():
    sql = _read()
    assert "CREATE TABLE IF NOT EXISTS pii_retention_config" in sql
    for col in (
        "direct_messages_days",
        "inbox_messages_days",
        "inbox_soft_deleted_days",
        "notifications_days",
        "audit_logs_days",
        "admin_audit_log_days",
        "support_tickets_days",
    ):
        assert col in sql, f"pii_retention_config missing column: {col}"
    # Singleton guarantee — only one config row is ever allowed.
    assert "CHECK (id = 1)" in sql


def test_pii_retention_run_log_has_per_table_counters():
    sql = _read()
    assert "CREATE TABLE IF NOT EXISTS pii_retention_run_log" in sql
    for col in (
        "dm_deleted",
        "inbox_deleted",
        "notifications_deleted",
        "audit_logs_deleted",
        "admin_audit_deleted",
        "tickets_deleted",
    ):
        assert col in sql, f"pii_retention_run_log missing column: {col}"


def test_purge_function_signature():
    sql = _read()
    # Matches the call site in engine/main.py: run_pii_retention_purge('system')
    assert "CREATE OR REPLACE FUNCTION run_pii_retention_purge" in sql
    assert "_triggered_by TEXT DEFAULT 'system'" in sql
    # SECURITY DEFINER + pinned search_path — required for functions that
    # run DELETE across multiple tables. Without SET search_path a privilege
    # escalation via a shadowed table in the caller's path would be possible.
    assert "SECURITY DEFINER" in sql
    assert "SET search_path = public" in sql


def test_purge_function_touches_all_six_tables():
    sql = _read()
    for table in (
        "direct_messages",
        "inbox_messages",
        "notifications",
        "audit_logs",
        "admin_audit_log",
        "support_tickets",
    ):
        assert f"DELETE FROM {table}" in sql, f"purge does not touch {table}"


def test_engine_main_registers_the_daily_task():
    main_py = (
        pathlib.Path(__file__).resolve().parents[2] / "engine" / "main.py"
    ).read_text(encoding="utf-8")
    assert "_pii_retention_purge_loop" in main_py
    assert "_pii_retention_task" in main_py
    # Call site matches the SQL signature exactly.
    assert "run_pii_retention_purge('system')" in main_py
    # And it's cancelled on shutdown.
    assert "_pii_retention_task.cancel()" in main_py
