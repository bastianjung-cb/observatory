"""add materialized views

Revision ID: b65116f293f4
Revises: 29f546657002
Create Date: 2026-04-20 13:40:12.119685

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = 'b65116f293f4'
down_revision = '29f546657002'
branch_labels = None
depends_on = None


MV_CHAT_STATS = """
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_chat_stats AS
SELECT
  c.id                                            AS chat_id,
  COUNT(DISTINCT m.id)::int                       AS message_count,
  MAX(m.created_at)                               AS last_message_at,
  COALESCE(SUM(
    CASE WHEN mp.id IS NOT NULL THEN
      (COALESCE((a.output->'usage'->'inputTokens'->>'noCache')::numeric, 0) * mp.input_price
       + COALESCE((a.output->'usage'->'inputTokens'->>'cacheRead')::numeric, 0) * COALESCE(mp.cache_read_price, mp.input_price)
       + COALESCE((a.output->'usage'->'outputTokens'->>'text')::numeric, 0) * mp.output_price
       + COALESCE((a.output->'usage'->'outputTokens'->>'reasoning')::numeric, 0) * COALESCE(mp.reasoning_price, mp.output_price)
      ) / 1000000.0
    ELSE 0 END
  ), 0)::float                                    AS total_cost_usd,
  COALESCE(SUM((a.output->'usage'->'inputTokens'->>'total')::bigint), 0)::bigint   AS total_input_tokens,
  COALESCE(SUM((a.output->'usage'->'outputTokens'->>'total')::bigint), 0)::bigint  AS total_output_tokens,
  COUNT(a.id) FILTER (WHERE a.activity_type = 'invokeModel')::int                  AS llm_calls
FROM chats c
LEFT JOIN messages m        ON m.chat_id = c.id
LEFT JOIN chat_workflows cw ON cw.message_id = m.id
LEFT JOIN activities a      ON a.workflow_id = cw.workflow_id AND a.activity_type = 'invokeModel'
LEFT JOIN model_pricing mp  ON mp.model_id = a.input->>'modelId'
GROUP BY c.id
WITH NO DATA;
"""


MV_COLUMN_CREATION_STATS = """
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_column_creation_stats AS
SELECT
  cgw.workflow_id                                                AS workflow_id,
  cgw.batch_id                                                   AS batch_id,
  cgw.user_id                                                    AS user_id,
  w.status                                                       AS status,
  w.start_time                                                   AS start_time,
  w.end_time                                                     AS end_time,
  cgw.metadata->>'columnName'                                    AS column_name,
  cgw.metadata->>'prompt'                                        AS prompt,
  cgw.metadata->>'variant'                                       AS variant,
  COALESCE((cgw.metadata->>'totalRows')::int, 0)                 AS total_rows,
  COALESCE((cgw.metadata->>'completedRows')::int, 0)             AS completed_rows,
  COALESCE((cgw.metadata->>'failedRows')::int, 0)                AS failed_rows,
  COALESCE(SUM(
    CASE WHEN mp.id IS NOT NULL THEN
      (COALESCE((a.output->'usage'->'inputTokens'->>'noCache')::numeric, 0) * mp.input_price
       + COALESCE((a.output->'usage'->'inputTokens'->>'cacheRead')::numeric, 0) * COALESCE(mp.cache_read_price, mp.input_price)
       + COALESCE((a.output->'usage'->'outputTokens'->>'text')::numeric, 0) * mp.output_price
       + COALESCE((a.output->'usage'->'outputTokens'->>'reasoning')::numeric, 0) * COALESCE(mp.reasoning_price, mp.output_price)
      ) / 1000000.0
    ELSE 0 END
  ), 0)::float                                                   AS total_cost_usd,
  COALESCE(SUM((a.output->'usage'->'inputTokens'->>'total')::bigint), 0)::bigint   AS total_input_tokens,
  COALESCE(SUM((a.output->'usage'->'outputTokens'->>'total')::bigint), 0)::bigint  AS total_output_tokens,
  COUNT(a.id)::int                                               AS llm_calls
FROM column_generation_workflows cgw
JOIN workflows w ON w.workflow_id = cgw.workflow_id
LEFT JOIN workflows child ON child.parent_workflow_id = cgw.workflow_id
LEFT JOIN activities a
  ON a.activity_type = 'invokeModel'
  AND (a.workflow_id = cgw.workflow_id OR a.workflow_id = child.workflow_id)
