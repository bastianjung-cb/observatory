import os
import json
import uuid
from datetime import datetime, timezone, timedelta

import psycopg
import pytest

POSTGRES_DSN = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql://observer:observer@localhost:5436/observer",
)


@pytest.fixture
def observer_conn():
    conn = psycopg.connect(POSTGRES_DSN)
    yield conn
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS column_generation_workflows CASCADE")
        cur.execute("DROP TABLE IF EXISTS chat_workflows CASCADE")
        cur.execute("DROP TABLE IF EXISTS activities CASCADE")
        cur.execute("DROP TABLE IF EXISTS workflows CASCADE")
        cur.execute("DROP TABLE IF EXISTS message_parts CASCADE")
        cur.execute("DROP TABLE IF EXISTS messages CASCADE")
        cur.execute("DROP TABLE IF EXISTS chats CASCADE")
        cur.execute("DROP TABLE IF EXISTS users CASCADE")
        cur.execute("DROP TABLE IF EXISTS sync_state CASCADE")
        cur.execute("DROP TABLE IF EXISTS settings CASCADE")
        cur.execute("DROP TABLE IF EXISTS model_pricing CASCADE")
    conn.commit()
    conn.close()


def test_sync_chats_watermark_does_not_exceed_caller_clock(observer_conn):
    """Watermark must be captured before the query, not after — so rows inserted
    after the query began (and before the watermark update) aren't silently
    skipped. This is a smoke test: we verify the stored watermark is <= the
    caller's post-invoke clock.
    """
    from db import init_schema, get_last_sync
    from app_sync import sync_chats
    init_schema(observer_conn)

    class DummyAppCursor:
        def execute(self, *args, **kwargs): pass
        def fetchall(self): return []
        def __enter__(self): return self
        def __exit__(self, *a): pass

    class DummyAppConn:
        def cursor(self): return DummyAppCursor()

    sync_chats(DummyAppConn(), observer_conn)
    post_invoke = datetime.now(timezone.utc)

    stored = get_last_sync(observer_conn, "chats")
    assert stored is not None
    assert stored <= post_invoke
