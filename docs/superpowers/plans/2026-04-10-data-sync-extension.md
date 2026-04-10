# Data Sync Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the observer pipeline to sync app data (users, chats, messages, message_parts) from the cellbyte DB into the observer DB, so the upcoming Next.js app can query a single database.

**Architecture:** New `app_sync.py` module reads from cellbyte DB and writes to observer DB. Existing `db.py` gains new tables, indexes, and the `chat_uuid` → `message_id` rename. `main.py` orchestrates both app sync and temporal sync. All DB connections configurable via env vars.

**Tech Stack:** Python 3.12+, psycopg v3, PostgreSQL 17

---

## File Structure

| File | Changes |
|---|---|
| `docker-compose.yml` | Change port from 5432 to 5436 |
| `db.py` | Add new tables (users, chats, messages, message_parts, sync_state), rename chat_uuid → message_id, add indexes |
| `app_sync.py` | New module — reads from app DB, writes to observer DB |
| `main.py` | Use `OBSERVER_DATABASE_URL` and `APP_DATABASE_URL` env vars, orchestrate both syncs, make sync callable as a function |
| `tests/test_db.py` | Update DSN port, update tests for message_id rename, add tests for new tables |
| `tests/test_app_sync.py` | Tests for app sync write functions |

---

### Task 1: Port Migration

**Files:**
- Modify: `docker-compose.yml`
- Modify: `main.py`
- Modify: `tests/test_db.py`

- [ ] **Step 1: Update `docker-compose.yml` port to 5436**

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_DB: observer
      POSTGRES_USER: observer
      POSTGRES_PASSWORD: observer
    ports:
      - "5436:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

- [ ] **Step 2: Update `main.py` to use `OBSERVER_DATABASE_URL` env var**

Replace the `POSTGRES_DSN` block (lines 26-32) with:

```python
OBSERVER_DATABASE_URL = os.environ.get(
    "OBSERVER_DATABASE_URL",
    "postgresql://observer:observer@localhost:5436/observer",
)
```

And update `psycopg.connect(POSTGRES_DSN)` to `psycopg.connect(OBSERVER_DATABASE_URL)` on line 45.

- [ ] **Step 3: Update `tests/test_db.py` DSN**

Replace line 4:

```python
POSTGRES_DSN = "postgresql://observer:observer@localhost:5436/observer"
```

- [ ] **Step 4: Recreate the Postgres container on the new port and verify tests pass**

```bash
docker compose down
docker compose up -d
sleep 3
uv run pytest tests/test_db.py -v
```

Expected: All 10 tests PASS. Note: existing data is lost (volume recreated) — we'll re-sync later.

---

### Task 2: Schema Extension — New Tables, Rename, Indexes

**Files:**
- Modify: `db.py`
- Modify: `tests/test_db.py`

- [ ] **Step 1: Write failing tests for new tables**

Add to `tests/test_db.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_db.py::test_init_schema_creates_all_tables -v`
Expected: FAIL — missing tables

- [ ] **Step 3: Update `SCHEMA_SQL` in `db.py`**

Replace the entire `SCHEMA_SQL` constant with:

