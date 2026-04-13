"""add settings table

Revision ID: d7c3b358ccae
Revises: 9b9d1b503cd6
Create Date: 2026-04-13 08:37:13.857154

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd7c3b358ccae'
down_revision: Union[str, Sequence[str], None] = '9b9d1b503cd6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    INSERT INTO settings (key, value) VALUES ('auto_sync_enabled', 'false')
    ON CONFLICT (key) DO NOTHING;
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS settings;")
