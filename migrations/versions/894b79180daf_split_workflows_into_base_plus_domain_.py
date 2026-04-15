"""split workflows into base plus domain tables

Revision ID: 894b79180daf
Revises: d7c3b358ccae
Create Date: 2026-04-15 13:09:09.604019

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '894b79180daf'
down_revision: Union[str, Sequence[str], None] = 'd7c3b358ccae'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create chat_workflows table (IF NOT EXISTS for idempotency — init_schema may have created it)
    op.execute("""
    CREATE TABLE IF NOT EXISTS chat_workflows (
        id              SERIAL PRIMARY KEY,
        workflow_id     TEXT UNIQUE NOT NULL REFERENCES workflows(workflow_id),
        message_id      UUID
    );
    """)

    # 2. Populate from existing data (only rows not already migrated)
    op.execute("""
    INSERT INTO chat_workflows (workflow_id, message_id)
    SELECT workflow_id, message_id
    FROM workflows
    WHERE message_id IS NOT NULL
      AND workflow_id NOT IN (SELECT workflow_id FROM chat_workflows)
    ON CONFLICT (workflow_id) DO NOTHING;
    """)

    # 3. Create column_generation_workflows table
    op.execute("""
    CREATE TABLE IF NOT EXISTS column_generation_workflows (
        id              SERIAL PRIMARY KEY,
        workflow_id     TEXT UNIQUE NOT NULL REFERENCES workflows(workflow_id),
        batch_id        UUID NOT NULL,
        user_id         UUID REFERENCES users(id),
        metadata        JSONB
    );
    """)

    # 4. Drop message_id from workflows (IF EXISTS for idempotency)
    op.execute("DROP INDEX IF EXISTS idx_workflows_message_id;")
    op.execute("ALTER TABLE workflows DROP COLUMN IF EXISTS message_id;")

    # 5. Create indexes
    op.execute("CREATE INDEX IF NOT EXISTS idx_chat_workflows_message_id ON chat_workflows(message_id);")
    op.execute("CREATE INDEX IF NOT EXISTS idx_column_generation_workflows_batch_id ON column_generation_workflows(batch_id);")
    op.execute("CREATE INDEX IF NOT EXISTS idx_column_generation_workflows_user_id ON column_generation_workflows(user_id);")


def downgrade() -> None:
    op.execute("ALTER TABLE workflows ADD COLUMN message_id UUID;")
    op.execute("""
    UPDATE workflows w
    SET message_id = cw.message_id
    FROM chat_workflows cw
    WHERE w.workflow_id = cw.workflow_id;
    """)
    op.execute("CREATE INDEX idx_workflows_message_id ON workflows(message_id);")
    op.execute("DROP TABLE IF EXISTS column_generation_workflows;")
    op.execute("DROP TABLE IF EXISTS chat_workflows;")
