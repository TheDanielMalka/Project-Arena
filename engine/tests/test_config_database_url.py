"""DATABASE_URL resolution: URL-encode user/password so special characters are safe."""

from src.config import build_postgresql_url


def test_build_postgresql_url_encodes_special_chars_in_password() -> None:
    url = build_postgresql_url(
        "arena_admin",
        "p/w@:pass#x",
        "arena-db",
        "5432",
        "arena",
    )
    assert "p%2Fw%40%3Apass%23x" in url
    assert "postgresql://arena_admin:" in url
    assert "@arena-db:5432/arena" in url
