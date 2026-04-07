"""
Shared pytest fixtures for the Arena engine test suite.
"""
import pytest


@pytest.fixture(autouse=True)
def clear_rate_buckets():
    """
    Reset in-memory rate-limit buckets before every test.

    Without this, sequential tests within the same pytest session share
    the module-level _rate_buckets dict and exhaust each other's limits.
    """
    try:
        import main
        main._rate_buckets.clear()
    except (ImportError, AttributeError):
        pass  # _rate_buckets not yet initialised (e.g. import-time error)
    yield
    # Post-test cleanup (optional but keeps state tidy)
    try:
        import main
        main._rate_buckets.clear()
    except (ImportError, AttributeError):
        pass
