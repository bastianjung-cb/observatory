# Precomputed Materialized Views for Lists + Dashboard

**Date:** 2026-04-20
**Status:** Draft — pending user review

## Goal

The three top-level pages (`/chats`, `/column-creations`, `/dashboard`) compute expensive per-row or per-day cost aggregates on every request. Even with `unstable_cache` at 300s, the first request after an invalidation is slow, and at real scale the underlying queries scan large `activities` tables with heavy JSON extraction. Replace the hot-path work with three PostgreSQL materialized views, refreshed at the end of each sync (every 15 min via auto-sync, or manually via the Sync button).

## Scope

### In scope
- Three materialized views:
  1. `mv_chat_stats` — one row per chat, covers `/chats` list and any future per-chat aggregates.
  2. `mv_column_creation_stats` — one row per column-generation-batch workflow, covers `/column-creations` list and four of the seven `/dashboard` queries (colgen volume, colgen daily costs, colgen user stats, colgen summary).
  3. `mv_daily_activity_stats` — one row per `(day, source, user_id, model_id)`, covers the three chat-side dashboard queries (daily costs, cost summary, per-user costs).
- A new `refresh_materialized_views` sync phase that runs after existing phases and uses `REFRESH MATERIALIZED VIEW CONCURRENTLY` when populated, plain `REFRESH MATERIALIZED VIEW` on first run.
- Indexes on both the MVs (required for `CONCURRENTLY` and for read-path filters/sorts) and on base tables to speed up refresh.
- Rewrite of `web/lib/queries/chats.ts`, `web/lib/queries/column-creations.ts`, and `web/lib/queries/dashboard.ts` to read from MVs instead of computing live.
- Add `revalidateTag("chats")` to the `runSync` server action and add `unstable_cache` wrapping to the chat list query (currently uncached).

### Out of scope
- Detail pages (`/chats/[id]`, `/column-creations/[batchId]`) — remain on live queries. The user has explicitly scoped them out; base-table indexes should be sufficient.
- Incremental / surgical MV updates. Every refresh is a full recompute.
- Refresh triggered by anything other than a sync tick (no LISTEN/NOTIFY, no DB triggers).
- The dashboard's `UserCost.message_count` semantics change. Keep it as distinct messages via a live query; the dashboard MV provides the per-user cost aggregate, the message count stays live.

## Architecture

```
make sync
  └─ run_sync
      ├─ [phase 1] sync_app_data              (existing)
      ├─ [phase 2] sync_temporal_data         (existing)
      ├─ [phase 3] sync_temporal_generation_data (existing)
      ├─ [phase 4] sync_generation_batches    (existing)
      └─ [phase 5 NEW] refresh_materialized_views
            ├─ REFRESH (mode chosen per-MV) mv_chat_stats
            ├─ REFRESH (mode chosen per-MV) mv_column_creation_stats
            └─ REFRESH (mode chosen per-MV) mv_daily_activity_stats
```

Each MV refresh lives in its own try/except. A failure logs + rolls back and moves on. This matches the per-phase isolation pattern from sync v2.

