import uuid

import pytest
import psycopg

POSTGRES_DSN = "postgresql://observer:observer@localhost:5436/observer"


@pytest.fixture
def db_conn():
    conn = psycopg.connect(POSTGRES_DSN)
    yield conn
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS activities CASCADE")
        cur.execute("DROP TABLE IF EXISTS workflows CASCADE")
        cur.execute("DROP TABLE IF EXISTS message_parts CASCADE")
        cur.execute("DROP TABLE IF EXISTS messages CASCADE")
        cur.execute("DROP TABLE IF EXISTS chats CASCADE")
        cur.execute("DROP TABLE IF EXISTS users CASCADE")
        cur.execute("DROP TABLE IF EXISTS sync_state CASCADE")
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
        "message_id": "9e138348-0b53-407e-900e-ccacb83ecf6f",
        "run_id": "run-abc-123",
        "status": "COMPLETED",
        "start_time": datetime(2026, 1, 1, tzinfo=timezone.utc),
        "end_time": datetime(2026, 1, 1, 0, 5, tzinfo=timezone.utc),
        "input": {"prompt": "hello"},
        "output": {"response": "world"},
        "parent_workflow_id": None,
        "workflow_name": None,
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
        "attempt": 1,
    }


def _sample_user():
    return {
        "id": str(uuid.UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")),
        "auth_id": "kinde_123",
        "email": "alice@example.com",
        "given_name": "Alice",
        "family_name": "Smith",
        "is_suspended": False,
        "deleted_at": None,
    }


def _sample_chat(user_id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"):
    return {
        "id": str(uuid.UUID("11111111-2222-3333-4444-555555555555")),
        "title": "Test Chat",
        "created_at": datetime(2026, 4, 1, tzinfo=timezone.utc),
        "updated_at": datetime(2026, 4, 1, tzinfo=timezone.utc),
        "deleted_at": None,
        "user_id": user_id,
    }


def _sample_message(chat_id="11111111-2222-3333-4444-555555555555"):
    return {
        "id": str(uuid.UUID("99999999-8888-7777-6666-555555555555")),
        "order": 1,
        "role": "USER",
        "metadata": None,
        "created_at": datetime(2026, 4, 1, 0, 0, 1, tzinfo=timezone.utc),
        "chat_id": chat_id,
    }


def _sample_message_part(message_id="99999999-8888-7777-6666-555555555555"):
    return {
        "id": str(uuid.UUID("abababab-cdcd-efef-0101-232323232323")),
        "order": 1,
        "content": {"type": "text", "text": "Hello world"},
        "created_at": datetime(2026, 4, 1, 0, 0, 1, tzinfo=timezone.utc),
        "message_id": message_id,
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


def test_init_schema_creates_all_tables(db_conn):
    from db import init_schema

    init_schema(db_conn)

    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public' "
            "ORDER BY table_name"
        )
        tables = [row[0] for row in cur.fetchall()]

    assert "activities" in tables
    assert "chats" in tables
    assert "message_parts" in tables
    assert "messages" in tables
    assert "sync_state" in tables
    assert "users" in tables
    assert "workflows" in tables


def test_get_last_sync_returns_none_for_new_entity(db_conn):
    from db import init_schema, get_last_sync

    init_schema(db_conn)
    assert get_last_sync(db_conn, "users") is None


def test_update_and_get_last_sync(db_conn):
    from db import init_schema, get_last_sync, update_last_sync

    init_schema(db_conn)
    ts = datetime(2026, 4, 1, tzinfo=timezone.utc)
    update_last_sync(db_conn, "users", ts)

    assert get_last_sync(db_conn, "users") == ts


def test_update_last_sync_overwrites(db_conn):
    from db import init_schema, get_last_sync, update_last_sync

    init_schema(db_conn)
    ts1 = datetime(2026, 4, 1, tzinfo=timezone.utc)
    ts2 = datetime(2026, 4, 2, tzinfo=timezone.utc)
    update_last_sync(db_conn, "users", ts1)
    update_last_sync(db_conn, "users", ts2)

    assert get_last_sync(db_conn, "users") == ts2


def test_upsert_users_inserts(db_conn):
    from db import init_schema, upsert_users

    init_schema(db_conn)
    upsert_users(db_conn, [_sample_user()])

    with db_conn.cursor() as cur:
        cur.execute("SELECT email, given_name FROM users")
        row = cur.fetchone()

    assert row[0] == "alice@example.com"
    assert row[1] == "Alice"


def test_upsert_users_updates_existing(db_conn):
    from db import init_schema, upsert_users

    init_schema(db_conn)
    upsert_users(db_conn, [_sample_user()])

    updated = _sample_user()
    updated["given_name"] = "Alicia"
    upsert_users(db_conn, [updated])

    with db_conn.cursor() as cur:
        cur.execute("SELECT given_name FROM users")
        assert cur.fetchone()[0] == "Alicia"

    with db_conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM users")
        assert cur.fetchone()[0] == 1


def test_upsert_chats_inserts(db_conn):
    from db import init_schema, upsert_users, upsert_chats

    init_schema(db_conn)
    upsert_users(db_conn, [_sample_user()])
    upsert_chats(db_conn, [_sample_chat()])

    with db_conn.cursor() as cur:
        cur.execute("SELECT title, user_id FROM chats")
        row = cur.fetchone()

    assert row[0] == "Test Chat"
    assert str(row[1]) == "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


def test_upsert_chats_updates_existing(db_conn):
    from db import init_schema, upsert_users, upsert_chats

    init_schema(db_conn)
    upsert_users(db_conn, [_sample_user()])
    upsert_chats(db_conn, [_sample_chat()])

    updated = _sample_chat()
    updated["title"] = "Renamed Chat"
    updated["updated_at"] = datetime(2026, 4, 2, tzinfo=timezone.utc)
    upsert_chats(db_conn, [updated])

    with db_conn.cursor() as cur:
        cur.execute("SELECT title FROM chats")
        assert cur.fetchone()[0] == "Renamed Chat"

    with db_conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM chats")
        assert cur.fetchone()[0] == 1


def test_insert_messages(db_conn):
    from db import init_schema, upsert_users, upsert_chats, insert_messages

    init_schema(db_conn)
    upsert_users(db_conn, [_sample_user()])
    upsert_chats(db_conn, [_sample_chat()])
    insert_messages(db_conn, [_sample_message()])

    with db_conn.cursor() as cur:
        cur.execute('SELECT role, "order" FROM messages')
        row = cur.fetchone()

    assert row[0] == "USER"
    assert row[1] == 1


def test_insert_messages_skips_duplicates(db_conn):
    from db import init_schema, upsert_users, upsert_chats, insert_messages

    init_schema(db_conn)
    upsert_users(db_conn, [_sample_user()])
    upsert_chats(db_conn, [_sample_chat()])
    insert_messages(db_conn, [_sample_message()])
    insert_messages(db_conn, [_sample_message()])

    with db_conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM messages")
        assert cur.fetchone()[0] == 1


def test_insert_message_parts(db_conn):
    from db import init_schema, upsert_users, upsert_chats, insert_messages, insert_message_parts

    init_schema(db_conn)
    upsert_users(db_conn, [_sample_user()])
    upsert_chats(db_conn, [_sample_chat()])
    insert_messages(db_conn, [_sample_message()])
    insert_message_parts(db_conn, [_sample_message_part()])

    with db_conn.cursor() as cur:
        cur.execute("SELECT content->>'type', content->>'text' FROM message_parts")
        row = cur.fetchone()

    assert row[0] == "text"
    assert row[1] == "Hello world"


def test_insert_message_parts_skips_duplicates(db_conn):
    from db import init_schema, upsert_users, upsert_chats, insert_messages, insert_message_parts

    init_schema(db_conn)
    upsert_users(db_conn, [_sample_user()])
    upsert_chats(db_conn, [_sample_chat()])
    insert_messages(db_conn, [_sample_message()])
    insert_message_parts(db_conn, [_sample_message_part()])
    insert_message_parts(db_conn, [_sample_message_part()])

    with db_conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM message_parts")
        assert cur.fetchone()[0] == 1
