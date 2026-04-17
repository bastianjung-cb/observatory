import pool from "@/lib/db";

export interface WorkflowRow {
  workflow_id: string;
  status: string;
  start_time: string;
  end_time: string | null;
  parent_workflow_id: string | null;
  workflow_name: string | null;
}

export interface ChildWorkflowRow {
  workflow_id: string;
  workflow_name: string | null;
  status: string;
  start_time: string;
  end_time: string | null;
  cost_usd?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  output_value?: string | null;
  input_label?: string | null;
}

export interface BreadcrumbItem {
  workflow_id: string;
  label: string;
}

export interface ActivityRow {
  activity_id: string;
  activity_type: string;
  status: string;
  attempt: number;
  scheduled_time: string | null;
  started_time: string | null;
  completed_time: string | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  duration_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  model_id: string | null;
}

export interface CostSummary {
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
}

export interface ModelPricing {
  id: number;
  model_id: string;
  input_price: number;
  output_price: number;
  cache_read_price: number | null;
  reasoning_price: number | null;
}

export interface MessageInfo {
  id: string;
  role: string;
  chat_id: string;
  chat_title: string | null;
}

export const DEFAULT_HIDDEN_ACTIVITIES = [
  "appendMessagePart",
  "markResponseCompleted",
  "getSkillsFormatted",
  "loadContext",
];

export async function getMessageInfo(
  messageId: string
): Promise<MessageInfo | null> {
  const result = await pool.query(
    `SELECT m.id, m.role, c.id as chat_id, c.title as chat_title
     FROM messages m
     JOIN chats c ON c.id = m.chat_id
     WHERE m.id = $1`,
    [messageId]
  );
  return result.rows[0] || null;
}

export async function getWorkflowForMessage(
  messageId: string
): Promise<WorkflowRow | null> {
  const result = await pool.query(
    `SELECT w.workflow_id, w.status, w.start_time, w.end_time, w.parent_workflow_id, w.workflow_name
     FROM chat_workflows cw
     JOIN workflows w ON w.workflow_id = cw.workflow_id
     WHERE cw.message_id = $1
     LIMIT 1`,
    [messageId]
  );
  return result.rows[0] || null;
}

export async function getWorkflow(
  workflowId: string
): Promise<WorkflowRow | null> {
  const result = await pool.query(
    `SELECT workflow_id, status, start_time, end_time, parent_workflow_id, workflow_name
     FROM workflows
     WHERE workflow_id = $1`,
    [workflowId]
  );
  return result.rows[0] || null;
}

export async function getChildWorkflows(
  parentWorkflowId: string
): Promise<ChildWorkflowRow[]> {
  const result = await pool.query(
    `SELECT workflow_id, workflow_name, status, start_time, end_time
     FROM workflows
     WHERE parent_workflow_id = $1
     ORDER BY start_time ASC`,
    [parentWorkflowId]
  );
  return result.rows;
}

export async function getChildWorkflowsWithDetails(
  parentWorkflowId: string
): Promise<ChildWorkflowRow[]> {
  const result = await pool.query(
    `SELECT
       w.workflow_id,
       w.workflow_name,
       w.status,
       w.start_time,
       w.end_time,
       (
         SELECT COALESCE(SUM(
           CASE WHEN mp.id IS NOT NULL THEN
             (
               COALESCE((a.output->'usage'->'inputTokens'->>'noCache')::numeric, 0) * mp.input_price
               + COALESCE((a.output->'usage'->'inputTokens'->>'cacheRead')::numeric, 0) * COALESCE(mp.cache_read_price, mp.input_price)
               + COALESCE((a.output->'usage'->'outputTokens'->>'text')::numeric, 0) * mp.output_price
               + COALESCE((a.output->'usage'->'outputTokens'->>'reasoning')::numeric, 0) * COALESCE(mp.reasoning_price, mp.output_price)
             ) / 1000000.0
           ELSE 0 END
         ), 0)
         FROM activities a
         LEFT JOIN model_pricing mp ON mp.model_id = a.input->>'modelId'
         WHERE a.workflow_id = w.workflow_id AND a.activity_type = 'invokeModel'
       )::float as cost_usd,
       (
         SELECT COALESCE(SUM((a.output->'usage'->'inputTokens'->>'total')::int), 0)
         FROM activities a
         WHERE a.workflow_id = w.workflow_id AND a.activity_type = 'invokeModel'
       )::int as input_tokens,
       (
         SELECT COALESCE(SUM((a.output->'usage'->'outputTokens'->>'total')::int), 0)
         FROM activities a
         WHERE a.workflow_id = w.workflow_id AND a.activity_type = 'invokeModel'
       )::int as output_tokens,
       (
         SELECT a.input->>'value'
         FROM activities a
         WHERE a.workflow_id = w.workflow_id AND a.activity_type = 'writeRowValue'
         LIMIT 1
       ) as output_value,
       (
         SELECT w.input->'rowKey'->>0
       ) as input_label
     FROM workflows w
     WHERE w.parent_workflow_id = $1
     ORDER BY w.start_time ASC`,
    [parentWorkflowId]
  );
  return result.rows;
}

