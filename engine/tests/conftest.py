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
    """
    try:
        import main
        main._rate_buckets.clear()
        main._at_daily_limit = main.AT_DAILY_STAKE_LIMIT
    except (ImportError, AttributeError):
        pass
    yield
    try:
        import main
        main._rate_buckets.clear()
        main._at_daily_limit = main.AT_DAILY_STAKE_LIMIT
    except (ImportError, AttributeError):
        pass
