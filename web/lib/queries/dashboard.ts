import { unstable_cache } from "next/cache";
import pool from "@/lib/db";

const CACHE_REVALIDATE_SECONDS = 300;
const CACHE_TAGS = ["dashboard"];

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

export interface ColGenSummaryCard {
  total_cost: number;
  total_llm_calls: number;
  total_columns: number;
  total_cells: number;
}

/** Chat-only daily costs. */
export const getDailyCosts = unstable_cache(
  async (from: string, to: string): Promise<DailyCost[]> => {
    const result = await pool.query(
      `SELECT
         to_char(day, 'YYYY-MM-DD') as day,
         SUM(total_cost_usd)::float as total_cost,
         SUM(total_input_tokens)::bigint as total_input_tokens,
         SUM(total_output_tokens)::bigint as total_output_tokens,
         (SUM(total_input_tokens) + SUM(total_output_tokens))::bigint as total_tokens
       FROM mv_daily_activity_stats
       WHERE source = 'chat'
         AND day >= $1::date
         AND day <= $2::date
       GROUP BY day
       ORDER BY day`,
      [from, to]
    );
    return result.rows;
  },
  ["dashboard:daily-costs"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: CACHE_TAGS }
);

/** Chat-only per-user costs. */
export const getUserCosts = unstable_cache(
  async (from: string, to: string, limit = 20): Promise<UserCost[]> => {
    const result = await pool.query(
      `SELECT
         COALESCE(u.given_name || ' ' || u.family_name, u.email, 'Unknown') AS user_name,
         u.email AS user_email,
         SUM(s.total_cost_usd)::float AS total_cost,
         (
           SELECT COUNT(DISTINCT m.id)::int
           FROM messages m
           JOIN chat_workflows cw ON cw.message_id = m.id
           JOIN activities a ON a.workflow_id = cw.workflow_id AND a.activity_type = 'invokeModel'
           WHERE a.scheduled_time >= $1::timestamptz
             AND a.scheduled_time < ($2::timestamptz + interval '1 day')
             AND m.chat_id IN (SELECT id FROM chats WHERE user_id = u.id)
         ) AS message_count
       FROM mv_daily_activity_stats s
       JOIN users u ON u.id = s.user_id
       WHERE s.source = 'chat'
         AND s.day >= $1::date
         AND s.day <= $2::date
       GROUP BY u.id, u.given_name, u.family_name, u.email
       ORDER BY total_cost DESC
       LIMIT $3`,
      [from, to, limit]
    );
    return result.rows;
  },
  ["dashboard:user-costs"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: CACHE_TAGS }
);

/** Chat-only cost summary. */
export const getCostSummary = unstable_cache(
  async (from: string, to: string): Promise<CostSummaryCard> => {
    const result = await pool.query(
      `SELECT
         COALESCE(SUM(s.total_cost_usd), 0)::float AS total_cost,
         COALESCE(SUM(s.total_input_tokens) + SUM(s.total_output_tokens), 0)::bigint AS total_tokens,
         COALESCE(SUM(s.llm_calls), 0)::int AS total_llm_calls,
         (
           SELECT COUNT(DISTINCT c.id)::int
           FROM chats c
           JOIN messages m ON m.chat_id = c.id
           JOIN chat_workflows cw ON cw.message_id = m.id
           JOIN activities a ON a.workflow_id = cw.workflow_id AND a.activity_type = 'invokeModel'
           WHERE a.scheduled_time >= $1::timestamptz
             AND a.scheduled_time < ($2::timestamptz + interval '1 day')
         ) AS total_chats
       FROM mv_daily_activity_stats s
       WHERE s.source = 'chat'
         AND s.day >= $1::date
         AND s.day <= $2::date`,
      [from, to]
    );
    return result.rows[0];
  },
  ["dashboard:cost-summary"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: CACHE_TAGS }
);

/** Column-generation-only cost summary. */
export const getColGenSummary = unstable_cache(
  async (from: string, to: string): Promise<ColGenSummaryCard> => {
    const result = await pool.query(
      `SELECT
         COALESCE(SUM(total_cost_usd), 0)::float AS total_cost,
         COALESCE(SUM(llm_calls), 0)::int AS total_llm_calls,
         COUNT(*)::int AS total_columns,
         COALESCE(SUM(total_rows), 0)::int AS total_cells
       FROM mv_column_creation_stats
       WHERE start_time >= $1::timestamptz
         AND start_time < ($2::timestamptz + interval '1 day')`,
      [from, to]
    );
    return result.rows[0];
  },
  ["dashboard:colgen-summary"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: CACHE_TAGS }
);

export interface DailyColumnCreationVolume {
  day: string;
  columns_created: number;
  rows_generated: number;
}

export interface DailyColumnCreationCost {
  day: string;
  total_cost: number;
}

export const getDailyColumnCreationVolume = unstable_cache(
  async (from: string, to: string): Promise<DailyColumnCreationVolume[]> => {
    const result = await pool.query(
      `SELECT
         to_char(date_trunc('day', start_time), 'YYYY-MM-DD') AS day,
         COUNT(*)::int AS columns_created,
         COALESCE(SUM(total_rows), 0)::int AS rows_generated
       FROM mv_column_creation_stats
       WHERE start_time >= $1::timestamptz
         AND start_time < ($2::timestamptz + interval '1 day')
       GROUP BY date_trunc('day', start_time)
       ORDER BY day`,
      [from, to]
    );
    return result.rows;
  },
  ["dashboard:colgen-volume"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: CACHE_TAGS }
);

export interface UserColumnCreation {
  user_name: string;
  user_email: string | null;
  columns_created: number;
  rows_generated: number;
}

export const getUserColumnCreationStats = unstable_cache(
  async (from: string, to: string, limit = 20): Promise<UserColumnCreation[]> => {
    const result = await pool.query(
      `SELECT
         COALESCE(u.given_name || ' ' || u.family_name, u.email, 'Unknown') AS user_name,
         u.email AS user_email,
         COUNT(*)::int AS columns_created,
         COALESCE(SUM(cgw.total_rows), 0)::int AS rows_generated
       FROM mv_column_creation_stats cgw
       LEFT JOIN users u ON u.id = cgw.user_id
       WHERE cgw.start_time >= $1::timestamptz
         AND cgw.start_time < ($2::timestamptz + interval '1 day')
       GROUP BY u.id, u.given_name, u.family_name, u.email
       ORDER BY columns_created DESC
       LIMIT $3`,
      [from, to, limit]
    );
    return result.rows;
  },
  ["dashboard:colgen-user-stats"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: CACHE_TAGS }
);

export const getDailyColumnCreationCosts = unstable_cache(
  async (from: string, to: string): Promise<DailyColumnCreationCost[]> => {
    const result = await pool.query(
      `SELECT
         to_char(day, 'YYYY-MM-DD') AS day,
         SUM(total_cost_usd)::float AS total_cost
       FROM mv_daily_activity_stats
       WHERE source = 'colgen'
         AND day >= $1::date
         AND day <= $2::date
       GROUP BY day
       ORDER BY day`,
      [from, to]
    );
    return result.rows;
  },
  ["dashboard:colgen-daily-costs"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: CACHE_TAGS }
);