export async function getWorkflowBreadcrumbs(
  workflowId: string
): Promise<BreadcrumbItem[]> {
  // Walk up the parent chain
  const crumbs: BreadcrumbItem[] = [];
  let currentId: string | null = workflowId;
  let depth = 0;
  const MAX_DEPTH = 20;

  while (currentId && depth < MAX_DEPTH) {
    depth++;
    const qr = await pool.query(
      `SELECT workflow_id, workflow_name, parent_workflow_id
       FROM workflows
       WHERE workflow_id = $1`,
      [currentId]
    );
    const row = qr.rows[0] as { workflow_id: string; workflow_name: string | null; parent_workflow_id: string | null } | undefined;
    if (!row) break;
    crumbs.unshift({
      workflow_id: row.workflow_id,
      label: row.workflow_name || row.workflow_id,
    });
    currentId = row.parent_workflow_id;
  }
  return crumbs;
}

export async function getActivities(
  workflowId: string
): Promise<ActivityRow[]> {
  const result = await pool.query(
    `SELECT
       a.activity_id,
       a.activity_type,
       a.status,
       a.attempt,
       a.scheduled_time,
       a.started_time,
       a.completed_time,
       a.input,
       a.output,
       CASE
         WHEN a.completed_time IS NOT NULL AND a.scheduled_time IS NOT NULL
         THEN EXTRACT(EPOCH FROM (a.completed_time - a.scheduled_time)) * 1000
         ELSE NULL
       END as duration_ms,
       a.input->>'modelId' as model_id,
       (a.output->'usage'->'inputTokens'->>'total')::int as input_tokens,
       (a.output->'usage'->'outputTokens'->>'total')::int as output_tokens,
       CASE WHEN a.activity_type = 'invokeModel' AND mp.id IS NOT NULL THEN
         (
           COALESCE((a.output->'usage'->'inputTokens'->>'noCache')::numeric, 0) * mp.input_price
           + COALESCE((a.output->'usage'->'inputTokens'->>'cacheRead')::numeric, 0) * COALESCE(mp.cache_read_price, mp.input_price)
           + COALESCE((a.output->'usage'->'outputTokens'->>'text')::numeric, 0) * mp.output_price
           + COALESCE((a.output->'usage'->'outputTokens'->>'reasoning')::numeric, 0) * COALESCE(mp.reasoning_price, mp.output_price)
         ) / 1000000.0
       ELSE NULL END as cost_usd
     FROM activities a
     LEFT JOIN model_pricing mp ON mp.model_id = a.input->>'modelId'
     WHERE a.workflow_id = $1
     ORDER BY a.activity_id::int ASC`,
    [workflowId]
  );
  return result.rows;
}

