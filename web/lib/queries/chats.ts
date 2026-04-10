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

export async function getChats(
  search?: string,
  page = 1,
  pageSize = 50
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
  const countResult = await pool.query(countQuery, params);
  const total = parseInt(countResult.rows[0].total, 10);

  const dataQuery = `
    SELECT
      c.id,
      c.title,
      COALESCE(u.given_name || ' ' || u.family_name, u.email, 'Unknown') as user_name,
      u.email as user_email,
      COUNT(m.id)::int as message_count,
      MAX(m.created_at) as last_message_at,
      (
        SELECT COALESCE(SUM(
          CASE WHEN mp.id IS NOT NULL THEN
            (
              COALESCE((act.output->'usage'->'inputTokens'->>'noCache')::numeric, 0) * mp.input_price
              + COALESCE((act.output->'usage'->'inputTokens'->>'cacheRead')::numeric, 0) * COALESCE(mp.cache_read_price, mp.input_price)
              + COALESCE((act.output->'usage'->'outputTokens'->>'text')::numeric, 0) * mp.output_price
              + COALESCE((act.output->'usage'->'outputTokens'->>'reasoning')::numeric, 0) * COALESCE(mp.reasoning_price, mp.output_price)
            ) / 1000000.0
          ELSE 0 END
        ), 0)
        FROM messages m2
        JOIN workflows w ON w.message_id = m2.id
        JOIN activities act ON act.workflow_id = w.workflow_id AND act.activity_type = 'invokeModel'
        LEFT JOIN model_pricing mp ON mp.model_id = act.input->>'modelId'
        WHERE m2.chat_id = c.id
      ) as total_cost_usd
    FROM chats c
    JOIN users u ON u.id = c.user_id
    LEFT JOIN messages m ON m.chat_id = c.id
    ${whereClause}
    GROUP BY c.id, c.title, u.given_name, u.family_name, u.email
    ORDER BY MAX(m.created_at) DESC NULLS LAST
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;

  const result = await pool.query(dataQuery, [...params, pageSize, offset]);

  return {
    chats: result.rows,
    total,
  };
}