LEFT JOIN model_pricing mp ON mp.model_id = a.input->>'modelId'
GROUP BY cgw.workflow_id, cgw.batch_id, cgw.user_id, w.status, w.start_time, w.end_time, cgw.metadata
WITH NO DATA;
"""


MV_DAILY_ACTIVITY_STATS = """
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_activity_stats AS
SELECT
  date_trunc('day', a.scheduled_time)::date                                    AS day,
  CASE
    WHEN cw.message_id IS NOT NULL                THEN 'chat'
    WHEN cgw_parent.workflow_id IS NOT NULL       THEN 'colgen'
    WHEN cgw_self.workflow_id IS NOT NULL         THEN 'colgen'
    ELSE 'other'
  END                                                                          AS source,
  COALESCE(c.user_id, cgw_parent.user_id, cgw_self.user_id)                   AS user_id,
  a.input->>'modelId'                                                          AS model_id,
  COALESCE(SUM(
    CASE WHEN mp.id IS NOT NULL THEN
      (COALESCE((a.output->'usage'->'inputTokens'->>'noCache')::numeric, 0) * mp.input_price
       + COALESCE((a.output->'usage'->'inputTokens'->>'cacheRead')::numeric, 0) * COALESCE(mp.cache_read_price, mp.input_price)
       + COALESCE((a.output->'usage'->'outputTokens'->>'text')::numeric, 0) * mp.output_price
       + COALESCE((a.output->'usage'->'outputTokens'->>'reasoning')::numeric, 0) * COALESCE(mp.reasoning_price, mp.output_price)
      ) / 1000000.0
    ELSE 0 END
  ), 0)::float                                                                 AS total_cost_usd,
  COALESCE(SUM((a.output->'usage'->'inputTokens'->>'total')::bigint), 0)::bigint       AS total_input_tokens,
  COALESCE(SUM((a.output->'usage'->'inputTokens'->>'cacheRead')::bigint), 0)::bigint   AS cache_read_tokens,
  COALESCE(SUM((a.output->'usage'->'outputTokens'->>'total')::bigint), 0)::bigint      AS total_output_tokens,
  COALESCE(SUM((a.output->'usage'->'outputTokens'->>'reasoning')::bigint), 0)::bigint  AS reasoning_tokens,
  COUNT(*)::int                                                                AS llm_calls
FROM activities a
LEFT JOIN chat_workflows cw        ON cw.workflow_id = a.workflow_id
LEFT JOIN messages m               ON m.id = cw.message_id
LEFT JOIN chats c                  ON c.id = m.chat_id
LEFT JOIN column_generation_workflows cgw_self ON cgw_self.workflow_id = a.workflow_id
LEFT JOIN workflows wchild         ON wchild.workflow_id = a.workflow_id
LEFT JOIN column_generation_workflows cgw_parent ON cgw_parent.workflow_id = wchild.parent_workflow_id
LEFT JOIN model_pricing mp         ON mp.model_id = a.input->>'modelId'
WHERE a.activity_type = 'invokeModel'
GROUP BY 1, 2, 3, 4
WITH NO DATA;
"""


MV_INDEXES = """
CREATE UNIQUE INDEX IF NOT EXISTS mv_chat_stats_chat_id ON mv_chat_stats(chat_id);
CREATE INDEX IF NOT EXISTS mv_chat_stats_last_message ON mv_chat_stats(last_message_at DESC NULLS LAST);

CREATE UNIQUE INDEX IF NOT EXISTS mv_cgw_stats_workflow_id ON mv_column_creation_stats(workflow_id);
CREATE UNIQUE INDEX IF NOT EXISTS mv_cgw_stats_batch_id ON mv_column_creation_stats(batch_id);
CREATE INDEX IF NOT EXISTS mv_cgw_stats_start_time ON mv_column_creation_stats(start_time DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS mv_cgw_stats_user_id ON mv_column_creation_stats(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS mv_daily_unique ON mv_daily_activity_stats(day, source, user_id, model_id) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS mv_daily_source_day ON mv_daily_activity_stats(source, day DESC);
"""


BASE_TABLE_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_activities_invokemodel ON activities(workflow_id) WHERE activity_type = 'invokeModel';
CREATE INDEX IF NOT EXISTS idx_activities_invokemodel_scheduled ON activities(scheduled_time) WHERE activity_type = 'invokeModel';
CREATE INDEX IF NOT EXISTS idx_chat_workflows_workflow_id ON chat_workflows(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflows_parent_workflow_id_workflow_id ON workflows(parent_workflow_id, workflow_id);
"""


def upgrade() -> None:
    op.execute(MV_CHAT_STATS)
    op.execute(MV_COLUMN_CREATION_STATS)
    op.execute(MV_DAILY_ACTIVITY_STATS)
    op.execute(MV_INDEXES)
    op.execute(BASE_TABLE_INDEXES)


def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS mv_daily_activity_stats")
    op.execute("DROP MATERIALIZED VIEW IF EXISTS mv_column_creation_stats")
    op.execute("DROP MATERIALIZED VIEW IF EXISTS mv_chat_stats")
    op.execute("DROP INDEX IF EXISTS idx_workflows_parent_workflow_id_workflow_id")
    op.execute("DROP INDEX IF EXISTS idx_chat_workflows_workflow_id")
    op.execute("DROP INDEX IF EXISTS idx_activities_invokemodel_scheduled")
    op.execute("DROP INDEX IF EXISTS idx_activities_invokemodel")