export async function getWorkflowCostSummary(
  workflowId: string
): Promise<CostSummary> {
  const result = await pool.query(
    `SELECT
       COALESCE(SUM((a.output->'usage'->'inputTokens'->>'total')::int), 0)::int as total_input_tokens,
       COALESCE(SUM((a.output->'usage'->'outputTokens'->>'total')::int), 0)::int as total_output_tokens,
       COALESCE(SUM(
         CASE WHEN mp.id IS NOT NULL THEN
           (
             COALESCE((a.output->'usage'->'inputTokens'->>'noCache')::numeric, 0) * mp.input_price
             + COALESCE((a.output->'usage'->'inputTokens'->>'cacheRead')::numeric, 0) * COALESCE(mp.cache_read_price, mp.input_price)
             + COALESCE((a.output->'usage'->'outputTokens'->>'text')::numeric, 0) * mp.output_price
             + COALESCE((a.output->'usage'->'outputTokens'->>'reasoning')::numeric, 0) * COALESCE(mp.reasoning_price, mp.output_price)
           ) / 1000000.0
         ELSE 0 END
       ), 0) as total_cost_usd
     FROM activities a
     LEFT JOIN model_pricing mp ON mp.model_id = a.input->>'modelId'
     WHERE a.workflow_id = $1 AND a.activity_type = 'invokeModel'`,
    [workflowId]
  );
  return result.rows[0];
}

export async function getMessageCost(
  messageId: string
): Promise<CostSummary | null> {
  const result = await pool.query(
    `SELECT
       COALESCE(SUM((a.output->'usage'->'inputTokens'->>'total')::int), 0)::int as total_input_tokens,
       COALESCE(SUM((a.output->'usage'->'outputTokens'->>'total')::int), 0)::int as total_output_tokens,
       COALESCE(SUM(
         CASE WHEN mp.id IS NOT NULL THEN
           (
             COALESCE((a.output->'usage'->'inputTokens'->>'noCache')::numeric, 0) * mp.input_price
             + COALESCE((a.output->'usage'->'inputTokens'->>'cacheRead')::numeric, 0) * COALESCE(mp.cache_read_price, mp.input_price)
             + COALESCE((a.output->'usage'->'outputTokens'->>'text')::numeric, 0) * mp.output_price
             + COALESCE((a.output->'usage'->'outputTokens'->>'reasoning')::numeric, 0) * COALESCE(mp.reasoning_price, mp.output_price)
           ) / 1000000.0
         ELSE 0 END
       ), 0) as total_cost_usd
     FROM chat_workflows cw
     JOIN workflows w ON w.workflow_id = cw.workflow_id
     JOIN activities a ON a.workflow_id = w.workflow_id AND a.activity_type = 'invokeModel'
     LEFT JOIN model_pricing mp ON mp.model_id = a.input->>'modelId'
     WHERE cw.message_id = $1`,
    [messageId]
  );
  return result.rows[0];
}

export async function getAllModelPricing(): Promise<ModelPricing[]> {
  // ::float8 casts NUMERIC → JS number so callers get actual numerics
  // (pg returns NUMERIC as string by default to preserve arbitrary precision).
  const result = await pool.query(
    `SELECT id, model_id,
            input_price::float8 AS input_price,
            output_price::float8 AS output_price,
            cache_read_price::float8 AS cache_read_price,
            reasoning_price::float8 AS reasoning_price
     FROM model_pricing ORDER BY model_id`
  );
  return result.rows;
}

export async function upsertModelPricing(
  modelId: string,
  inputPrice: number,
  outputPrice: number,
  cacheReadPrice: number | null,
  reasoningPrice: number | null
): Promise<void> {
  await pool.query(
    `INSERT INTO model_pricing (model_id, input_price, output_price, cache_read_price, reasoning_price)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (model_id) DO UPDATE SET
       input_price = EXCLUDED.input_price,
       output_price = EXCLUDED.output_price,
       cache_read_price = EXCLUDED.cache_read_price,
       reasoning_price = EXCLUDED.reasoning_price`,
    [modelId, inputPrice, outputPrice, cacheReadPrice, reasoningPrice]
  );
}

export async function deleteModelPricing(id: number): Promise<void> {
  await pool.query(`DELETE FROM model_pricing WHERE id = $1`, [id]);
}
