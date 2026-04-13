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
  total_cost_4w: number;
  total_tokens_4w: number;
  total_llm_calls_4w: number;
  total_chats: number;
}

export async function getDailyCosts(days = 56): Promise<DailyCost[]> {
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
         AND a.scheduled_time >= NOW() - ($1 || ' days')::interval
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
    [days]
  );
  return result.rows;
}

export async function getUserCosts(weeks = 4, limit = 20): Promise<UserCost[]> {
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
     JOIN workflows w ON w.message_id = m.id
     JOIN activities a ON a.workflow_id = w.workflow_id AND a.activity_type = 'invokeModel'
     LEFT JOIN model_pricing mp ON mp.model_id = a.input->>'modelId'
     WHERE a.scheduled_time >= NOW() - ($1 || ' weeks')::interval
     GROUP BY u.id, u.given_name, u.family_name, u.email
     ORDER BY total_cost DESC
     LIMIT $2`,
    [weeks, limit]
  );
  return result.rows;
}

export async function getCostSummary(weeks = 4): Promise<CostSummaryCard> {
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
       ), 0)::float AS total_cost_4w,
       COALESCE(SUM(
         (a.output->'usage'->'inputTokens'->>'total')::bigint
         + (a.output->'usage'->'outputTokens'->>'total')::bigint
       ), 0)::bigint AS total_tokens_4w,
       COUNT(*)::int AS total_llm_calls_4w,
       COUNT(DISTINCT c.id)::int AS total_chats
     FROM activities a
     JOIN workflows w ON w.workflow_id = a.workflow_id
     JOIN messages m ON m.id = w.message_id
     JOIN chats c ON c.id = m.chat_id
     LEFT JOIN model_pricing mp ON mp.model_id = a.input->>'modelId'
     WHERE a.activity_type = 'invokeModel'
       AND a.scheduled_time >= NOW() - ($1 || ' weeks')::interval`,
    [weeks]
  );
  return result.rows[0];
}
