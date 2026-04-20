"""relax workflows run_id

Revision ID: 29f546657002
Revises: e3b75685e208
Create Date: 2026-04-20 12:07:54.219046

"""
from alembic import op
import sqlalchemy as sa


revision = "29f546657002"
down_revision = "e3b75685e208"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("workflows", "run_id", existing_type=sa.Text(), nullable=True)


def downgrade() -> None:
    op.execute("UPDATE workflows SET run_id = '' WHERE run_id IS NULL")
    op.alter_column("workflows", "run_id", existing_type=sa.Text(), nullable=False)
