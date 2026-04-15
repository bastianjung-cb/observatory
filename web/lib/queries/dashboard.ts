import pool from "@/lib/db";

export interface DailyCost {
  day: string;
  total_cost: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
}

export interface UserCost {
  user_name: string;
  user_email: string | null;
  total_cost: number;
  message_count: number;
}

export interface CostSummaryCard {
  total_cost: number;
  total_tokens: number;
  total_llm_calls: number;
  total_chats: number;
}

/** Chat-only daily costs. */
export async function getDailyCosts(from: string, to: string): Promise<DailyCost[]> {
  const result = await pool.query(
    `WITH daily AS (
       SELECT
         date_trunc('day', a.scheduled_time) AS day_start,
         COALESCE(SUM(
           CASE WHEN mp.id IS NOT NULL THEN
             (
               COALESCE((a.output->'usage'->'inputTokens'->>'noCache')::numeric, 0) * mp.input_price
               + COALESCE((a.output->'usage'->'inputTokens'->>'cacheRead')::numeric, 0) * COALESCE(mp.cache_read_price, mp.input_price)
               + COALESCE((a.output->'usage'->'outputTokens'->>'text')::numeric, 0) * mp.output_price
               + COALESCE((a.output->'usage'->'outputTokens'->>'reasoning')::numeric, 0) * COALESCE(mp.reasoning_price, mp.output_price)
             ) / 1000000.0
           ELSE 0 END
         ), 0) AS total_cost,
         COALESCE(SUM((a.output->'usage'->'inputTokens'->>'total')::bigint), 0) AS total_input_tokens,
         COALESCE(SUM((a.output->'usage'->'outputTokens'->>'total')::bigint), 0) AS total_output_tokens
       FROM activities a
       LEFT JOIN model_pricing mp ON mp.model_id = a.input->>'modelId'
       WHERE a.activity_type = 'invokeModel'
         AND a.scheduled_time >= $1::timestamptz
         AND a.scheduled_time < ($2::timestamptz + interval '1 day')
       GROUP BY day_start
       ORDER BY day_start
     )
     SELECT
       to_char(day_start, 'YYYY-MM-DD') AS day,
       total_cost::float,
       total_input_tokens::bigint AS total_input_tokens,
       total_output_tokens::bigint AS total_output_tokens,
       (total_input_tokens + total_output_tokens)::bigint AS total_tokens
     FROM daily`,
    [from, to]
  );
  return result.rows;
}

/** Chat-only per-user costs. */
export async function getUserCosts(from: string, to: string, limit = 20): Promise<UserCost[]> {
  const result = await pool.query(
    `SELECT
       COALESCE(u.given_name || ' ' || u.family_name, u.email, 'Unknown') AS user_name,
       u.email AS user_email,
       COALESCE(SUM(
         CASE WHEN mp.id IS NOT NULL THEN
           (
             COALESCE((a.output->'usage'->'inputTokens'->>'noCache')::numeric, 0) * mp.input_price
             + COALESCE((a.output->'usage'->'inputTokens'->>'cacheRead')::numeric, 0) * COALESCE(mp.cache_read_price, mp.input_price)
             + COALESCE((a.output->'usage'->'outputTokens'->>'text')::numeric, 0) * mp.output_price
             + COALESCE((a.output->'usage'->'outputTokens'->>'reasoning')::numeric, 0) * COALESCE(mp.reasoning_price, mp.output_price)
           ) / 1000000.0
         ELSE 0 END
       ), 0)::float AS total_cost,
       COUNT(DISTINCT m.id)::int AS message_count
     FROM users u
     JOIN chats c ON c.user_id = u.id AND c.deleted_at IS NULL
     JOIN messages m ON m.chat_id = c.id
     JOIN chat_workflows cw ON cw.message_id = m.id
     JOIN workflows w ON w.workflow_id = cw.workflow_id
     JOIN activities a ON a.workflow_id = w.workflow_id AND a.activity_type = 'invokeModel'
     LEFT JOIN model_pricing mp ON mp.model_id = a.input->>'modelId'
     WHERE a.scheduled_time >= $1::timestamptz
       AND a.scheduled_time < ($2::timestamptz + interval '1 day')
     GROUP BY u.id, u.given_name, u.family_name, u.email
     ORDER BY total_cost DESC
     LIMIT $3`,
    [from, to, limit]
  );
  return result.rows;
}

