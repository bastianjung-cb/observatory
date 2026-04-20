"""add claude-opus-4-7 pricing

Revision ID: b1841590d353
Revises: b65116f293f4
Create Date: 2026-04-20 14:29:42.289060

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b1841590d353'
down_revision: Union[str, Sequence[str], None] = 'b65116f293f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
    INSERT INTO model_pricing (model_id, input_price, output_price, cache_read_price, reasoning_price)
    VALUES ('anthropic:claude-opus-4-7', 5.00, 25.00, 0.50, 25.00)
    ON CONFLICT (model_id) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("DELETE FROM model_pricing WHERE model_id = 'anthropic:claude-opus-4-7'")
