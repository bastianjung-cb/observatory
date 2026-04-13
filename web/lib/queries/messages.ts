import pool from "@/lib/db";

export interface MessageRow {
  id: string;
  order: number;
  role: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  content_preview: string | null;
  has_workflow: boolean;
  cost_usd: number | null;
  workflow_id: string | null;
  run_id: string | null;
}

export interface ChatInfo {
  id: string;
  title: string | null;
  user_name: string;
  user_email: string | null;
  created_at: string;
}

export async function getChatInfo(chatId: string): Promise<ChatInfo | null> {
  const result = await pool.query(
    `SELECT c.id, c.title, c.created_at,
       COALESCE(u.given_name || ' ' || u.family_name, u.email, 'Unknown') as user_name,
       u.email as user_email
     FROM chats c
     JOIN users u ON u.id = c.user_id
     WHERE c.id = $1`,
    [chatId]
  );
  return result.rows[0] || null;
}

export async function getMessages(chatId: string): Promise<MessageRow[]> {
  const result = await pool.query(
    `SELECT
       m.id,
       m."order",
       m.role,
       m.metadata,
       COALESCE(
         (SELECT w.end_time FROM workflows w WHERE w.message_id = m.id LIMIT 1),
         m.created_at
       ) as created_at,
       (
         SELECT string_agg(mp.content->>'text', E'\n' ORDER BY mp."order")
         FROM message_parts mp
         WHERE mp.message_id = m.id AND mp.content->>'type' = 'text'
       ) as content_preview,
       EXISTS (
         SELECT 1 FROM workflows w WHERE w.message_id = m.id
       ) as has_workflow,
       (SELECT w.workflow_id FROM workflows w WHERE w.message_id = m.id LIMIT 1) as workflow_id,
       (SELECT w.run_id FROM workflows w WHERE w.message_id = m.id LIMIT 1) as run_id,
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
         FROM workflows w
         JOIN activities act ON act.workflow_id = w.workflow_id AND act.activity_type = 'invokeModel'
         LEFT JOIN model_pricing mp ON mp.model_id = act.input->>'modelId'
         WHERE w.message_id = m.id
       ) as cost_usd
     FROM messages m
     WHERE m.chat_id = $1
     ORDER BY m."order" ASC`,
    [chatId]
  );
  return result.rows;
}
