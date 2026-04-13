"""add openai gpt-5.4 and anthropic claude model pricing

Revision ID: 9b9d1b503cd6
Revises: f17e8667f3bf
Create Date: 2026-04-13 08:34:54.895830

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9b9d1b503cd6'
down_revision: Union[str, Sequence[str], None] = 'f17e8667f3bf'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
    INSERT INTO model_pricing (model_id, input_price, output_price, cache_read_price, reasoning_price)
    VALUES
        ('openai:gpt-5.4', 2.50, 15.00, 1.25, 15.00),
        ('openai:gpt-5.4-mini', 0.75, 4.50, 0.375, 4.50),
        ('openai:gpt-5.4-nano', 0.20, 1.25, 0.10, 1.25),
        ('anthropic:claude-opus-4-6', 5.00, 25.00, 0.50, 25.00),
        ('anthropic:claude-sonnet-4-6', 3.00, 15.00, 0.30, 15.00),
        ('anthropic:claude-haiku-4-5', 1.00, 5.00, 0.10, 5.00)
    ON CONFLICT (model_id) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("""
    DELETE FROM model_pricing
    WHERE model_id IN (
        'openai:gpt-5.4', 'openai:gpt-5.4-mini', 'openai:gpt-5.4-nano',
        'anthropic:claude-opus-4-6', 'anthropic:claude-sonnet-4-6', 'anthropic:claude-haiku-4-5'
    )
    """)