```python
SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
    id          UUID PRIMARY KEY,
    auth_id     TEXT UNIQUE NOT NULL,
    email       TEXT,
    given_name  TEXT,
    family_name TEXT,
    is_suspended BOOLEAN NOT NULL DEFAULT false,
    deleted_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS chats (
    id          UUID PRIMARY KEY,
    title       TEXT,
    created_at  TIMESTAMPTZ NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL,
    deleted_at  TIMESTAMPTZ,
    user_id     UUID NOT NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS messages (
    id          UUID PRIMARY KEY,
    "order"     INTEGER NOT NULL,
    role        TEXT NOT NULL,
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL,
    chat_id     UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS message_parts (
    id          UUID PRIMARY KEY,
    "order"     INTEGER NOT NULL,
    content     JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL,
    message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workflows (
    id              SERIAL PRIMARY KEY,
    workflow_id     TEXT UNIQUE NOT NULL,
    message_id      UUID NOT NULL,
    run_id          TEXT NOT NULL,
    status          TEXT NOT NULL,
    start_time      TIMESTAMPTZ NOT NULL,
    end_time        TIMESTAMPTZ,
    input           JSONB,
    output          JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activities (
    id              SERIAL PRIMARY KEY,
    workflow_id     TEXT NOT NULL REFERENCES workflows(workflow_id),
    activity_id     TEXT NOT NULL,
    activity_type   TEXT NOT NULL,
    status          TEXT NOT NULL,
    scheduled_time  TIMESTAMPTZ,
    started_time    TIMESTAMPTZ,
    completed_time  TIMESTAMPTZ,
    input           JSONB,
    output          JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workflow_id, activity_id)
);

CREATE TABLE IF NOT EXISTS sync_state (
    entity       TEXT PRIMARY KEY,
    last_sync_at TIMESTAMPTZ NOT NULL
);
"""

INDEXES_SQL = """
CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_chat_id_order ON messages(chat_id, "order");
CREATE INDEX IF NOT EXISTS idx_message_parts_message_id_order ON message_parts(message_id, "order");
CREATE INDEX IF NOT EXISTS idx_workflows_message_id ON workflows(message_id);
CREATE INDEX IF NOT EXISTS idx_activities_workflow_id ON activities(workflow_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_given_name ON users(given_name);
CREATE INDEX IF NOT EXISTS idx_users_family_name ON users(family_name);
CREATE INDEX IF NOT EXISTS idx_message_parts_content_text ON message_parts USING GIN (to_tsvector('english', content->>'text')) WHERE content->>'type' = 'text';
"""
```

- [ ] **Step 4: Update `init_schema` to also create indexes**

```python
def init_schema(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute(SCHEMA_SQL)
        cur.execute(INDEXES_SQL)
    conn.commit()
```

- [ ] **Step 5: Update `UPSERT_WORKFLOW_SQL` to use `message_id`**

```python
UPSERT_WORKFLOW_SQL = """
INSERT INTO workflows (workflow_id, message_id, run_id, status, start_time, end_time, input, output)
VALUES (%(workflow_id)s, %(message_id)s, %(run_id)s, %(status)s, %(start_time)s, %(end_time)s, %(input)s, %(output)s)
ON CONFLICT (workflow_id) DO UPDATE SET
    status = EXCLUDED.status,
    end_time = EXCLUDED.end_time,
    input = EXCLUDED.input,
    output = EXCLUDED.output
WHERE workflows.status NOT IN ('COMPLETED', 'FAILED', 'CANCELED', 'TERMINATED', 'TIMED_OUT')
"""
```

- [ ] **Step 6: Update `_sample_workflow` in tests and all references from `chat_uuid` to `message_id`**

In `tests/test_db.py`, update the `_sample_workflow` helper:

```python
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
    }
```

- [ ] **Step 7: Update `db_conn` fixture to drop all tables**

```python
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
```

- [ ] **Step 8: Update `main.py` to use `message_id` instead of `chat_uuid`**

Rename `_extract_uuid` to `_extract_message_id`:

```python
def _extract_message_id(workflow_id: str) -> str:
    """Extract message UUID from workflow_id like 'chat-9e138348-...'."""
    return workflow_id.removeprefix("chat-")
```

Update the workflow_data dict (around line 77-86):

```python
                workflow_data = {
                    "workflow_id": wf_id,
                    "message_id": _extract_message_id(wf_id),
                    "run_id": wf["run_id"],
                    "status": wf["status"],
                    "start_time": wf["start_time"],
                    "end_time": wf["close_time"],
                    "input": None,
                    "output": None,
                }
```

- [ ] **Step 9: Run all tests**

```bash
uv run pytest -v
```

Expected: All tests PASS (existing tests updated + new table test passes)

---

### Task 3: Sync State Helpers

