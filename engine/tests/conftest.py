"""
Shared pytest fixtures for the Arena engine test suite.
"""
import pytest


@pytest.fixture(autouse=True)
def clear_rate_buckets():
    """
    Reset in-memory rate-limit buckets and daily-limit cache before every test.

    Without this, sequential tests within the same pytest session share
    module-level state (_rate_buckets, _at_daily_limit) and interfere with each other.

    Also clears TestClient cookie jars (F1 added Set-Cookie on login — left in
    the client across tests, the auth cookie lets verify_token pass for any
    follow-up test that expected "no credentials").
    """
    try:
        import main
        main._rate_buckets.clear()
        main._at_daily_limit = main.AT_DAILY_STAKE_LIMIT
    except (ImportError, AttributeError):
        pass
    _clear_test_client_cookies()
    yield
    try:
        import main
        main._rate_buckets.clear()
        main._at_daily_limit = main.AT_DAILY_STAKE_LIMIT
    except (ImportError, AttributeError):
        pass
    _clear_test_client_cookies()


def _clear_test_client_cookies() -> None:
    """Clear any module-level TestClient cookie jars so Set-Cookie from one
    test does not authenticate the next. Tests create their clients via
    `client = TestClient(app)` at import time in each test module."""
    import importlib
    import sys
    for mod_name in list(sys.modules):
        if not mod_name.startswith("tests."):
            continue
        mod = sys.modules.get(mod_name)
        if not mod:
            continue
        tc = getattr(mod, "client", None)
        if tc is not None and hasattr(tc, "cookies"):
            try:
                tc.cookies.clear()
            except Exception:
                pass
