import { unstable_cache } from "next/cache";
import pool from "@/lib/db";

const CACHE_REVALIDATE_SECONDS = 300;
const CACHE_TAGS = ["chats"];

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

export interface ChatQueryFilters {
  search?: string;
  userFilter?: string;
  titleFilter?: string;
  minMessages?: number;
}

const SORT_COLUMNS: Record<SortKey, string> = {
  user: "user_name",
  title: "c.title",
  messages: "s.message_count",
  cost: "s.total_cost_usd",
  cost_per_msg: "cost_per_msg",
  last_message: "s.last_message_at",
};

export const getChats = unstable_cache(
  _getChats,
  ["chats:list"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: CACHE_TAGS }
);

async function _getChats(
  filters: ChatQueryFilters = {},
  page = 1,
  pageSize = 20,
  sortKey: SortKey = "last_message",
  sortDir: SortDir = "desc"
): Promise<{ chats: ChatRow[]; total: number }> {
  const offset = (page - 1) * pageSize;
  const { search, userFilter, titleFilter, minMessages } = filters;

  let whereClause = "WHERE c.deleted_at IS NULL";
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
        JOIN message_parts mp2 ON mp2.message_id = m2.id
        WHERE m2.chat_id = c.id
          AND mp2.content->>'type' = 'text'
          AND to_tsvector('english', mp2.content->>'text') @@ plainto_tsquery('english', $${paramIndex + 1})
      )
    )`;
    params.push(`%${term}%`, term);
    paramIndex += 2;
  }

  if (userFilter && userFilter.trim()) {
    whereClause += ` AND (
      u.given_name ILIKE $${paramIndex}
      OR u.family_name ILIKE $${paramIndex}
      OR u.email ILIKE $${paramIndex}
    )`;
    params.push(`%${userFilter.trim()}%`);
    paramIndex += 1;
  }

  if (titleFilter && titleFilter.trim()) {
    whereClause += ` AND c.title ILIKE $${paramIndex}`;
    params.push(`%${titleFilter.trim()}%`);
    paramIndex += 1;
  }

  if (typeof minMessages === "number" && minMessages > 0) {
    whereClause += ` AND COALESCE(s.message_count, 0) >= $${paramIndex}`;
    params.push(minMessages);
    paramIndex += 1;
  }

  const orderCol = SORT_COLUMNS[sortKey] || "s.last_message_at";
  const orderDir = sortDir === "asc" ? "ASC" : "DESC";
  const nullsHandling = sortDir === "desc" ? "NULLS LAST" : "NULLS FIRST";

  const countQuery = `
    SELECT COUNT(*)::int as total
    FROM chats c
    JOIN users u ON u.id = c.user_id
    LEFT JOIN mv_chat_stats s ON s.chat_id = c.id
    ${whereClause}
  `;

  const dataQuery = `
    SELECT
      c.id,
      c.title,
      COALESCE(u.given_name || ' ' || u.family_name, u.email, 'Unknown') as user_name,
      u.email as user_email,
      COALESCE(s.message_count, 0) as message_count,
      s.last_message_at,
      COALESCE(s.total_cost_usd, 0)::float as total_cost_usd,
      CASE WHEN COALESCE(s.message_count, 0) > 0
           THEN COALESCE(s.total_cost_usd, 0) / s.message_count
           ELSE 0
      END as cost_per_msg
    FROM chats c
    JOIN users u ON u.id = c.user_id
    LEFT JOIN mv_chat_stats s ON s.chat_id = c.id
    ${whereClause}
    ORDER BY ${orderCol} ${orderDir} ${nullsHandling}
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;

  const [countResult, dataResult] = await Promise.all([
    pool.query(countQuery, params),
    pool.query(dataQuery, [...params, pageSize, offset]),
  ]);

  return {
    chats: dataResult.rows,
    total: Number(countResult.rows[0].total),
  };
}