**Files:**
- Modify: `db.py`
- Modify: `tests/test_db.py`

- [ ] **Step 1: Write failing tests for sync state functions**

Add to `tests/test_db.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_db.py::test_get_last_sync_returns_none_for_new_entity -v`
Expected: FAIL with `ImportError: cannot import name 'get_last_sync'`

- [ ] **Step 3: Implement sync state functions in `db.py`**

Add to `db.py`:

```python
from datetime import datetime


def get_last_sync(conn: psycopg.Connection, entity: str) -> datetime | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT last_sync_at FROM sync_state WHERE entity = %s",
            (entity,),
        )
        row = cur.fetchone()
    return row[0] if row else None


def update_last_sync(conn: psycopg.Connection, entity: str, ts: datetime) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO sync_state (entity, last_sync_at) VALUES (%s, %s) "
            "ON CONFLICT (entity) DO UPDATE SET last_sync_at = EXCLUDED.last_sync_at",
            (entity, ts),
        )
    conn.commit()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_db.py -v`
Expected: All tests PASS

---

### Task 4: App Data Upsert Functions

**Files:**
- Modify: `db.py`
- Modify: `tests/test_db.py`

- [ ] **Step 1: Write failing tests for user upsert**

Add to `tests/test_db.py`:

```python
import uuid


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
    insert_messages(db_conn, [_sample_message()])  # duplicate

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
    insert_message_parts(db_conn, [_sample_message_part()])  # duplicate

    with db_conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM message_parts")
        assert cur.fetchone()[0] == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_db.py::test_upsert_users_inserts -v`
Expected: FAIL with `ImportError: cannot import name 'upsert_users'`

- [ ] **Step 3: Implement upsert/insert functions in `db.py`**

Add to `db.py`:

```python
UPSERT_USER_SQL = """
INSERT INTO users (id, auth_id, email, given_name, family_name, is_suspended, deleted_at)
VALUES (%(id)s, %(auth_id)s, %(email)s, %(given_name)s, %(family_name)s, %(is_suspended)s, %(deleted_at)s)
ON CONFLICT (id) DO UPDATE SET
    auth_id = EXCLUDED.auth_id,
    email = EXCLUDED.email,
    given_name = EXCLUDED.given_name,
    family_name = EXCLUDED.family_name,
    is_suspended = EXCLUDED.is_suspended,
    deleted_at = EXCLUDED.deleted_at
"""


def upsert_users(conn: psycopg.Connection, users: list[dict[str, Any]]) -> None:
    with conn.cursor() as cur:
        for user in users:
            cur.execute(UPSERT_USER_SQL, user)
    conn.commit()


UPSERT_CHAT_SQL = """
INSERT INTO chats (id, title, created_at, updated_at, deleted_at, user_id)
VALUES (%(id)s, %(title)s, %(created_at)s, %(updated_at)s, %(deleted_at)s, %(user_id)s)
ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    updated_at = EXCLUDED.updated_at,
    deleted_at = EXCLUDED.deleted_at
"""


def upsert_chats(conn: psycopg.Connection, chats: list[dict[str, Any]]) -> None:
    with conn.cursor() as cur:
        for chat in chats:
            cur.execute(UPSERT_CHAT_SQL, chat)
    conn.commit()


INSERT_MESSAGE_SQL = """
INSERT INTO messages (id, "order", role, metadata, created_at, chat_id)
VALUES (%(id)s, %(order)s, %(role)s, %(metadata)s, %(created_at)s, %(chat_id)s)
ON CONFLICT (id) DO NOTHING
"""


def insert_messages(conn: psycopg.Connection, messages: list[dict[str, Any]]) -> None:
    with conn.cursor() as cur:
        for msg in messages:
            params = {
                **msg,
                "metadata": json.dumps(msg["metadata"]) if msg["metadata"] is not None else None,
            }
            cur.execute(INSERT_MESSAGE_SQL, params)
    conn.commit()


INSERT_MESSAGE_PART_SQL = """
INSERT INTO message_parts (id, "order", content, created_at, message_id)
VALUES (%(id)s, %(order)s, %(content)s, %(created_at)s, %(message_id)s)
ON CONFLICT (id) DO NOTHING
"""


def insert_message_parts(conn: psycopg.Connection, parts: list[dict[str, Any]]) -> None:
    with conn.cursor() as cur:
        for part in parts:
            params = {
                **part,
                "content": json.dumps(part["content"]),
            }
            cur.execute(INSERT_MESSAGE_PART_SQL, params)
    conn.commit()
```

