from __future__ import annotations

import json
from datetime import datetime
from typing import Any

import psycopg

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
    id                  SERIAL PRIMARY KEY,
    workflow_id         TEXT UNIQUE NOT NULL,
    parent_workflow_id  TEXT REFERENCES workflows(workflow_id),
    workflow_name       TEXT,
    run_id              TEXT,
    status              TEXT NOT NULL,
    start_time          TIMESTAMPTZ NOT NULL,
    end_time            TIMESTAMPTZ,
    input               JSONB,
    output              JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_workflows (
    id              SERIAL PRIMARY KEY,
    workflow_id     TEXT UNIQUE NOT NULL REFERENCES workflows(workflow_id),
    message_id      UUID
);

CREATE TABLE IF NOT EXISTS column_generation_workflows (
    id              SERIAL PRIMARY KEY,
    workflow_id     TEXT UNIQUE NOT NULL REFERENCES workflows(workflow_id),
    batch_id        UUID NOT NULL,
    user_id         UUID REFERENCES users(id),
    metadata        JSONB
);

CREATE TABLE IF NOT EXISTS activities (
    id              SERIAL PRIMARY KEY,
    workflow_id     TEXT NOT NULL REFERENCES workflows(workflow_id),
    activity_id     TEXT NOT NULL,
    activity_type   TEXT NOT NULL,
    status          TEXT NOT NULL,
    attempt         INTEGER NOT NULL DEFAULT 1,
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

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_pricing (
    id               SERIAL PRIMARY KEY,
    model_id         TEXT UNIQUE NOT NULL,
    input_price      NUMERIC NOT NULL,
    output_price     NUMERIC NOT NULL,
    cache_read_price NUMERIC,
    reasoning_price  NUMERIC,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

SEED_PRICING_SQL = """
INSERT INTO model_pricing (model_id, input_price, output_price, cache_read_price, reasoning_price)
VALUES
    ('vertex:gemini-3.1-pro-preview', 2.00, 12.00, 0.50, 12.00),
    ('vertex:gemini-3-flash-preview', 0.50, 3.00, 0.125, 3.00)
ON CONFLICT (model_id) DO NOTHING;
"""

INDEXES_SQL = """
CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_chat_id_order ON messages(chat_id, "order");
CREATE INDEX IF NOT EXISTS idx_message_parts_message_id_order ON message_parts(message_id, "order");
CREATE INDEX IF NOT EXISTS idx_chat_workflows_message_id ON chat_workflows(message_id);
CREATE INDEX IF NOT EXISTS idx_column_generation_workflows_batch_id ON column_generation_workflows(batch_id);
CREATE INDEX IF NOT EXISTS idx_column_generation_workflows_user_id ON column_generation_workflows(user_id);
CREATE INDEX IF NOT EXISTS idx_workflows_parent ON workflows(parent_workflow_id);
CREATE INDEX IF NOT EXISTS idx_activities_workflow_id ON activities(workflow_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_given_name ON users(given_name);
CREATE INDEX IF NOT EXISTS idx_users_family_name ON users(family_name);
CREATE INDEX IF NOT EXISTS idx_message_parts_content_text ON message_parts USING GIN (to_tsvector('english', content->>'text')) WHERE content->>'type' = 'text';
"""


MIGRATIONS_SQL = """
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS parent_workflow_id TEXT REFERENCES workflows(workflow_id);
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS workflow_name TEXT;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 1;
ALTER TABLE workflows ALTER COLUMN run_id DROP NOT NULL;
"""


def run_migrations(database_url: str) -> None:
    """Run alembic migrations to ensure schema is up to date."""
    from pathlib import Path

    from alembic import command
    from alembic.config import Config

    alembic_cfg = Config(str(Path(__file__).parent / "alembic.ini"))
    alembic_cfg.set_main_option("script_location", str(Path(__file__).parent / "migrations"))
    dsn = database_url
    if dsn.startswith("postgresql://"):
        dsn = dsn.replace("postgresql://", "postgresql+psycopg://", 1)
    alembic_cfg.set_main_option("sqlalchemy.url", dsn)
    command.upgrade(alembic_cfg, "head")


def init_schema(conn: psycopg.Connection) -> None:
    """Create schema directly via SQL (for tests and bootstrapping without alembic)."""
    with conn.cursor() as cur:
        cur.execute(SCHEMA_SQL)
        cur.execute(INDEXES_SQL)
        cur.execute(SEED_PRICING_SQL)
    conn.commit()


def seed_data(conn: psycopg.Connection) -> None:
    """Insert seed data (idempotent)."""
    with conn.cursor() as cur:
        cur.execute(SEED_PRICING_SQL)
    conn.commit()


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
    source_ids = [u["id"] for u in users]
    with conn.cursor() as cur:
        for user in users:
            cur.execute(
                "SELECT id FROM users WHERE auth_id = %(auth_id)s AND id != %(id)s",
                user,
            )
            old = cur.fetchone()
            if old:
                old_id = old[0]
                placeholder = f"__migrating__{old_id}"
                cur.execute("UPDATE users SET auth_id = %s WHERE id = %s", (placeholder, old_id))
                cur.execute(UPSERT_USER_SQL, user)
                cur.execute("UPDATE chats SET user_id = %s WHERE user_id = %s", (user["id"], old_id))
                cur.execute("DELETE FROM users WHERE id = %s", (old_id,))
            else:
                cur.execute(UPSERT_USER_SQL, user)
        if source_ids:
            cur.execute(
                "DELETE FROM users WHERE id != ALL(%s) "
                "AND id NOT IN (SELECT DISTINCT user_id FROM chats)",
                (source_ids,),
            )
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


TERMINAL_STATUSES = frozenset({
    "COMPLETED", "FAILED", "CANCELED", "TERMINATED", "TIMED_OUT",
})

UPSERT_WORKFLOW_SQL = """
INSERT INTO workflows (workflow_id, parent_workflow_id, workflow_name, run_id, status, start_time, end_time, input, output)
VALUES (%(workflow_id)s, %(parent_workflow_id)s, %(workflow_name)s, %(run_id)s, %(status)s, %(start_time)s, %(end_time)s, %(input)s, %(output)s)
ON CONFLICT (workflow_id) DO UPDATE SET
    status = EXCLUDED.status,
    run_id = COALESCE(EXCLUDED.run_id, workflows.run_id),
    end_time = EXCLUDED.end_time,
    input = COALESCE(EXCLUDED.input, workflows.input),
    output = COALESCE(EXCLUDED.output, workflows.output)
WHERE workflows.status NOT IN ('COMPLETED', 'FAILED', 'CANCELED', 'TERMINATED', 'TIMED_OUT')
"""


def upsert_workflow(conn: psycopg.Connection, workflow: dict[str, Any]) -> None:
    params = {
        **workflow,
        "input": json.dumps(workflow["input"]) if workflow["input"] is not None else None,
        "output": json.dumps(workflow["output"]) if workflow["output"] is not None else None,
    }
    with conn.cursor() as cur:
        cur.execute(UPSERT_WORKFLOW_SQL, params)


UPSERT_CHAT_WORKFLOW_SQL = """
INSERT INTO chat_workflows (workflow_id, message_id)
VALUES (%(workflow_id)s, %(message_id)s)
ON CONFLICT (workflow_id) DO NOTHING
"""


def upsert_chat_workflow(conn: psycopg.Connection, workflow_id: str, message_id: str) -> None:
    with conn.cursor() as cur:
        cur.execute(UPSERT_CHAT_WORKFLOW_SQL, {"workflow_id": workflow_id, "message_id": message_id})


UPSERT_COLUMN_GENERATION_WORKFLOW_SQL = """
INSERT INTO column_generation_workflows (workflow_id, batch_id, user_id, metadata)
VALUES (%(workflow_id)s, %(batch_id)s, %(user_id)s, %(metadata)s)
ON CONFLICT (workflow_id) DO UPDATE SET
    user_id = COALESCE(EXCLUDED.user_id, column_generation_workflows.user_id),
    metadata = COALESCE(EXCLUDED.metadata, column_generation_workflows.metadata)
"""


def upsert_column_generation_workflow(conn: psycopg.Connection, data: dict[str, Any]) -> None:
    params = {
        **data,
        "metadata": json.dumps(data["metadata"]) if data["metadata"] is not None else None,
    }
    with conn.cursor() as cur:
        cur.execute(UPSERT_COLUMN_GENERATION_WORKFLOW_SQL, params)


UPSERT_ACTIVITY_SQL = """
INSERT INTO activities (workflow_id, activity_id, activity_type, status, attempt, scheduled_time, started_time, completed_time, input, output)
VALUES (%(workflow_id)s, %(activity_id)s, %(activity_type)s, %(status)s, %(attempt)s, %(scheduled_time)s, %(started_time)s, %(completed_time)s, %(input)s, %(output)s)
ON CONFLICT (workflow_id, activity_id) DO UPDATE SET
    status = EXCLUDED.status,
    attempt = EXCLUDED.attempt,
    started_time = EXCLUDED.started_time,
    completed_time = EXCLUDED.completed_time,
    output = EXCLUDED.output
WHERE activities.status NOT IN ('COMPLETED', 'FAILED', 'CANCELED', 'TERMINATED', 'TIMED_OUT')
"""


def upsert_activities(conn: psycopg.Connection, activities: list[dict[str, Any]]) -> None:
    if not activities:
        return
    params_list = [
        {
            **a,
            "input": json.dumps(a["input"]) if a["input"] is not None else None,
            "output": json.dumps(a["output"]) if a["output"] is not None else None,
        }
        for a in activities
    ]
    with conn.cursor() as cur:
        cur.executemany(UPSERT_ACTIVITY_SQL, params_list)


def is_workflow_terminal(conn: psycopg.Connection, workflow_id: str) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT status FROM workflows WHERE workflow_id = %s",
            (workflow_id,),
        )
        row = cur.fetchone()
    if row is None:
        return False
    return row[0] in TERMINAL_STATUSES


def get_terminal_workflow_ids(
    conn: psycopg.Connection, workflow_ids: list[str]
) -> set[str]:
    """Return the subset of workflow_ids already in a terminal status in observer."""
    if not workflow_ids:
        return set()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT workflow_id FROM workflows "
            "WHERE workflow_id = ANY(%s) AND status = ANY(%s)",
            (workflow_ids, list(TERMINAL_STATUSES)),
        )
        return {row[0] for row in cur.fetchall()}


