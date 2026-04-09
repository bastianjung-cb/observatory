import pytest
import psycopg

POSTGRES_DSN = "postgresql://observer:observer@localhost:5432/observer"


@pytest.fixture
def db_conn():
    conn = psycopg.connect(POSTGRES_DSN)
    yield conn
    # Clean up tables after each test
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS activities CASCADE")
        cur.execute("DROP TABLE IF EXISTS workflows CASCADE")
    conn.commit()
    conn.close()


def test_init_schema_creates_tables(db_conn):
    from db import init_schema

    init_schema(db_conn)

    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name IN ('workflows', 'activities') "
            "ORDER BY table_name"
        )
        tables = [row[0] for row in cur.fetchall()]

    assert tables == ["activities", "workflows"]


def test_init_schema_is_idempotent(db_conn):
    from db import init_schema

    init_schema(db_conn)
    init_schema(db_conn)  # Should not raise

    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name IN ('workflows', 'activities') "
            "ORDER BY table_name"
        )
        tables = [row[0] for row in cur.fetchall()]

    assert tables == ["activities", "workflows"]


from datetime import datetime, timezone


def _sample_workflow(workflow_id="chat-9e138348-0b53-407e-900e-ccacb83ecf6f"):
    return {
        "workflow_id": workflow_id,
        "chat_uuid": "9e138348-0b53-407e-900e-ccacb83ecf6f",
        "run_id": "run-abc-123",
        "status": "COMPLETED",
        "start_time": datetime(2026, 1, 1, tzinfo=timezone.utc),
        "end_time": datetime(2026, 1, 1, 0, 5, tzinfo=timezone.utc),
        "input": {"prompt": "hello"},
        "output": {"response": "world"},
    }


def test_upsert_workflow_inserts_new(db_conn):
    from db import init_schema, upsert_workflow

    init_schema(db_conn)
    upsert_workflow(db_conn, _sample_workflow())

    with db_conn.cursor() as cur:
        cur.execute("SELECT workflow_id, status FROM workflows")
        row = cur.fetchone()

    assert row[0] == "chat-9e138348-0b53-407e-900e-ccacb83ecf6f"
    assert row[1] == "COMPLETED"


def test_upsert_workflow_updates_running_to_completed(db_conn):
    from db import init_schema, upsert_workflow

    init_schema(db_conn)

    running = _sample_workflow()
    running["status"] = "RUNNING"
    running["end_time"] = None
    running["output"] = None
    upsert_workflow(db_conn, running)

    completed = _sample_workflow()
    upsert_workflow(db_conn, completed)

    with db_conn.cursor() as cur:
        cur.execute("SELECT status, end_time FROM workflows")
        row = cur.fetchone()

    assert row[0] == "COMPLETED"
    assert row[1] is not None


def test_upsert_workflow_skips_terminal_duplicate(db_conn):
    from db import init_schema, upsert_workflow

    init_schema(db_conn)
    upsert_workflow(db_conn, _sample_workflow())
    upsert_workflow(db_conn, _sample_workflow())  # Should not raise

    with db_conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM workflows")
        assert cur.fetchone()[0] == 1


def _sample_activity(activity_id="1"):
    return {
        "workflow_id": "chat-9e138348-0b53-407e-900e-ccacb83ecf6f",
        "activity_id": activity_id,
        "activity_type": "llm_call",
        "status": "COMPLETED",
        "scheduled_time": datetime(2026, 1, 1, 0, 0, 1, tzinfo=timezone.utc),
        "started_time": datetime(2026, 1, 1, 0, 0, 2, tzinfo=timezone.utc),
        "completed_time": datetime(2026, 1, 1, 0, 0, 3, tzinfo=timezone.utc),
        "input": {"model": "gpt-4", "prompt": "hello"},
        "output": {"response": "hi"},
    }


def test_upsert_activities_inserts(db_conn):
    from db import init_schema, upsert_workflow, upsert_activities

    init_schema(db_conn)
    upsert_workflow(db_conn, _sample_workflow())
    upsert_activities(db_conn, [_sample_activity("1"), _sample_activity("2")])

    with db_conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM activities")
        assert cur.fetchone()[0] == 2


def test_upsert_activities_skips_duplicates(db_conn):
    from db import init_schema, upsert_workflow, upsert_activities

    init_schema(db_conn)
    upsert_workflow(db_conn, _sample_workflow())
    upsert_activities(db_conn, [_sample_activity("1")])
    upsert_activities(db_conn, [_sample_activity("1")])  # Duplicate

    with db_conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM activities")
        assert cur.fetchone()[0] == 1


def test_is_workflow_terminal_returns_true_for_completed(db_conn):
    from db import init_schema, upsert_workflow, is_workflow_terminal

    init_schema(db_conn)
    upsert_workflow(db_conn, _sample_workflow())

    assert is_workflow_terminal(db_conn, "chat-9e138348-0b53-407e-900e-ccacb83ecf6f") is True


def test_is_workflow_terminal_returns_false_for_running(db_conn):
    from db import init_schema, upsert_workflow, is_workflow_terminal

    init_schema(db_conn)
    running = _sample_workflow()
    running["status"] = "RUNNING"
    upsert_workflow(db_conn, running)

    assert is_workflow_terminal(db_conn, "chat-9e138348-0b53-407e-900e-ccacb83ecf6f") is False


def test_is_workflow_terminal_returns_false_for_unknown(db_conn):
    from db import init_schema, is_workflow_terminal

    init_schema(db_conn)

    assert is_workflow_terminal(db_conn, "chat-nonexistent") is False