- [ ] **Step 4: Run all tests**

Run: `uv run pytest -v`
Expected: All tests PASS

---

### Task 5: App Sync Module

**Files:**
- Create: `app_sync.py`

- [ ] **Step 1: Create `app_sync.py`**

This module reads from the cellbyte app DB and writes to the observer DB using the functions from `db.py`.

```python
from __future__ import annotations

import logging
from datetime import datetime, timezone

import psycopg

from db import (
    get_last_sync,
    insert_message_parts,
    insert_messages,
    update_last_sync,
    upsert_chats,
    upsert_users,
)

logger = logging.getLogger(__name__)

# Epoch used as default "beginning of time" for first sync
EPOCH = datetime(2000, 1, 1, tzinfo=timezone.utc)


def sync_users(app_conn: psycopg.Connection, observer_conn: psycopg.Connection) -> int:
    """Full upsert of all users from app DB to observer DB."""
    with app_conn.cursor() as cur:
        cur.execute(
            'SELECT id, "authId", email, "givenName", "familyName", '
            '"isSuspended", "deletedAt" FROM "User"'
        )
        rows = cur.fetchall()

    users = [
        {
            "id": str(row[0]),
            "auth_id": row[1],
            "email": row[2],
            "given_name": row[3],
            "family_name": row[4],
            "is_suspended": row[5],
            "deleted_at": row[6],
        }
        for row in rows
    ]

    if users:
        upsert_users(observer_conn, users)

    now = datetime.now(timezone.utc)
    update_last_sync(observer_conn, "users", now)
    logger.info("Synced %d users", len(users))
    return len(users)


def sync_chats(app_conn: psycopg.Connection, observer_conn: psycopg.Connection) -> int:
    """Incremental upsert of chats updated since last sync."""
    last_sync = get_last_sync(observer_conn, "chats") or EPOCH

    with app_conn.cursor() as cur:
        cur.execute(
            'SELECT id, title, "createdAt", "updatedAt", "deletedAt", "userId" '
            'FROM "Chat" WHERE "updatedAt" > %s ORDER BY "updatedAt"',
            (last_sync,),
        )
        rows = cur.fetchall()

    chats = [
        {
            "id": str(row[0]),
            "title": row[1],
            "created_at": row[2],
            "updated_at": row[3],
            "deleted_at": row[4],
            "user_id": str(row[5]),
        }
        for row in rows
    ]

    if chats:
        upsert_chats(observer_conn, chats)

    now = datetime.now(timezone.utc)
    update_last_sync(observer_conn, "chats", now)
    logger.info("Synced %d chats (since %s)", len(chats), last_sync)
    return len(chats)


def sync_messages(app_conn: psycopg.Connection, observer_conn: psycopg.Connection) -> int:
    """Incremental insert of messages created since last sync."""
    last_sync = get_last_sync(observer_conn, "messages") or EPOCH

    with app_conn.cursor() as cur:
        cur.execute(
            'SELECT id, "order", role, metadata, "createdAt", "chatId" '
            'FROM "Message" WHERE "createdAt" > %s ORDER BY "createdAt"',
            (last_sync,),
        )
        rows = cur.fetchall()

    messages = [
        {
            "id": str(row[0]),
            "order": row[1],
            "role": row[2],
            "metadata": row[3],
            "created_at": row[4],
            "chat_id": str(row[5]),
        }
        for row in rows
    ]

    if messages:
        insert_messages(observer_conn, messages)

    now = datetime.now(timezone.utc)
    update_last_sync(observer_conn, "messages", now)
    logger.info("Synced %d messages (since %s)", len(messages), last_sync)
    return len(messages)


def sync_message_parts(app_conn: psycopg.Connection, observer_conn: psycopg.Connection) -> int:
    """Incremental insert of message parts created since last sync."""
    last_sync = get_last_sync(observer_conn, "message_parts") or EPOCH

    with app_conn.cursor() as cur:
        cur.execute(
            'SELECT id, "order", content, "createdAt", "messageId" '
            'FROM "MessagePart" WHERE "createdAt" > %s ORDER BY "createdAt"',
            (last_sync,),
        )
        rows = cur.fetchall()

    parts = [
        {
            "id": str(row[0]),
            "order": row[1],
            "content": row[2],
            "created_at": row[3],
            "message_id": str(row[4]),
        }
        for row in rows
    ]

    if parts:
        insert_message_parts(observer_conn, parts)

    now = datetime.now(timezone.utc)
    update_last_sync(observer_conn, "message_parts", now)
    logger.info("Synced %d message parts (since %s)", len(parts), last_sync)
    return len(parts)


def sync_app_data(app_conn: psycopg.Connection, observer_conn: psycopg.Connection) -> None:
    """Run all app data syncs in order (respecting FK dependencies)."""
    sync_users(app_conn, observer_conn)
    sync_chats(app_conn, observer_conn)
    sync_messages(app_conn, observer_conn)
    sync_message_parts(app_conn, observer_conn)
```

