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
        cur.execute("DROP MATERIALIZED VIEW IF EXISTS mv_daily_activity_stats CASCADE")
        cur.execute("DROP MATERIALIZED VIEW IF EXISTS mv_column_creation_stats CASCADE")
        cur.execute("DROP MATERIALIZED VIEW IF EXISTS mv_chat_stats CASCADE")
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


def _insert_cgw(conn, workflow_id, batch_id, status="COMPLETED"):
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO workflows (workflow_id, run_id, status, start_time, end_time) "
            "VALUES (%s, %s, %s, %s, %s)",
            (
                workflow_id, "run-" + workflow_id, status,
                datetime(2026, 1, 1, tzinfo=timezone.utc),
                datetime(2026, 1, 1, 0, 5, tzinfo=timezone.utc) if status == "COMPLETED" else None,
            ),
        )
        cur.execute(
            "INSERT INTO column_generation_workflows (workflow_id, batch_id, user_id, metadata) "
            "VALUES (%s, %s::uuid, NULL, NULL)",
            (workflow_id, batch_id),
        )
    conn.commit()


def _sample_batch(batch_id, user_id="11111111-1111-1111-1111-111111111111"):
    return {
        "id": batch_id,
        "columnId": "22222222-2222-2222-2222-222222222222",
        "columnName": "Revenue",
        "prompt": "Extract revenue",
        "variant": "LLM",
        "variantOptions": {"model": "claude-opus-4-7"},
        "rows": 10, "totalRows": 10, "completedRows": 10, "failedRows": 0,
        "status": "COMPLETED",
        "userId": user_id,
        "createdAt": "2026-04-19T15:00:00+00:00",
        "updatedAt": "2026-04-19T15:05:00+00:00",
    }


def test_apply_batch_enrichment_backfills_null_row(observer_conn):
    from db import init_schema
    from app_sync import _apply_batch_enrichment
    init_schema(observer_conn)
    batch_id = "3e59057c-eef0-4093-9213-75ed0a37895c"
    _insert_cgw(observer_conn, f"generation-batch-{batch_id}", batch_id)

    with observer_conn.cursor() as cur:
        cur.execute("INSERT INTO users (id, auth_id) VALUES (%s, 'auth-1')", ("11111111-1111-1111-1111-111111111111",))
    observer_conn.commit()

    updated = _apply_batch_enrichment(observer_conn, [_sample_batch(batch_id)])
    observer_conn.commit()
    assert updated == 1

    with observer_conn.cursor() as cur:
        cur.execute(
            "SELECT user_id::text, metadata FROM column_generation_workflows WHERE batch_id = %s::uuid",
            (batch_id,),
        )
        row = cur.fetchone()
    assert row[0] == "11111111-1111-1111-1111-111111111111"
    assert row[1]["columnName"] == "Revenue"


def test_apply_batch_enrichment_empty_input(observer_conn):
    from db import init_schema
    from app_sync import _apply_batch_enrichment
    init_schema(observer_conn)
    assert _apply_batch_enrichment(observer_conn, []) == 0


def test_find_orphan_batch_ids_returns_observer_rows_without_match(observer_conn):
    from db import init_schema
    from app_sync import _find_orphan_batch_ids
    init_schema(observer_conn)
    orphan_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    present_id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    _insert_cgw(observer_conn, f"generation-batch-{orphan_id}", orphan_id)
    _insert_cgw(observer_conn, f"generation-batch-{present_id}", present_id)

    orphans = _find_orphan_batch_ids(observer_conn, [_sample_batch(present_id)])
    assert orphans == [orphan_id]