/** Chat-only cost summary. */
export async function getCostSummary(from: string, to: string): Promise<CostSummaryCard> {
  const result = await pool.query(
    `SELECT
       COALESCE(SUM(
         CASE WHEN mp.id IS NOT NULL THEN
           (
             COALESCE((a.output->'usage'->'inputTokens'->>'noCache')::numeric, 0) * mp.input_price
             + COALESCE((a.output->'usage'->'inputTokens'->>'cacheRead')::numeric, 0) * COALESCE(mp.cache_read_price, mp.input_price)
             + COALESCE((a.output->'usage'->'outputTokens'->>'text')::numeric, 0) * mp.output_price
             + COALESCE((a.output->'usage'->'outputTokens'->>'reasoning')::numeric, 0) * COALESCE(mp.reasoning_price, mp.output_price)
           ) / 1000000.0
         ELSE 0 END
       ), 0)::float AS total_cost,
       COALESCE(SUM(
         (a.output->'usage'->'inputTokens'->>'total')::bigint
         + (a.output->'usage'->'outputTokens'->>'total')::bigint
       ), 0)::bigint AS total_tokens,
       COUNT(*)::int AS total_llm_calls,
       COUNT(DISTINCT c.id)::int AS total_chats
     FROM activities a
     JOIN workflows w ON w.workflow_id = a.workflow_id
     JOIN chat_workflows cw ON cw.workflow_id = w.workflow_id
     JOIN messages m ON m.id = cw.message_id
     JOIN chats c ON c.id = m.chat_id
     LEFT JOIN model_pricing mp ON mp.model_id = a.input->>'modelId'
     WHERE a.activity_type = 'invokeModel'
       AND a.scheduled_time >= $1::timestamptz
       AND a.scheduled_time < ($2::timestamptz + interval '1 day')`,
    [from, to]
  );
  return result.rows[0];
}

export interface DailyColumnCreationVolume {
  day: string;
  columns_created: number;
  rows_generated: number;
}

export interface DailyColumnCreationCost {
  day: string;
  total_cost: number;
}

export async function getDailyColumnCreationVolume(from: string, to: string): Promise<DailyColumnCreationVolume[]> {
  const result = await pool.query(
    `SELECT
       to_char(date_trunc('day', w.start_time), 'YYYY-MM-DD') AS day,
       COUNT(*)::int AS columns_created,
       COALESCE(SUM((cgw.metadata->>'totalRows')::int), 0)::int AS rows_generated
     FROM column_generation_workflows cgw
     JOIN workflows w ON w.workflow_id = cgw.workflow_id
     WHERE w.start_time >= $1::timestamptz
       AND w.start_time < ($2::timestamptz + interval '1 day')
     GROUP BY date_trunc('day', w.start_time)
     ORDER BY day`,
    [from, to]
  );
  return result.rows;
}

export interface UserColumnCreation {
  user_name: string;
  user_email: string | null;
  columns_created: number;
  rows_generated: number;
}

export async function getUserColumnCreationStats(from: string, to: string, limit = 20): Promise<UserColumnCreation[]> {
  const result = await pool.query(
    `SELECT
       COALESCE(u.given_name || ' ' || u.family_name, u.email, 'Unknown') AS user_name,
       u.email AS user_email,
       COUNT(*)::int AS columns_created,
       COALESCE(SUM((cgw.metadata->>'totalRows')::int), 0)::int AS rows_generated
     FROM column_generation_workflows cgw
     LEFT JOIN users u ON u.id = cgw.user_id
     JOIN workflows w ON w.workflow_id = cgw.workflow_id
     WHERE w.start_time >= $1::timestamptz
       AND w.start_time < ($2::timestamptz + interval '1 day')
     GROUP BY u.id, u.given_name, u.family_name, u.email
     ORDER BY columns_created DESC
     LIMIT $3`,
    [from, to, limit]
  );
  return result.rows;
}

export async function getDailyColumnCreationCosts(from: string, to: string): Promise<DailyColumnCreationCost[]> {
  const result = await pool.query(
    `WITH generation_activities AS (
       SELECT a.*, root.start_time as root_start_time
       FROM column_generation_workflows cgw
       JOIN workflows root ON root.workflow_id = cgw.workflow_id
       JOIN workflows w ON w.workflow_id = cgw.workflow_id OR w.parent_workflow_id = cgw.workflow_id
       JOIN activities a ON a.workflow_id = w.workflow_id AND a.activity_type = 'invokeModel'
       WHERE root.start_time >= $1::timestamptz
         AND root.start_time < ($2::timestamptz + interval '1 day')
     )
     SELECT
       to_char(date_trunc('day', ga.scheduled_time), 'YYYY-MM-DD') AS day,
       COALESCE(SUM(
         CASE WHEN mp.id IS NOT NULL THEN
           (
             COALESCE((ga.output->'usage'->'inputTokens'->>'noCache')::numeric, 0) * mp.input_price
             + COALESCE((ga.output->'usage'->'inputTokens'->>'cacheRead')::numeric, 0) * COALESCE(mp.cache_read_price, mp.input_price)
             + COALESCE((ga.output->'usage'->'outputTokens'->>'text')::numeric, 0) * mp.output_price
             + COALESCE((ga.output->'usage'->'outputTokens'->>'reasoning')::numeric, 0) * COALESCE(mp.reasoning_price, mp.output_price)
           ) / 1000000.0
         ELSE 0 END
       ), 0)::float AS total_cost
     FROM generation_activities ga
     LEFT JOIN model_pricing mp ON mp.model_id = ga.input->>'modelId'
     GROUP BY date_trunc('day', ga.scheduled_time)
     ORDER BY day`,
    [from, to]
  );
  return result.rows;
}