- [ ] **Step 2: Verify it imports cleanly**

Run: `uv run python -c "import app_sync; print('ok')"`
Expected: `ok`

---

### Task 6: Updated Main Orchestration

**Files:**
- Modify: `main.py`

- [ ] **Step 1: Rewrite `main.py` to orchestrate both syncs**

Replace the entire contents of `main.py`:

```python
from __future__ import annotations

import asyncio
import logging
import os

import psycopg

from app_sync import sync_app_data
from db import TERMINAL_STATUSES, init_schema, is_workflow_terminal, upsert_activities, upsert_workflow
from temporal_client import (
    _decode_payloads,
    fetch_workflow_history,
    get_client,
    list_chat_workflow_ids,
    parse_activities_from_history,
)
from temporalio.api.enums.v1 import EventType

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

OBSERVER_DATABASE_URL = os.environ.get(
    "OBSERVER_DATABASE_URL",
    "postgresql://observer:observer@localhost:5436/observer",
)
APP_DATABASE_URL = os.environ.get(
    "APP_DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/cellbyte",
)


def _extract_message_id(workflow_id: str) -> str:
    """Extract message UUID from workflow_id like 'chat-9e138348-...'."""
    return workflow_id.removeprefix("chat-")


async def sync_temporal_data(observer_conn: psycopg.Connection) -> None:
    """Sync workflow and activity data from Temporal into observer DB."""
    logger.info("Connecting to Temporal...")
    temporal_client = await get_client()

    logger.info("Listing chat workflows from Temporal...")
    workflows = await list_chat_workflow_ids(temporal_client)
    logger.info("Found %d chat workflows", len(workflows))

    ingested = 0
    skipped = 0

    for wf in workflows:
        wf_id = wf["workflow_id"]

        if wf["status"] not in TERMINAL_STATUSES:
            logger.debug("Skipping non-terminal workflow %s (status=%s)", wf_id, wf["status"])
            skipped += 1
            continue

        if is_workflow_terminal(observer_conn, wf_id):
            skipped += 1
            continue

        try:
            logger.info("Processing workflow %s", wf_id)
            events = await fetch_workflow_history(
                temporal_client, wf_id, wf["run_id"]
            )

            activities = parse_activities_from_history(events)

            workflow_data = {
                "workflow_id": wf_id,
                "message_id": _extract_message_id(wf_id),
                "run_id": wf["run_id"],
                "status": wf["status"],
                "start_time": wf["start_time"],
                "end_time": wf["close_time"],
                "input": None,
                "output": None,
            }

            for event in events:
                if event.event_type == EventType.EVENT_TYPE_WORKFLOW_EXECUTION_STARTED:
                    attrs = event.workflow_execution_started_event_attributes
                    workflow_data["input"] = _decode_payloads(attrs.input.payloads)
                elif event.event_type == EventType.EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED:
                    attrs = event.workflow_execution_completed_event_attributes
                    workflow_data["output"] = _decode_payloads(attrs.result.payloads)

            upsert_workflow(observer_conn, workflow_data)

            for act in activities:
                act["workflow_id"] = wf_id
            upsert_activities(observer_conn, activities)

            ingested += 1
        except Exception:
            logger.exception("Failed to process workflow %s, skipping", wf_id)
            continue

    logger.info(
        "Temporal sync done. Ingested: %d, Skipped: %d", ingested, skipped
    )


async def run_sync() -> None:
    """Run the full sync pipeline: app data + temporal data."""
    logger.info("Connecting to observer DB...")
    observer_conn = psycopg.connect(OBSERVER_DATABASE_URL)

    try:
        init_schema(observer_conn)

        # Sync app data (users, chats, messages, message_parts)
        try:
            logger.info("Connecting to app DB...")
            app_conn = psycopg.connect(APP_DATABASE_URL)
            try:
                sync_app_data(app_conn, observer_conn)
            finally:
                app_conn.close()
        except Exception:
            logger.exception("App data sync failed, continuing with temporal sync")

        # Sync temporal data (workflows, activities)
        await sync_temporal_data(observer_conn)

    finally:
        observer_conn.close()


def main() -> None:
    asyncio.run(run_sync())


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verify it imports cleanly**

Run: `uv run python -c "import main; print('ok')"`
Expected: `ok`

- [ ] **Step 3: Run all tests**

Run: `uv run pytest -v`
Expected: All tests PASS

---

### Task 7: Integration Test

- [ ] **Step 1: Ensure both databases are running**

```bash
docker compose up -d
cd /mnt/cellbyte && docker compose up -d db && cd /mnt/observer_app
sleep 3
docker compose ps
```

Expected: observer postgres on 5436, cellbyte db on 5432

- [ ] **Step 2: Run the full sync**

```bash
uv run python main.py
```

Expected: Log output showing users, chats, messages, message_parts synced from app DB, then workflows and activities synced from Temporal.

- [ ] **Step 3: Verify data in observer DB**

```bash
docker compose exec postgres psql -U observer -d observer -c "SELECT count(*) as users FROM users;"
docker compose exec postgres psql -U observer -d observer -c "SELECT count(*) as chats FROM chats;"
docker compose exec postgres psql -U observer -d observer -c "SELECT count(*) as messages FROM messages;"
docker compose exec postgres psql -U observer -d observer -c "SELECT count(*) as message_parts FROM message_parts;"
docker compose exec postgres psql -U observer -d observer -c "SELECT count(*) as workflows FROM workflows;"
docker compose exec postgres psql -U observer -d observer -c "SELECT count(*) as activities FROM activities;"
docker compose exec postgres psql -U observer -d observer -c "SELECT entity, last_sync_at FROM sync_state ORDER BY entity;"
```

- [ ] **Step 4: Run again to verify idempotency**

```bash
uv run python main.py
```

Expected: Users re-synced (full upsert), chats/messages/message_parts show 0 new (incremental), workflows all skipped.

- [ ] **Step 5: Verify a message links to a workflow**

```bash
docker compose exec postgres psql -U observer -d observer -c "
  SELECT m.id as message_id, m.role, w.workflow_id, w.status
  FROM messages m
  JOIN workflows w ON w.message_id = m.id
  LIMIT 5;
"
```

Expected: Rows showing messages joined with their workflows.
