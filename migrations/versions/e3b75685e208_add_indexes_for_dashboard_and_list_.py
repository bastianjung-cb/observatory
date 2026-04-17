"""add indexes for dashboard and list query performance

Revision ID: e3b75685e208
Revises: 894b79180daf
Create Date: 2026-04-17 12:52:32.467949

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'e3b75685e208'
down_revision: Union[str, Sequence[str], None] = '894b79180daf'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # CONCURRENTLY avoids locking writes while indexes build. Requires running
    # outside a transaction, hence autocommit_block.
    with op.get_context().autocommit_block():
        # Dashboard cost/token queries all filter activities by
        # activity_type='invokeModel' over a scheduled_time range. Partial
        # index keeps the index small and matches the query shape exactly.
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "idx_activities_invoke_scheduled_time "
            "ON activities(scheduled_time) "
            "WHERE activity_type = 'invokeModel'"
        )

        # Column-generation dashboard + list queries filter/sort workflows
        # by start_time.
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "idx_workflows_start_time "
            "ON workflows(start_time)"
        )

        # getChats computes MAX(messages.created_at) per chat. Composite
        # lets Postgres read the max per chat directly from the index.
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "idx_messages_chat_id_created_at "
            "ON messages(chat_id, created_at DESC)"
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS idx_messages_chat_id_created_at")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS idx_workflows_start_time")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS idx_activities_invoke_scheduled_time")
