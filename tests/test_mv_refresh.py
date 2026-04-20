import os
import json
import uuid
from datetime import datetime, timezone

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


def _seed_minimal(conn):
    """One user, one chat, one message, one workflow, one invokeModel activity."""
    user_id = "11111111-1111-1111-1111-111111111111"
    chat_id = "22222222-2222-2222-2222-222222222222"
    msg_id = "33333333-3333-3333-3333-333333333333"
    wf_id = "chat-test-001"
    t = datetime(2026, 1, 1, tzinfo=timezone.utc)
    with conn.cursor() as cur:
        cur.execute("INSERT INTO users (id, auth_id, email) VALUES (%s, %s, %s)",
                    (user_id, "auth-1", "user@example.com"))
        cur.execute("INSERT INTO chats (id, title, created_at, updated_at, user_id) "
                    "VALUES (%s, 'Test', %s, %s, %s)",
                    (chat_id, t, t, user_id))
        cur.execute('INSERT INTO messages (id, "order", role, created_at, chat_id) '
                    "VALUES (%s, 0, 'user', %s, %s)",
                    (msg_id, t, chat_id))
        cur.execute("INSERT INTO workflows (workflow_id, run_id, status, start_time, end_time) "
                    "VALUES (%s, 'run-1', 'COMPLETED', %s, %s)",
                    (wf_id, t, t))
        cur.execute("INSERT INTO chat_workflows (workflow_id, message_id) VALUES (%s, %s)",
                    (wf_id, msg_id))
        cur.execute(
            "INSERT INTO activities (workflow_id, activity_id, activity_type, status, "
            "scheduled_time, started_time, completed_time, input, output) "
            "VALUES (%s, '1', 'invokeModel', 'COMPLETED', %s, %s, %s, %s::jsonb, %s::jsonb)",
            (
                wf_id, t, t, t,
                json.dumps({"modelId": "vertex:gemini-3-flash-preview"}),
                json.dumps({"usage": {"inputTokens": {"total": 100, "noCache": 100}, "outputTokens": {"total": 50, "text": 50}}}),
            ),
        )
    conn.commit()
    return user_id, chat_id, msg_id, wf_id


def test_refresh_populates_all_three_mvs(observer_conn):
    from db import init_schema
    from app_sync import refresh_materialized_views

    init_schema(observer_conn)
    _seed_minimal(observer_conn)

    refresh_materialized_views(observer_conn)

    with observer_conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM mv_chat_stats")
        assert cur.fetchone()[0] == 1
        cur.execute("SELECT COUNT(*) FROM mv_daily_activity_stats")
        assert cur.fetchone()[0] == 1
        cur.execute("SELECT COUNT(*) FROM mv_column_creation_stats")
        assert cur.fetchone()[0] == 0  # no cgw rows seeded

        cur.execute("SELECT message_count, total_cost_usd, llm_calls FROM mv_chat_stats")
        row = cur.fetchone()
        assert row[0] == 1
        assert row[1] > 0
        assert row[2] == 1

        cur.execute("SELECT source, total_input_tokens, total_output_tokens, llm_calls FROM mv_daily_activity_stats")
        row = cur.fetchone()
        assert row[0] == "chat"
        assert row[1] == 100
        assert row[2] == 50
        assert row[3] == 1


def test_refresh_is_idempotent_uses_concurrently_on_second_run(observer_conn, caplog):
    import logging
    caplog.set_level(logging.INFO)
    from db import init_schema
    from app_sync import refresh_materialized_views

    init_schema(observer_conn)
    _seed_minimal(observer_conn)

    refresh_materialized_views(observer_conn)
    first_messages = [r.message for r in caplog.records if "Refreshed mv_" in r.message]
    assert any("blocking" in m for m in first_messages)

    caplog.clear()
    refresh_materialized_views(observer_conn)
    second_messages = [r.message for r in caplog.records if "Refreshed mv_" in r.message]
    assert any("CONCURRENTLY" in m for m in second_messages)

    # Data still consistent
    with observer_conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM mv_chat_stats")
        assert cur.fetchone()[0] == 1


def test_refresh_continues_if_one_mv_fails(observer_conn, caplog):
    import logging
    caplog.set_level(logging.ERROR)
    from db import init_schema
    from app_sync import refresh_materialized_views

    init_schema(observer_conn)
    _seed_minimal(observer_conn)

    # Drop one MV to force a refresh failure on it
    with observer_conn.cursor() as cur:
        cur.execute("DROP MATERIALIZED VIEW mv_chat_stats")
    observer_conn.commit()

    refresh_materialized_views(observer_conn)

    # Error logged for the missing one
    assert any("mv_chat_stats" in r.message for r in caplog.records if r.levelno >= logging.ERROR)

    # Other two still populated
    with observer_conn.cursor() as cur:
        cur.execute("SELECT ispopulated FROM pg_matviews WHERE matviewname = 'mv_column_creation_stats'")
        assert cur.fetchone()[0] is True
        cur.execute("SELECT ispopulated FROM pg_matviews WHERE matviewname = 'mv_daily_activity_stats'")
        assert cur.fetchone()[0] is True
