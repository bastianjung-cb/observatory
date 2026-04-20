import { unstable_cache } from "next/cache";
import pool from "@/lib/db";

const CACHE_REVALIDATE_SECONDS = 300;
const CACHE_TAGS = ["column-creations"];

export interface ColumnCreationRow {
  batch_id: string;
  workflow_id: string;
  run_id: string | null;
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
  column_name: "cgw.column_name",
  variant: "cgw.variant",
  rows: "cgw.total_rows",
  status: "cgw.status",
  cost: "cgw.total_cost_usd",
  user: "user_name",
  date: "cgw.start_time",
};

export interface ColumnCreationFilters {
  search?: string;
  columnFilter?: string;
  userFilter?: string;
  statusFilter?: string;
}

export const getColumnCreations = unstable_cache(
  _getColumnCreations,
  ["column-creations:list"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: CACHE_TAGS }
);

async function _getColumnCreations(
  filters: ColumnCreationFilters = {},
  page = 1,
  pageSize = 20,
  sortKey: SortKey = "date",
  sortDir: SortDir = "desc"
): Promise<{ rows: ColumnCreationRow[]; total: number }> {
  const offset = (page - 1) * pageSize;
  const { search, columnFilter, userFilter, statusFilter } = filters;

  let whereClause = "WHERE 1=1";
  const params: (string | number)[] = [];
  let paramIndex = 1;

  if (search && search.trim()) {
    const term = search.trim();
    whereClause += ` AND (
      cgw.column_name ILIKE $${paramIndex}
      OR cgw.prompt ILIKE $${paramIndex}
      OR COALESCE(u.given_name || ' ' || u.family_name, u.email, '') ILIKE $${paramIndex}
    )`;
    params.push(`%${term}%`);
    paramIndex += 1;
  }

  if (columnFilter && columnFilter.trim()) {
    whereClause += ` AND cgw.column_name ILIKE $${paramIndex}`;
    params.push(`%${columnFilter.trim()}%`);
    paramIndex += 1;
  }

  if (userFilter && userFilter.trim()) {
    whereClause += ` AND COALESCE(u.given_name || ' ' || u.family_name, u.email, '') ILIKE $${paramIndex}`;
    params.push(`%${userFilter.trim()}%`);
    paramIndex += 1;
  }

  if (statusFilter && statusFilter.trim()) {
    whereClause += ` AND cgw.status ILIKE $${paramIndex}`;
    params.push(`%${statusFilter.trim()}%`);
    paramIndex += 1;
  }

  const countQuery = `
    SELECT COUNT(*) as total
    FROM mv_column_creation_stats cgw
    LEFT JOIN users u ON u.id = cgw.user_id
    ${whereClause}
  `;

  const orderCol = SORT_COLUMNS[sortKey] || "cgw.start_time";
  const orderDir = sortDir === "asc" ? "ASC" : "DESC";
  const nullsHandling = sortDir === "desc" ? "NULLS LAST" : "NULLS FIRST";

  const dataQuery = `
    SELECT
       cgw.batch_id,
       cgw.workflow_id,
       cgw.column_name,
       cgw.prompt,
       cgw.variant,
       cgw.total_rows,
       cgw.completed_rows,
       cgw.failed_rows,
       cgw.status,
       COALESCE(u.given_name || ' ' || u.family_name, u.email, 'Unknown') as user_name,
       u.email as user_email,
       cgw.total_cost_usd,
       cgw.start_time as created_at
     FROM mv_column_creation_stats cgw
     LEFT JOIN users u ON u.id = cgw.user_id
     ${whereClause}
     ORDER BY ${orderCol} ${orderDir} ${nullsHandling}
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;

  const [countResult, dataResult] = await Promise.all([
    pool.query(countQuery, params),
    pool.query(dataQuery, [...params, pageSize, offset]),
  ]);
  const total = parseInt(countResult.rows[0].total, 10);

  return {
    rows: dataResult.rows,
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
       jsonb_build_object(
         'columnName', cgw.column_name,
         'prompt', cgw.prompt,
         'variant', cgw.variant,
         'totalRows', cgw.total_rows,
         'completedRows', cgw.completed_rows,
         'failedRows', cgw.failed_rows,
         'status', cgw.status
       ) as metadata,
       COALESCE(u.given_name || ' ' || u.family_name, u.email, 'Unknown') as user_name,
       u.email as user_email,
       cgw.status,
       cgw.start_time,
       cgw.end_time
     FROM mv_column_creation_stats cgw
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
