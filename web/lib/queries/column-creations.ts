import pool from "@/lib/db";

export interface ColumnCreationRow {
  batch_id: string;
  workflow_id: string;
  column_name: string | null;
  prompt: string | null;
  variant: string | null;
  total_rows: number;
  completed_rows: number;
  failed_rows: number;
  status: string;
  user_name: string | null;
  user_email: string | null;
  total_cost_usd: number;
  created_at: string;
}

export interface ColumnCreationDetail {
  batch_id: string;
  workflow_id: string;
  metadata: Record<string, unknown> | null;
  user_name: string | null;
  user_email: string | null;
  status: string;
  start_time: string;
  end_time: string | null;
}

export interface CostSummary {
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
}

export type SortKey = "column_name" | "variant" | "rows" | "status" | "cost" | "user" | "date";
export type SortDir = "asc" | "desc";

const SORT_COLUMNS: Record<SortKey, string> = {
  column_name: "column_name",
  variant: "variant",
  rows: "total_rows",
  status: "w.status",
  cost: "total_cost_usd",
  user: "user_name",
  date: "created_at",
};

export async function getColumnCreations(
  search?: string,
  page = 1,
  pageSize = 20,
  sortKey: SortKey = "date",
  sortDir: SortDir = "desc"
): Promise<{ rows: ColumnCreationRow[]; total: number }> {
  const offset = (page - 1) * pageSize;

  let whereClause = "WHERE 1=1";
  const params: (string | number)[] = [];
  let paramIndex = 1;

  if (search && search.trim()) {
    const term = search.trim();
    whereClause += ` AND (
      cgw.metadata->>'columnName' ILIKE $${paramIndex}
      OR cgw.metadata->>'prompt' ILIKE $${paramIndex}
      OR COALESCE(u.given_name || ' ' || u.family_name, u.email, '') ILIKE $${paramIndex}
    )`;
    params.push(`%${term}%`);
    paramIndex += 1;
  }

  const countQuery = `
    SELECT COUNT(*) as total
    FROM column_generation_workflows cgw
    JOIN workflows w ON w.workflow_id = cgw.workflow_id
    LEFT JOIN users u ON u.id = cgw.user_id
    ${whereClause}
  `;
  const countResult = await pool.query(countQuery, params);
  const total = parseInt(countResult.rows[0].total, 10);

  // Validate sort to prevent injection
  const orderCol = SORT_COLUMNS[sortKey] || "created_at";
  const orderDir = sortDir === "asc" ? "ASC" : "DESC";
  const nullsHandling = sortDir === "desc" ? "NULLS LAST" : "NULLS FIRST";

  const dataQuery = `
    SELECT
       cgw.batch_id,
       cgw.workflow_id,
       cgw.metadata->>'columnName' as column_name,
       cgw.metadata->>'prompt' as prompt,
       cgw.metadata->>'variant' as variant,
       COALESCE((cgw.metadata->>'totalRows')::int, 0) as total_rows,
       COALESCE((cgw.metadata->>'completedRows')::int, 0) as completed_rows,
       COALESCE((cgw.metadata->>'failedRows')::int, 0) as failed_rows,
       w.status,
       COALESCE(u.given_name || ' ' || u.family_name, u.email, 'Unknown') as user_name,
       u.email as user_email,
       COALESCE((
         SELECT SUM(
           CASE WHEN mp.id IS NOT NULL THEN
             (
               COALESCE((a.output->'usage'->'inputTokens'->>'noCache')::numeric, 0) * mp.input_price
               + COALESCE((a.output->'usage'->'inputTokens'->>'cacheRead')::numeric, 0) * COALESCE(mp.cache_read_price, mp.input_price)
               + COALESCE((a.output->'usage'->'outputTokens'->>'text')::numeric, 0) * mp.output_price
               + COALESCE((a.output->'usage'->'outputTokens'->>'reasoning')::numeric, 0) * COALESCE(mp.reasoning_price, mp.output_price)
             ) / 1000000.0
           ELSE 0 END
         )
         FROM workflows cw
         JOIN activities a ON a.workflow_id = cw.workflow_id AND a.activity_type = 'invokeModel'
         LEFT JOIN model_pricing mp ON mp.model_id = a.input->>'modelId'
         WHERE cw.parent_workflow_id = cgw.workflow_id
            OR cw.workflow_id = cgw.workflow_id
       ), 0)::float as total_cost_usd,
       w.start_time as created_at
     FROM column_generation_workflows cgw
     JOIN workflows w ON w.workflow_id = cgw.workflow_id
     LEFT JOIN users u ON u.id = cgw.user_id
     ${whereClause}
     ORDER BY ${orderCol} ${orderDir} ${nullsHandling}
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;

  const result = await pool.query(dataQuery, [...params, pageSize, offset]);

  return {
    rows: result.rows,
    total,
  };
}

export async function getColumnCreation(
  batchId: string
): Promise<ColumnCreationDetail | null> {
  const result = await pool.query(
    `SELECT
       cgw.batch_id,
       cgw.workflow_id,
       cgw.metadata,
       COALESCE(u.given_name || ' ' || u.family_name, u.email, 'Unknown') as user_name,
       u.email as user_email,
       w.status,
       w.start_time,
       w.end_time
     FROM column_generation_workflows cgw
     JOIN workflows w ON w.workflow_id = cgw.workflow_id
     LEFT JOIN users u ON u.id = cgw.user_id
     WHERE cgw.batch_id = $1::uuid`,
    [batchId]
  );
  return result.rows[0] || null;
}

export async function getColumnCreationCostSummary(
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
     FROM workflows w
     JOIN activities a ON a.workflow_id = w.workflow_id AND a.activity_type = 'invokeModel'
     LEFT JOIN model_pricing mp ON mp.model_id = a.input->>'modelId'
     WHERE w.workflow_id = $1 OR w.parent_workflow_id = $1`,
    [workflowId]
  );
  return result.rows[0];
}
