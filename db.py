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
    message_id          UUID,
    parent_workflow_id  TEXT REFERENCES workflows(workflow_id),
    workflow_name       TEXT,
    run_id              TEXT NOT NULL,
    status              TEXT NOT NULL,
    start_time          TIMESTAMPTZ NOT NULL,
    end_time            TIMESTAMPTZ,
    input               JSONB,
    output              JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
CREATE INDEX IF NOT EXISTS idx_workflows_message_id ON workflows(message_id);
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
ALTER TABLE workflows ALTER COLUMN message_id DROP NOT NULL;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 1;
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
        # Remove users not in source (handles switching between environments)
        if source_ids:
            cur.execute(
                "DELETE FROM users WHERE id != ALL(%s)",
                (source_ids,),
            )
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


TERMINAL_STATUSES = frozenset({
    "COMPLETED", "FAILED", "CANCELED", "TERMINATED", "TIMED_OUT",
})

UPSERT_WORKFLOW_SQL = """
INSERT INTO workflows (workflow_id, message_id, parent_workflow_id, workflow_name, run_id, status, start_time, end_time, input, output)
VALUES (%(workflow_id)s, %(message_id)s, %(parent_workflow_id)s, %(workflow_name)s, %(run_id)s, %(status)s, %(start_time)s, %(end_time)s, %(input)s, %(output)s)
ON CONFLICT (workflow_id) DO UPDATE SET
    status = EXCLUDED.status,
    end_time = EXCLUDED.end_time,
    input = EXCLUDED.input,
    output = EXCLUDED.output
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
    conn.commit()


UPSERT_ACTIVITY_SQL = """
INSERT INTO activities (workflow_id, activity_id, activity_type, status, attempt, scheduled_time, started_time, completed_time, input, output)
VALUES (%(workflow_id)s, %(activity_id)s, %(activity_type)s, %(status)s, %(attempt)s, %(scheduled_time)s, %(started_time)s, %(completed_time)s, %(input)s, %(output)s)
ON CONFLICT (workflow_id, activity_id) DO NOTHING
"""


def upsert_activities(conn: psycopg.Connection, activities: list[dict[str, Any]]) -> None:
    with conn.cursor() as cur:
        for activity in activities:
            params = {
                **activity,
                "input": json.dumps(activity["input"]) if activity["input"] is not None else None,
                "output": json.dumps(activity["output"]) if activity["output"] is not None else None,
            }
            cur.execute(UPSERT_ACTIVITY_SQL, params)
    conn.commit()


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
