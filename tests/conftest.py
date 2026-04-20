"""Session-wide safety guard.

The test fixtures in this suite drop every table (and materialized view) in
teardown. If TEST_DATABASE_URL points at a real database by accident, running
tests silently wipes it — this actually happened once and destroyed several
days of historical workflow data that had already aged out of Temporal
retention and therefore could not be re-ingested.

This guard refuses to let the test session start unless:

  1. The database name portion of the DSN contains "test" (case-insensitive),
     e.g. `observer_test`, `test_observer`, `obs_test_db`, OR
  2. The override env var TEST_DATABASE_ALLOW_DESTRUCTIVE=1 is set.

It runs once at session configure time, BEFORE any fixture. If the DSN fails
the check, pytest aborts with a clear message and no SQL is executed.
"""

from __future__ import annotations

import os
from urllib.parse import urlparse

import pytest


DEFAULT_DSN = "postgresql://observer:observer@localhost:5436/observer"


def _database_name(dsn: str) -> str:
    try:
        return urlparse(dsn).path.lstrip("/")
    except Exception:
        return ""


def _dsn_is_test_safe(dsn: str) -> bool:
    if os.environ.get("TEST_DATABASE_ALLOW_DESTRUCTIVE") == "1":
        return True
    return "test" in _database_name(dsn).lower()


def pytest_configure(config: pytest.Config) -> None:
    dsn = os.environ.get("TEST_DATABASE_URL", DEFAULT_DSN)
    if _dsn_is_test_safe(dsn):
        return
    db_name = _database_name(dsn) or "<unparseable>"
    raise pytest.UsageError(
        "\n\n"
        "=== Refusing to run the test suite ===\n"
        f"TEST_DATABASE_URL points at database '{db_name}', which does not\n"
        "contain 'test' in its name. The fixtures drop every table and\n"
        "materialized view in teardown; running against this database would\n"
        "permanently delete its contents.\n\n"
        "To proceed, either:\n"
        "  - Use a database whose name contains 'test', e.g.:\n"
        "      createdb observer_test\n"
        "      TEST_DATABASE_URL=postgresql://observer:observer@localhost:5437/observer_test uv run pytest\n"
        "  - Or set TEST_DATABASE_ALLOW_DESTRUCTIVE=1 to override the guard\n"
        "    (only do this if you have deliberately chosen a disposable DB).\n\n"
    )