Refresh mode is selected dynamically: if `pg_matviews.is_populated = true`, use `CONCURRENTLY` (view stays readable during refresh). If the view has never been populated (first run after migration), omit `CONCURRENTLY` (required — can't run concurrently on an unpopulated MV). This one-time non-concurrent refresh briefly locks the view, but since the view is empty anyway and no users are served by it yet, the impact is zero.

### Page read path

```
User request → Next.js server action → unstable_cache (5 min) → getChats/getColumnCreations/getDashboard*
                                                                          ↓
                                                              JOIN mv_<name> ON pk
                                                              WHERE <filters applied live>
                                                              ORDER BY <live>
                                                              LIMIT <live>
```

Filters that can't be pre-aggregated (text search on message content, user name LIKE, status LIKE) stay live. They still benefit from the existing GIN and btree indexes.

## Materialized views

### 1. `mv_chat_stats`

**Definition:**
```sql
CREATE MATERIALIZED VIEW mv_chat_stats AS
SELECT
  c.id                                            AS chat_id,
  COUNT(DISTINCT m.id)::int                       AS message_count,
  MAX(m.created_at)                               AS last_message_at,
  COALESCE(SUM(
    CASE WHEN mp.id IS NOT NULL THEN
      (COALESCE((a.output->'usage'->'inputTokens'->>'noCache')::numeric, 0) * mp.input_price
       + COALESCE((a.output->'usage'->'inputTokens'->>'cacheRead')::numeric, 0) * COALESCE(mp.cache_read_price, mp.input_price)
       + COALESCE((a.output->'usage'->'outputTokens'->>'text')::numeric, 0) * mp.output_price
       + COALESCE((a.output->'usage'->'outputTokens'->>'reasoning')::numeric, 0) * COALESCE(mp.reasoning_price, mp.output_price)
      ) / 1000000.0
    ELSE 0 END
  ), 0)::float                                    AS total_cost_usd,
  COALESCE(SUM((a.output->'usage'->'inputTokens'->>'total')::bigint), 0)::bigint   AS total_input_tokens,
  COALESCE(SUM((a.output->'usage'->'outputTokens'->>'total')::bigint), 0)::bigint  AS total_output_tokens,
  COUNT(a.id) FILTER (WHERE a.activity_type = 'invokeModel')::int                  AS llm_calls
FROM chats c
LEFT JOIN messages m        ON m.chat_id = c.id
LEFT JOIN chat_workflows cw ON cw.message_id = m.id
LEFT JOIN activities a      ON a.workflow_id = cw.workflow_id AND a.activity_type = 'invokeModel'
LEFT JOIN model_pricing mp  ON mp.model_id = a.input->>'modelId'
GROUP BY c.id
WITH NO DATA;
```

**Indexes:**
- `CREATE UNIQUE INDEX mv_chat_stats_chat_id ON mv_chat_stats(chat_id);` — required for `CONCURRENTLY`, primary lookup key.
- `CREATE INDEX mv_chat_stats_last_message ON mv_chat_stats(last_message_at DESC NULLS LAST);` — default sort for `/chats`.

**Page rewrite (`web/lib/queries/chats.ts`):**
- Drop `COST_SUBQUERY_SQL` and the LATERAL join that uses it.
- Replace `LEFT JOIN messages m ... GROUP BY c.id, ...` with `LEFT JOIN mv_chat_stats s ON s.chat_id = c.id`.
- All sort keys (`user`, `title`, `messages`, `cost`, `cost_per_msg`, `last_message`) map to MV columns or joined tables.
- `minMessages` filter becomes `WHERE s.message_count >= $N` (instead of `HAVING`).
- Text search on message content stays live via the existing `EXISTS (...)` subquery on `message_parts` GIN index.
- Wrap `getChats` in `unstable_cache` with tag `"chats"` (currently uncached).

### 2. `mv_column_creation_stats`

**Definition:**
```sql
CREATE MATERIALIZED VIEW mv_column_creation_stats AS
SELECT
  cgw.workflow_id                                                AS workflow_id,
  cgw.batch_id                                                   AS batch_id,
  cgw.user_id                                                    AS user_id,
  w.status                                                       AS status,
  w.start_time                                                   AS start_time,
  w.end_time                                                     AS end_time,
  cgw.metadata->>'columnName'                                    AS column_name,
  cgw.metadata->>'prompt'                                        AS prompt,
  cgw.metadata->>'variant'                                       AS variant,
  COALESCE((cgw.metadata->>'totalRows')::int, 0)                 AS total_rows,
  COALESCE((cgw.metadata->>'completedRows')::int, 0)             AS completed_rows,
  COALESCE((cgw.metadata->>'failedRows')::int, 0)                AS failed_rows,
  COALESCE(SUM(
    CASE WHEN mp.id IS NOT NULL THEN
      (COALESCE((a.output->'usage'->'inputTokens'->>'noCache')::numeric, 0) * mp.input_price
       + COALESCE((a.output->'usage'->'inputTokens'->>'cacheRead')::numeric, 0) * COALESCE(mp.cache_read_price, mp.input_price)
       + COALESCE((a.output->'usage'->'outputTokens'->>'text')::numeric, 0) * mp.output_price
       + COALESCE((a.output->'usage'->'outputTokens'->>'reasoning')::numeric, 0) * COALESCE(mp.reasoning_price, mp.output_price)
      ) / 1000000.0
    ELSE 0 END
  ), 0)::float                                                   AS total_cost_usd,
  COALESCE(SUM((a.output->'usage'->'inputTokens'->>'total')::bigint), 0)::bigint   AS total_input_tokens,
  COALESCE(SUM((a.output->'usage'->'outputTokens'->>'total')::bigint), 0)::bigint  AS total_output_tokens,
  COUNT(a.id)::int                                               AS llm_calls
FROM column_generation_workflows cgw
JOIN workflows w ON w.workflow_id = cgw.workflow_id
LEFT JOIN workflows child ON child.parent_workflow_id = cgw.workflow_id
LEFT JOIN activities a
  ON a.activity_type = 'invokeModel'
  AND (a.workflow_id = cgw.workflow_id OR a.workflow_id = child.workflow_id)
LEFT JOIN model_pricing mp ON mp.model_id = a.input->>'modelId'
GROUP BY cgw.workflow_id, cgw.batch_id, cgw.user_id, w.status, w.start_time, w.end_time, cgw.metadata
WITH NO DATA;
```

**Indexes:**
- `CREATE UNIQUE INDEX mv_cgw_stats_workflow_id ON mv_column_creation_stats(workflow_id);` — required for `CONCURRENTLY`.
- `CREATE UNIQUE INDEX mv_cgw_stats_batch_id ON mv_column_creation_stats(batch_id);` — drill-in by `batchId` URL param.
- `CREATE INDEX mv_cgw_stats_start_time ON mv_column_creation_stats(start_time DESC NULLS LAST);` — default sort for `/column-creations`.
- `CREATE INDEX mv_cgw_stats_user_id ON mv_column_creation_stats(user_id);` — dashboard per-user stats.

**Page rewrite (`web/lib/queries/column-creations.ts`):**
- Drop the inline `total_cost_usd` subquery entirely — it's now a column on the MV.
- `FROM column_generation_workflows cgw JOIN workflows w ... ` becomes `FROM mv_column_creation_stats cgw LEFT JOIN users u ON u.id = cgw.user_id`.
- All existing filters (search, columnFilter, userFilter, statusFilter) and sort keys map to MV columns.
- `getColumnCreation(batchId)` detail query also switches to the MV (single-row lookup on `mv_cgw_stats_batch_id`).

**Dashboard queries powered by this MV:**
- `getColGenSummary(from, to)` — aggregate MV rows where `start_time` in range.
- `getDailyColumnCreationVolume(from, to)` — group MV rows by `date_trunc('day', start_time)` (workflow-start-day semantics; a workflow counts on the day it started).
- `getUserColumnCreationStats(from, to)` — group MV rows by `user_id`.

(`getDailyColumnCreationCosts` is powered by MV 3 instead — see below — because it needs activity-level day bucketing, not workflow-start bucketing.)

### 3. `mv_daily_activity_stats`

**Definition:**
```sql
CREATE MATERIALIZED VIEW mv_daily_activity_stats AS
SELECT
  date_trunc('day', a.scheduled_time)::date                                    AS day,
  CASE
    WHEN cw.message_id IS NOT NULL                THEN 'chat'
    WHEN cgw_parent.workflow_id IS NOT NULL       THEN 'colgen'
    WHEN cgw_self.workflow_id IS NOT NULL         THEN 'colgen'
    ELSE 'other'
  END                                                                          AS source,
  COALESCE(c.user_id, cgw_parent.user_id, cgw_self.user_id)                   AS user_id,
  a.input->>'modelId'                                                          AS model_id,
  COALESCE(SUM(
    CASE WHEN mp.id IS NOT NULL THEN
      (COALESCE((a.output->'usage'->'inputTokens'->>'noCache')::numeric, 0) * mp.input_price
       + COALESCE((a.output->'usage'->'inputTokens'->>'cacheRead')::numeric, 0) * COALESCE(mp.cache_read_price, mp.input_price)
       + COALESCE((a.output->'usage'->'outputTokens'->>'text')::numeric, 0) * mp.output_price
       + COALESCE((a.output->'usage'->'outputTokens'->>'reasoning')::numeric, 0) * COALESCE(mp.reasoning_price, mp.output_price)
      ) / 1000000.0
    ELSE 0 END
  ), 0)::float                                                                 AS total_cost_usd,
  COALESCE(SUM((a.output->'usage'->'inputTokens'->>'total')::bigint), 0)::bigint       AS total_input_tokens,
  COALESCE(SUM((a.output->'usage'->'inputTokens'->>'cacheRead')::bigint), 0)::bigint   AS cache_read_tokens,
  COALESCE(SUM((a.output->'usage'->'outputTokens'->>'total')::bigint), 0)::bigint      AS total_output_tokens,
  COALESCE(SUM((a.output->'usage'->'outputTokens'->>'reasoning')::bigint), 0)::bigint  AS reasoning_tokens,
  COUNT(*)::int                                                                AS llm_calls
FROM activities a
LEFT JOIN chat_workflows cw        ON cw.workflow_id = a.workflow_id
LEFT JOIN messages m               ON m.id = cw.message_id
LEFT JOIN chats c                  ON c.id = m.chat_id
LEFT JOIN column_generation_workflows cgw_self ON cgw_self.workflow_id = a.workflow_id
LEFT JOIN workflows wchild         ON wchild.workflow_id = a.workflow_id
LEFT JOIN column_generation_workflows cgw_parent ON cgw_parent.workflow_id = wchild.parent_workflow_id
LEFT JOIN model_pricing mp         ON mp.model_id = a.input->>'modelId'
WHERE a.activity_type = 'invokeModel'
GROUP BY 1, 2, 3, 4
WITH NO DATA;
```

**Indexes:**
- `CREATE UNIQUE INDEX mv_daily_unique ON mv_daily_activity_stats(day, source, user_id, model_id) NULLS NOT DISTINCT;` — required for `CONCURRENTLY`. Uses PG15+ `NULLS NOT DISTINCT`; we're on PG16.
- `CREATE INDEX mv_daily_source_day ON mv_daily_activity_stats(source, day DESC);` — dashboard primary filter path.

**Dashboard queries powered by this MV:**
- `getDailyCosts(from, to)` — chat daily costs. `SELECT day, SUM(total_cost_usd), SUM(total_input_tokens), SUM(total_output_tokens) FROM mv_daily_activity_stats WHERE source='chat' AND day BETWEEN $1 AND $2 GROUP BY day ORDER BY day`.
- `getCostSummary(from, to)` — chat summary. Same MV, no group-by. `total_chats` stays live (cheap `COUNT(DISTINCT c.id)` over the date range).
- `getUserCosts(from, to)` — per-user chat costs. MV grouped by user_id for cost/tokens; `message_count` (distinct messages) stays live via the existing subquery on messages+chat_workflows (user preference).
- `getDailyColumnCreationCosts(from, to)` — colgen daily costs with activity-scheduled-time bucketing. `SELECT day, SUM(total_cost_usd) FROM mv_daily_activity_stats WHERE source='colgen' AND day BETWEEN $1 AND $2 GROUP BY day`.

## Base-table indexes added for fast refresh

- `CREATE INDEX idx_activities_invokemodel ON activities(workflow_id) WHERE activity_type = 'invokeModel';` — partial index. Speeds up the MV joins that all filter to invokeModel. Smaller and more selective than the existing full `idx_activities_workflow_id`.
- `CREATE INDEX idx_activities_invokemodel_scheduled ON activities(scheduled_time) WHERE activity_type = 'invokeModel';` — speeds up the daily grouping in MV 3.
- `CREATE INDEX idx_chat_workflows_workflow_id ON chat_workflows(workflow_id);` — chat_workflows today has no index on workflow_id (only on message_id). MV 3's tagging join needs this.
- `CREATE INDEX idx_workflows_parent_workflow_id_workflow_id ON workflows(parent_workflow_id, workflow_id);` — composite for the cgw_parent lookup in MV 3 and the child lookup in MV 2. Enables index-only scan.

## Refresh pipeline (Python)

**New function in `app_sync.py` (or a small new module `mv_refresh.py` — author's choice, keep dependencies inline with the call site):**

```python
import time

def refresh_materialized_views(observer_conn: psycopg.Connection) -> None:
    """Refresh the three dashboard/list MVs. Uses CONCURRENTLY when the MV
    is already populated; falls back to plain REFRESH on first run. Each
    MV is refreshed in its own try/except — one failure doesn't block the
    others. Caller commits via normal phase boundaries."""
    for mv_name in ("mv_chat_stats", "mv_column_creation_stats", "mv_daily_activity_stats"):
        try:
            t0 = time.monotonic()
            with observer_conn.cursor() as cur:
                cur.execute(
                    "SELECT is_populated FROM pg_matviews "
                    "WHERE schemaname = 'public' AND matviewname = %s",
                    (mv_name,),
                )
                row = cur.fetchone()
                populated = bool(row and row[0])
            mode = "CONCURRENTLY" if populated else ""
            # Cannot parametrize identifiers; mv_name is a hardcoded constant so no injection risk.
            with observer_conn.cursor() as cur:
                cur.execute(f"REFRESH MATERIALIZED VIEW {mode} {mv_name}")
            observer_conn.commit()
            logger.info(
                "Refreshed %s (%s) in %.2fs", mv_name,
                mode or "blocking", time.monotonic() - t0,
            )
        except Exception:
            logger.exception("Failed to refresh %s; continuing", mv_name)
            observer_conn.rollback()
```

Hook in `run_sync` as phase 5, wrapped in the same try/except + rollback as the other four phases.

## Cache invalidation

In `web/app/actions.ts`:
```diff
 revalidateTag("dashboard", { expire: 0 });
 revalidateTag("column-creations", { expire: 0 });
+revalidateTag("chats", { expire: 0 });
```

In `web/lib/queries/chats.ts`: wrap `getChats` with `unstable_cache` (it is currently uncached). Tag it `"chats"`, set `revalidate` to the dashboard's 300s convention.

## Testing

**New test file `tests/test_mv_refresh.py`:**
- `test_refresh_creates_and_populates_mvs`: fixture builds a tiny graph (user, chat, workflow, cgw, activities, pricing). Runs `init_schema` + the migration (or seeds the MVs via a helper). Calls `refresh_materialized_views`. Queries each MV, asserts the aggregate values match hand-computed expectations.
- `test_refresh_is_idempotent`: call `refresh_materialized_views` twice; second call uses CONCURRENTLY (view is populated); results unchanged.
- `test_refresh_continues_if_one_mv_fails`: drop one MV, call `refresh_materialized_views`, assert the other two still refresh. Then recreate the dropped MV for teardown.

**No rewrite of existing DB tests** needed — the MVs are new objects, and the existing upsert/watermark tests don't touch them.

**Manual verification after implementation:**
1. Run `make migrate` — confirm alembic creates all three MVs `WITH NO DATA` + all indexes.
2. Run `make sync` — confirm phase 5 runs, logs `Refreshed ... (blocking) in Xs` for each MV.
3. Query each MV directly for sanity: `SELECT COUNT(*) FROM mv_chat_stats` etc.
4. Run `make sync` a second time — confirm `Refreshed ... (CONCURRENTLY) in Xs`.
5. Open `/chats`, `/column-creations`, `/dashboard` in the browser — confirm data renders, default sort works, filters work.
6. Sanity-check timings: `EXPLAIN ANALYZE SELECT ...` for each page's new query — should be well under 100ms on populated dev data.

## Rollout

1. Alembic migration creates the three MVs + indexes (MV-side and base-table). Fast (no data scan).
2. First `make sync` after deploy populates all three via non-concurrent REFRESH. Slow one-time cost, but observer DB has a single writer so no lock contention. Log warns with "blocking" mode.
3. Subsequent syncs use `CONCURRENTLY`; web stays readable throughout.
4. Page rewrites ship in the same PR. Between deploy and the first sync, pages render empty (MV has no rows). Users see a brief "empty state" until the first sync tick completes.

**Rollback:**
- `alembic downgrade -1` drops MVs and added indexes. *Must* be preceded by reverting the page-query PR — the page queries depend on MVs existing. Document in the rollout note.

## Risks & mitigations

| # | Risk | Mitigation |
|---|------|------------|
| 1 | `REFRESH MATERIALIZED VIEW CONCURRENTLY` is slower than blocking refresh and may become a dominant sync cost at real scale | If profiling shows refresh > ~30s, split affected MV into incremental aggregate table with surgical UPSERTs (separate follow-up, same read-side shape so no page rewrite). |
| 2 | `total_chats` in `getCostSummary` stays live — a query ungrouped over `activities` joined to chat tables | Small by nature (just a COUNT DISTINCT); existing idx_activities_invokemodel and idx_chat_workflows_workflow_id make it fast. Acceptable. |
| 3 | `UserCost.message_count` stays live — per-user query | Same — cheap with proper indexes. User explicitly accepted. |
| 4 | First-tick page rendering: MVs empty between deploy and first sync = blank lists | Brief (≤15 min auto-sync window, or user clicks Sync manually). Acceptable. |
| 5 | Orphan cgw rows with NULL metadata show up in `mv_column_creation_stats` with `column_name=NULL`, etc. | These are already handled by the existing UI (falls back to "Unnamed Column"). No change. |
| 6 | Pricing changes don't show in dashboard until next refresh (pricing is joined at refresh time) | Document in operational notes. Acceptable for a product with relatively stable pricing. If pricing changes often, future work: move pricing join to read time (trades a small per-read cost for freshness). |
| 7 | `mv_daily_activity_stats` double-tagging: an activity on a chat workflow that is also a child of a cgw (impossible today but not structurally prevented) would tag as `chat` via the CASE. | Acceptable — the schema doesn't mix these. If it ever does, refine the source tag. |
| 8 | Rollback ordering: `alembic downgrade` without reverting page PR breaks pages | Documented. Add to rollout note and any runbook. |

## Non-goals (explicit)

- Detail-page MVs (`/chats/[id]`, `/column-creations/[batchId]`).
- Incremental / surgical updates to MVs.
- LISTEN/NOTIFY-based refresh triggers.
- Parameterizing MVs on date range (not supported by PG materialized views).
- Moving pricing computation to read time.
- UI/UX changes beyond the `UserCost.message_count` note above (which stays live, unchanged UX).
