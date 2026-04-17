import pool from "@/lib/db";

export interface ChatRow {
  id: string;
  title: string | null;
  user_name: string;
  user_email: string | null;
  message_count: number;
  last_message_at: string | null;
  total_cost_usd: number | null;
}

export type SortKey = "user" | "title" | "messages" | "cost" | "cost_per_msg" | "last_message";
export type SortDir = "asc" | "desc";

const SORT_COLUMNS: Record<SortKey, string> = {
  user: "user_name",
  title: "title",
  messages: "message_count",
  cost: "total_cost_usd",
  cost_per_msg: "cost_per_msg",
  last_message: "last_message_at",
};

const COST_SUBQUERY_SQL = `
  SELECT COALESCE(SUM(
    CASE WHEN mp.id IS NOT NULL THEN
      (
        COALESCE((act.output->'usage'->'inputTokens'->>'noCache')::numeric, 0) * mp.input_price
        + COALESCE((act.output->'usage'->'inputTokens'->>'cacheRead')::numeric, 0) * COALESCE(mp.cache_read_price, mp.input_price)
        + COALESCE((act.output->'usage'->'outputTokens'->>'text')::numeric, 0) * mp.output_price
        + COALESCE((act.output->'usage'->'outputTokens'->>'reasoning')::numeric, 0) * COALESCE(mp.reasoning_price, mp.output_price)
      ) / 1000000.0
    ELSE 0 END
  ), 0) as total
  FROM messages m2
  JOIN chat_workflows cw ON cw.message_id = m2.id
  JOIN activities act ON act.workflow_id = cw.workflow_id AND act.activity_type = 'invokeModel'
  LEFT JOIN model_pricing mp ON mp.model_id = act.input->>'modelId'
`;

export async function getChats(
  search?: string,
  page = 1,
  pageSize = 20,
  sortKey: SortKey = "last_message",
  sortDir: SortDir = "desc"
): Promise<{ chats: ChatRow[]; total: number }> {
  const offset = (page - 1) * pageSize;

  let whereClause = 'WHERE c.deleted_at IS NULL';
  const params: (string | number)[] = [];
  let paramIndex = 1;

  if (search && search.trim()) {
    const term = search.trim();
    whereClause += ` AND (
      u.given_name ILIKE $${paramIndex}
      OR u.family_name ILIKE $${paramIndex}
      OR u.email ILIKE $${paramIndex}
      OR EXISTS (
        SELECT 1 FROM messages m2
        JOIN message_parts mp ON mp.message_id = m2.id
        WHERE m2.chat_id = c.id
          AND mp.content->>'type' = 'text'
          AND to_tsvector('english', mp.content->>'text') @@ plainto_tsquery('english', $${paramIndex + 1})
      )
    )`;
    params.push(`%${term}%`, term);
    paramIndex += 2;
  }

  const countQuery = `
    SELECT COUNT(*) as total
    FROM chats c
    JOIN users u ON u.id = c.user_id
    ${whereClause}
  `;

  // Validate sort to prevent injection
  const orderCol = SORT_COLUMNS[sortKey] || "last_message_at";
  const orderDir = sortDir === "asc" ? "ASC" : "DESC";
  const nullsHandling = sortDir === "desc" ? "NULLS LAST" : "NULLS FIRST";
  const sortNeedsCost = sortKey === "cost" || sortKey === "cost_per_msg";

  // Two-pass when sort doesn't need cost: rank+limit on cheap columns first,
  // then compute cost only for the visible page. Falls back to one-pass when
  // sorting by cost since that genuinely needs cost per chat up front.
  const dataQuery = sortNeedsCost
    ? `
    SELECT
      c.id,
      c.title,
      COALESCE(u.given_name || ' ' || u.family_name, u.email, 'Unknown') as user_name,
      u.email as user_email,
      COUNT(m.id)::int as message_count,
      MAX(m.created_at) as last_message_at,
      COALESCE(MAX(cost.total), 0) as total_cost_usd,
      CASE WHEN COUNT(m.id) > 0 THEN COALESCE(MAX(cost.total), 0) / COUNT(m.id) ELSE 0 END as cost_per_msg
    FROM chats c
    JOIN users u ON u.id = c.user_id
    LEFT JOIN messages m ON m.chat_id = c.id
    LEFT JOIN LATERAL (${COST_SUBQUERY_SQL} WHERE m2.chat_id = c.id) cost ON true
    ${whereClause}
    GROUP BY c.id, c.title, u.given_name, u.family_name, u.email
    ORDER BY ${orderCol} ${orderDir} ${nullsHandling}
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `
    : `
    WITH ranked AS (
      SELECT
        c.id,
        c.title,
        c.user_id,
        COALESCE(u.given_name || ' ' || u.family_name, u.email, 'Unknown') as user_name,
        u.email as user_email,
        COUNT(m.id)::int as message_count,
        MAX(m.created_at) as last_message_at
      FROM chats c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN messages m ON m.chat_id = c.id
      ${whereClause}
      GROUP BY c.id, c.title, c.user_id, u.given_name, u.family_name, u.email
      ORDER BY ${orderCol} ${orderDir} ${nullsHandling}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    )
    SELECT
      r.id,
      r.title,
      r.user_name,
      r.user_email,
      r.message_count,
      r.last_message_at,
      COALESCE(cost.total, 0)::float as total_cost_usd,
      CASE WHEN r.message_count > 0 THEN COALESCE(cost.total, 0) / r.message_count ELSE 0 END as cost_per_msg
    FROM ranked r
    LEFT JOIN LATERAL (${COST_SUBQUERY_SQL} WHERE m2.chat_id = r.id) cost ON true
    ORDER BY ${orderCol} ${orderDir} ${nullsHandling}
  `;

  const [countResult, dataResult] = await Promise.all([
    pool.query(countQuery, params),
    pool.query(dataQuery, [...params, pageSize, offset]),
  ]);
  const total = parseInt(countResult.rows[0].total, 10);

  return {
    chats: dataResult.rows,
    total,
  };
}