def fetch_nonterminal_root_workflow_ids(
    conn: psycopg.Connection, prefix: str
) -> list[dict[str, Any]]:
    """Return observer's root (parent IS NULL) non-terminal workflows whose
    workflow_id starts with `prefix`. Used to union with Temporal's list so
    workflows that closed in Temporal but haven't been indexed into visibility
    yet still get re-fetched and transitioned.
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT workflow_id, run_id, status, start_time, end_time "
            "FROM workflows "
            "WHERE workflow_id LIKE %s AND parent_workflow_id IS NULL "
            "AND status NOT IN ('COMPLETED', 'FAILED', 'CANCELED', 'TERMINATED', 'TIMED_OUT', 'START_FAILED')",
            (prefix + "%",),
        )
        rows = cur.fetchall()
    return [
        {
            "workflow_id": r[0],
            "run_id": r[1],
            "status": r[2],
            "start_time": r[3],
            "close_time": r[4],
        }
        for r in rows
    ]


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


def get_setting(conn: psycopg.Connection, key: str) -> str | None:
    with conn.cursor() as cur:
        cur.execute("SELECT value FROM settings WHERE key = %s", (key,))
        row = cur.fetchone()
    return row[0] if row else None


def set_setting(conn: psycopg.Connection, key: str, value: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO settings (key, value) VALUES (%s, %s) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (key, value),
        )
    conn.commit()
