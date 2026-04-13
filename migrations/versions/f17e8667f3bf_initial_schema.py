"""initial schema

Revision ID: f17e8667f3bf
Revises: 
Create Date: 2026-04-13 06:50:12.769374

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f17e8667f3bf'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id          UUID PRIMARY KEY,
        auth_id     TEXT UNIQUE NOT NULL,
        email       TEXT,
        given_name  TEXT,
        family_name TEXT,
        is_suspended BOOLEAN NOT NULL DEFAULT false,
        deleted_at  TIMESTAMPTZ
    )""")
    op.execute("""
    CREATE TABLE IF NOT EXISTS chats (
        id          UUID PRIMARY KEY,
        title       TEXT,
        created_at  TIMESTAMPTZ NOT NULL,
        updated_at  TIMESTAMPTZ NOT NULL,
        deleted_at  TIMESTAMPTZ,
        user_id     UUID NOT NULL REFERENCES users(id)
    )""")
    op.execute("""
    CREATE TABLE IF NOT EXISTS messages (
        id          UUID PRIMARY KEY,
        "order"     INTEGER NOT NULL,
        role        TEXT NOT NULL,
        metadata    JSONB,
        created_at  TIMESTAMPTZ NOT NULL,
        chat_id     UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE
    )""")
    op.execute("""
    CREATE TABLE IF NOT EXISTS message_parts (
        id          UUID PRIMARY KEY,
        "order"     INTEGER NOT NULL,
        content     JSONB NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL,
        message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE
    )""")
    op.execute("""
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
    )""")
    op.execute("""
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
    )""")
    op.execute("""
    CREATE TABLE IF NOT EXISTS sync_state (
        entity       TEXT PRIMARY KEY,
        last_sync_at TIMESTAMPTZ NOT NULL
    )""")
    op.execute("""
    CREATE TABLE IF NOT EXISTS model_pricing (
        id               SERIAL PRIMARY KEY,
        model_id         TEXT UNIQUE NOT NULL,
        input_price      NUMERIC NOT NULL,
        output_price     NUMERIC NOT NULL,
        cache_read_price NUMERIC,
        reasoning_price  NUMERIC,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )""")

    # Indexes
    op.execute("CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at DESC)")
    op.execute('CREATE INDEX IF NOT EXISTS idx_messages_chat_id_order ON messages(chat_id, "order")')
    op.execute('CREATE INDEX IF NOT EXISTS idx_message_parts_message_id_order ON message_parts(message_id, "order")')
    op.execute("CREATE INDEX IF NOT EXISTS idx_workflows_message_id ON workflows(message_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_workflows_parent ON workflows(parent_workflow_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_activities_workflow_id ON activities(workflow_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_users_given_name ON users(given_name)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_users_family_name ON users(family_name)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_message_parts_content_text ON message_parts USING GIN (to_tsvector('english', content->>'text')) WHERE content->>'type' = 'text'")

    # Seed model pricing
    op.execute("""
    INSERT INTO model_pricing (model_id, input_price, output_price, cache_read_price, reasoning_price)
    VALUES
        ('vertex:gemini-3.1-pro-preview', 2.00, 12.00, 0.50, 12.00),
        ('vertex:gemini-3-flash-preview', 0.50, 3.00, 0.125, 3.00)
    ON CONFLICT (model_id) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS activities CASCADE")
    op.execute("DROP TABLE IF EXISTS workflows CASCADE")
    op.execute("DROP TABLE IF EXISTS message_parts CASCADE")
    op.execute("DROP TABLE IF EXISTS messages CASCADE")
    op.execute("DROP TABLE IF EXISTS chats CASCADE")
    op.execute("DROP TABLE IF EXISTS users CASCADE")
    op.execute("DROP TABLE IF EXISTS sync_state CASCADE")
    op.execute("DROP TABLE IF EXISTS model_pricing CASCADE")
