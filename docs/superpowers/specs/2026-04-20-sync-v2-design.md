# Sync v2 — Visibility, Correctness, and Scalability

**Date:** 2026-04-20
**Branch:** `fix/sync-v2`
**Status:** Draft — pending user review

## Goal

Make the Observer sync satisfy three requirements that it currently fails:

1. **Visibility:** every column creator (generation-batch workflow) is visible in the UI, including while it is still running or when it has failed / canceled / timed-out sub-workflows.
2. **Correctness:** the sync does not lose status transitions, does not leave metadata gaps, and does not silently skip rows due to watermark races.
3. **Scalability:** per-tick cost does not grow linearly with Temporal retention or workflow history length.

## Problem summary (verified, not assumed)

Evidence gathered against the dev observer DB and local Temporal during the diagnosis phase:

- **One currently-running `generation-batch-*` in Temporal is completely absent from observer** (no row in `workflows`, no row in `column_generation_workflows`). Root cause: `main.py` skips any workflow whose Temporal status is not terminal. Children are only reachable through the parent's history, so skipping the parent hides the whole subtree.
- **10 observer children carry `status='RUNNING'` even though they were TERMINATED by their parent**. Root cause: `parse_child_workflows_from_history` handles only `CHILD_WORKFLOW_EXECUTION_COMPLETED` and `CHILD_WORKFLOW_EXECUTION_FAILED`; 4 other terminal event types fall through to a catch-all that blanket-labels them `RUNNING`.
- **13 activities stuck at `status='SCHEDULED'` under CANCELED or TERMINATED parents**. Root cause: `UPSERT_ACTIVITY_SQL` uses `DO NOTHING`, so a SCHEDULED activity ingested before its parent closed never gets the terminal event applied.
- **3 `column_generation_workflows` rows with NULL `metadata` / `user_id` in dev; 7 in staging**. Root cause: `sync_generation_batches` advances its watermark to `now()` even when the underlying UPDATE matched 0 rows (the cgw row had not yet been inserted by the Temporal-side sync), stranding the batch forever.
- **Per-tick O(retention) cost:** `list_chat_workflow_ids` and `list_generation_batch_workflow_ids` run unfiltered visibility queries every tick. `sync_users` does a full-table upsert with an extra per-user SELECT and a trailing DELETE. `is_workflow_terminal` does one DB round-trip per workflow considered. `_ingest_workflow` re-fetches full Temporal history each tick for every non-skipped workflow.
- **`sync_temporal_data` / `sync_temporal_generation_data` are not wrapped in try/except** in `run_sync`, so a single transient failure aborts the whole sync.
- **Watermark race in `sync_chats/messages/message_parts`:** query uses `WHERE updated_at > last_sync`, then sets watermark to `now()`. Rows inserted between query execution and `now()` with `updated_at` in that gap are missed on both ticks.

## Scope

### In scope (must-have)
1. Drop the `status not in TERMINAL_STATUSES` skip in `main.py`.
2. Extend `parse_child_workflows_from_history` for all terminal child event types; distinguish PENDING (initiated, never started) from RUNNING.
3. Extend `parse_activities_from_history` for CANCELED and TIMED_OUT activity events.
4. Progressive history fetch: per-workflow `last_event_id` checkpoint; incremental `fetch_history_events(start_event_id=last_event_id+1)`.
5. NULL-metadata backfill in `sync_generation_batches`; batched `UPDATE … FROM (VALUES …)`.
6. `UPSERT_ACTIVITY_SQL`: `DO UPDATE … WHERE activities.status NOT IN (terminal)`.
7. `UPSERT_COLUMN_GENERATION_WORKFLOW_SQL`: `COALESCE(EXCLUDED.*, existing)`.
8. Batched `get_terminal_workflow_ids(ids) -> set[str]` replacing per-row `is_workflow_terminal`.
9. Dual-query Temporal listing (`Running` ∪ `CloseTime > since`) with per-type watermarks.

### In scope (should-have)
10. Wrap each phase of `run_sync` in try/except + rollback + log-and-continue.
11. Capture watermark `now` **before** the query in `sync_chats/messages/message_parts`.
12. Batched commits: `upsert_workflow` / `upsert_chat_workflow` / `upsert_column_generation_workflow` stop committing per row; caller commits once per ingested workflow subtree so parent + children + activities land atomically.
13. `upsert_activities` uses `executemany`.
14. Rotated file logging: `logs/sync.log`, 10 MB × 5 backups, configurable via `OBSERVER_LOG_FILE`, `OBSERVER_LOG_MAX_BYTES`, `OBSERVER_LOG_BACKUP_COUNT`. Stderr mirror retained.

### Out of scope
- **`sync_users` incremental sync.** Requires `User.updatedAt` on the app side. Tracked as follow-up.
- **Data recovery of historical misattribution.** Fix-forward only. The 10+ mislabeled children, stuck SCHEDULED activities, and stranded NULL-metadata rows are left as-is and drift off naturally as Temporal retention ages.
- **Orphan deletion.** Observer rows whose batch is hard-deleted in app DB are WARN-logged only, never removed.
- **Parallel Temporal history fetches.** Sequential ingestion stays. Revisit post-deploy if profiling shows it's the dominant cost after progressive checkpointing.
- **UI changes.** Existing queries already render all statuses; the column-creation detail page already uses `getChildWorkflowsWithDetails`.
- **Auth / permissions.** Unchanged.

## Architecture

### Data flow per tick

```
make sync
  └─ run_sync
      ├─ [phase] sync_app_data             (wrapped in try/except)
      │     ├─ sync_users                  (full-table — unchanged)
      │     ├─ sync_chats                  (watermark captured before query)
      │     ├─ sync_messages               (watermark captured before query)
      │     └─ sync_message_parts          (watermark captured before query)
      ├─ [phase] sync_temporal_data        (wrapped in try/except)
      │     └─ for each chat workflow returned by _list_workflows_since("chat-", since):
      │           skip if in get_terminal_workflow_ids(…)
      │           else _ingest_workflow(start_event_id=last_event_id+1)
      ├─ [phase] sync_temporal_generation_data  (wrapped in try/except)
      │     └─ same pattern, prefix "generation-batch-"
      └─ [phase] sync_generation_batches   (wrapped in try/except)
            └─ fetch batches WHERE updatedAt > last_sync OR id IN (observer NULL-metadata ids)
               one batched UPDATE … FROM (VALUES …)
               log orphans at WARN
```

### Temporal listing
```
_list_workflows_since(prefix, since):
    seen = {}
    async for wf in client.list_workflows(f'WorkflowId STARTS_WITH "{prefix}" AND ExecutionStatus = "Running"'):
        seen[wf.id] = wf
    closed_query = f'WorkflowId STARTS_WITH "{prefix}" AND ExecutionStatus != "Running"'
    if since is not None:
        closed_query += f' AND CloseTime > "{since.isoformat()}"'
    async for wf in client.list_workflows(closed_query):
        seen.setdefault(wf.id, wf)
    return list(seen.values())
```

`since=None` on first tick after deploy results in a full retention scan. Accepted cost (user-approved: "OK if first run takes long as long as it succeeds"). Log WARN at start of that phase.

### Ingestion with checkpoint

Both parsers (`parse_activities_from_history`, `parse_child_workflows_from_history`) build up state across events (SCHEDULED→COMPLETED, INITIATED→STARTED→COMPLETED) by keying partial entries in a dict. If progressive fetch returns only events after a watermark, a COMPLETED whose SCHEDULED was in a prior fetch has no matching key, and the transition is silently lost. **Both parsers must be seeded with observer's current non-terminal state before parsing a partial fetch.**

```
_ingest_workflow(…, last_event_id):
    start = (last_event_id or 0) + 1
    events = await fetch_workflow_history(client, wf_id, run_id, start_event_id=start)

    existing_activities = fetch_non_terminal_activities(conn, wf_id)       # dict[int, activity_entry]
    existing_children   = fetch_non_terminal_children(conn, wf_id)         # dict[str, child_entry]

    activities = parse_activities_from_history(events, seed=existing_activities)
    children   = parse_child_workflows_from_history(events, seed=existing_children)

    max_event_id = max((e.event_id for e in events), default=last_event_id or 0)
    upsert_workflow(conn, {…, "last_event_id": max_event_id, "input": possibly_none, "output": possibly_none})
    upsert_activities(conn, activities)
    # recurse into children …
    conn.commit()
```

Parser keying change: `parse_child_workflows_from_history` keys its `initiated` dict by **child workflow_id** (not by event_id). All subsequent child events (`STARTED`, `COMPLETED`, `FAILED`, `CANCELED`, `TIMED_OUT`, `TERMINATED`) carry `attrs.workflow_execution.workflow_id`, which is stable across fetches. This makes seeding trivial: `seed = {row.workflow_id: {...} for row in existing_children}`.

`parse_activities_from_history` continues keying by integer event_id (= the SCHEDULED event_id, stored in observer as `activity_id`). Seeding: `seed = {int(row.activity_id): {...} for row in existing_activities}`.

Checkpoint and all writes share one transaction per workflow subtree. On failure, neither advances — the next tick retries from the same floor. Also: `UPSERT_WORKFLOW_SQL` must `COALESCE(EXCLUDED.input, workflows.input)` and same for `output`, because progressive fetch may skip the `WORKFLOW_EXECUTION_STARTED` event (always event_id=1) and leave `input=None` in the ingest payload — we must not clobber a previously-stored `input`.

### Parser state machine (children)

| Events seen                                 | Final status      | Has run_id | Recursed into? |
|---------------------------------------------|-------------------|------------|----------------|
| INITIATED only                              | `PENDING`         | no         | no             |
| INITIATED + START_FAILED                    | `START_FAILED`    | no         | no             |
| INITIATED + STARTED                         | `RUNNING`         | yes        | yes            |
| INITIATED + STARTED + COMPLETED             | `COMPLETED`       | yes        | yes            |
| INITIATED + STARTED + FAILED                | `FAILED`          | yes        | yes            |
| INITIATED + STARTED + CANCELED              | `CANCELED`        | yes        | yes            |
| INITIATED + STARTED + TIMED_OUT             | `TIMED_OUT`       | yes        | yes            |
| INITIATED + STARTED + TERMINATED            | `TERMINATED`      | yes        | yes            |

### Parser state machine (activities)

Analogous: add handlers for `EVENT_TYPE_ACTIVITY_TASK_CANCELED` and `EVENT_TYPE_ACTIVITY_TASK_TIMED_OUT`. A still-open activity after all events are processed keeps the current `SCHEDULED` default (it really is still scheduled; its workflow hasn't closed yet in this history fetch).

## Schema changes

One alembic migration, `migrations/versions/<rev>_add_workflows_last_event_id.py`:

```sql
ALTER TABLE workflows ADD COLUMN last_event_id BIGINT;
```

Nullable; NULL = "never incrementally ingested", treated as 0 floor. `SCHEMA_SQL` in `db.py` also adds the column for fresh `init_schema` paths (used in tests). Alembic is authoritative in prod.

No rollback data migration. Old bad data is left in place (user-approved: "OK to keep the old data wrong"). `alembic downgrade -1` drops the column; prior code ignores it.

## Components (file-by-file changes)

### `db.py`
- `SCHEMA_SQL`: add `last_event_id BIGINT` to `workflows`.
- `TERMINAL_STATUSES`: unchanged.
- `UPSERT_WORKFLOW_SQL`: in the DO UPDATE SET list, add `last_event_id = COALESCE(EXCLUDED.last_event_id, workflows.last_event_id)`, and change the existing `input` / `output` assignments to `input = COALESCE(EXCLUDED.input, workflows.input)` / `output = COALESCE(EXCLUDED.output, workflows.output)` so progressive fetches that miss `WORKFLOW_EXECUTION_STARTED`/`COMPLETED` don't clobber previously-stored values.
- `UPSERT_ACTIVITY_SQL`: `DO NOTHING` → `DO UPDATE SET status = EXCLUDED.status, attempt = EXCLUDED.attempt, started_time = EXCLUDED.started_time, completed_time = EXCLUDED.completed_time, output = EXCLUDED.output WHERE activities.status NOT IN ('COMPLETED', 'FAILED', 'CANCELED', 'TERMINATED', 'TIMED_OUT')`.
- `UPSERT_COLUMN_GENERATION_WORKFLOW_SQL`: `EXCLUDED.*` → `COALESCE(EXCLUDED.*, column_generation_workflows.*)`.
- New: `get_terminal_workflow_ids(conn, workflow_ids: list[str]) -> set[str]`.
- New: `get_last_event_ids(conn, workflow_ids: list[str]) -> dict[str, int | None]`.
- New: `fetch_non_terminal_activities(conn, workflow_id: str) -> dict[int, dict]` — seed for `parse_activities_from_history`.
- New: `fetch_non_terminal_children(conn, parent_workflow_id: str) -> dict[str, dict]` — seed for `parse_child_workflows_from_history`.
- `upsert_workflow` / `upsert_chat_workflow` / `upsert_column_generation_workflow`: remove `conn.commit()` — caller commits once per ingested workflow (see `_ingest_workflow` note below), not per individual upsert.
- `upsert_activities`: use `executemany(UPSERT_ACTIVITY_SQL, params_list)` — single round-trip.
- Delete `is_workflow_terminal` (single-row helper) after all call sites switch to `get_terminal_workflow_ids`. Dead code; no need to keep.

### `app_sync.py`
- `sync_chats` / `sync_messages` / `sync_message_parts`: capture `now = datetime.now(timezone.utc)` **before** `get_last_sync`; pass `now` to `update_last_sync` at the end (closes the race).
- Replace `sync_generation_batches` (lines 160-210) with:
  - `_fetch_batches_to_enrich(app_conn, observer_conn, last_sync) -> list[dict]` — union of `updatedAt > last_sync` and `id IN (observer NULL-metadata ids)`.
  - `_apply_batch_enrichment(observer_conn, batches) -> int` — one batched `UPDATE … FROM (VALUES …)`.
  - `_find_orphan_batch_ids(observer_conn, fetched) -> list[str]` — NULL-metadata rows not covered by fetched.
  - `sync_generation_batches` as thin glue; WARN-logs orphans; advances watermark.

### `temporal_client.py`
- New: `_list_workflows_since(client, prefix, since: datetime | None)` (see Architecture above).
- `list_chat_workflow_ids(client, since=None)` → delegates to `_list_workflows_since(client, "chat-", since)`.
- `list_generation_batch_workflow_ids(client, since=None)` → delegates with `"generation-batch-"`.
- `fetch_workflow_history(client, workflow_id, run_id, start_event_id: int | None = None) -> list`: pass `start_event_id=start_event_id` to `handle.fetch_history_events(...)` if provided.
- `parse_child_workflows_from_history`: add handlers for CANCELED, TIMED_OUT, TERMINATED child events; START_CHILD_FAILED; change catch-all to emit PENDING for never-STARTED children, RUNNING for started-but-open. **Change keying from event_id to child workflow_id** so progressive fetches can seed the parser. New signature: `(events, seed: dict[str, dict] | None = None)`.
- `parse_activities_from_history`: add handlers for CANCELED and TIMED_OUT. New signature: `(events, seed: dict[int, dict] | None = None)` — integer key is the SCHEDULED event_id, matching the `activity_id` column stored in observer.

### `main.py`
- Remove `if wf["status"] not in TERMINAL_STATUSES: continue` in both sync functions.
- Replace per-row `is_workflow_terminal` with one batched `get_terminal_workflow_ids([…])`.
- Pass `since=get_last_sync(…)` to the Temporal list functions; capture `tick_start = now()` before ingestion; `update_last_sync(…, tick_start)` after.
- Batch-fetch `get_last_event_ids(…)` for the set of workflows to ingest; pass the correct `last_event_id` per workflow into `_ingest_workflow`.
- `_ingest_workflow`: accept `last_event_id`; pass it to `fetch_workflow_history`; include it in the `upsert_workflow` call; also pass a `last_event_id` for recursed children (batch-fetch once at the outer call). `conn.commit()` happens once at the end of `_ingest_workflow` — so parent + all its children + all their activities land atomically, or none of them do.
- `run_sync`: wrap each of the four phases in try/except with `logger.exception(...)` and `observer_conn.rollback()`. Commits happen at the workflow granularity inside ingestion loops; no top-level per-phase commit.
- Add log configuration block (rotating file + stderr) early in module import.

### `migrations/versions/<rev>_add_workflows_last_event_id.py`
- `op.add_column('workflows', sa.Column('last_event_id', sa.BigInteger(), nullable=True))`
- downgrade: `op.drop_column('workflows', 'last_event_id')`

### `tests/`
- New: `tests/test_app_sync.py` (see Testing below).
- Extend: `tests/test_db.py` with activity / cgw / workflow-checkpoint tests.
- Extend: `tests/test_temporal_client.py` with parser tests.
- Fixture change: DSN from `TEST_DATABASE_URL` env var with a safe default; WARN if default is reachable (risk of clobbering a dev DB — tests drop tables in teardown).

## Error handling

```python
async def run_sync() -> None:
    observer_conn = psycopg.connect(OBSERVER_DATABASE_URL)
    try:
        init_schema(observer_conn)

        for phase in _phases():
            try:
                await _run_phase(phase, observer_conn)
            except Exception:
                logger.exception("Phase %s failed; continuing to next phase", phase.__name__)
                observer_conn.rollback()
    finally:
        observer_conn.close()
```

- No retry. The invoker (cron / systemd timer / manual `make sync`) is responsible for retry cadence. Watermarks & checkpoints make repeated invocations cheap.
- Per-workflow try/except inside ingestion loops stays — one bad workflow doesn't kill the phase.
- `observer_conn.rollback()` after a phase failure keeps the connection clean for the next phase.

## Logging

At the top of `main.py`:
```python
from logging.handlers import RotatingFileHandler

log_file = os.environ.get("OBSERVER_LOG_FILE", "logs/sync.log")
max_bytes = int(os.environ.get("OBSERVER_LOG_MAX_BYTES", 10 * 1024 * 1024))
backup_count = int(os.environ.get("OBSERVER_LOG_BACKUP_COUNT", 5))

os.makedirs(os.path.dirname(log_file), exist_ok=True)
file_handler = RotatingFileHandler(log_file, maxBytes=max_bytes, backupCount=backup_count)
stream_handler = logging.StreamHandler()
formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
file_handler.setFormatter(formatter)
stream_handler.setFormatter(formatter)
logging.basicConfig(level=logging.INFO, handlers=[file_handler, stream_handler])
```

`logs/` is git-ignored; ensure `.gitignore` excludes it.

## Testing

### Unit tests (pytest, real local postgres)

**`tests/test_app_sync.py` (new):**
- `test_apply_batch_enrichment_backfills_null_row`
- `test_find_orphan_batch_ids_returns_observer_rows_without_match`
- `test_watermark_captured_before_query_prevents_miss`

**`tests/test_db.py` (extend):**
- `test_upsert_activity_updates_non_terminal_status`
- `test_upsert_activity_does_not_regress_terminal_status`
- `test_upsert_column_generation_workflow_preserves_metadata`
- `test_upsert_workflow_preserves_last_event_id`
- `test_upsert_workflow_preserves_input_output_on_partial_reingest`
- `test_get_terminal_workflow_ids_returns_only_terminal_subset`
- `test_get_last_event_ids_returns_map_with_nulls`
- `test_fetch_non_terminal_activities_returns_dict_keyed_by_int_activity_id`
- `test_fetch_non_terminal_children_returns_dict_keyed_by_workflow_id`

**`tests/test_temporal_client.py` (extend, parsers only — no live Temporal):**
- `test_parse_child_workflows_handles_canceled_timed_out_terminated`
- `test_parse_child_workflows_marks_start_failed`
- `test_parse_child_workflows_open_children_are_pending_not_running`
- `test_parse_child_workflows_keyed_by_workflow_id`
- `test_parse_child_workflows_seeded_from_observer_state_completes_transition` — seeded `initiated` dict + incoming FAILED event matches by workflow_id and emits the transition.
- `test_parse_activities_handles_canceled_timed_out`
- `test_parse_activities_seeded_from_observer_state_completes_transition` — seeded `scheduled` dict + incoming COMPLETED event matches by event_id.
- `test_fetch_workflow_history_passes_start_event_id`

### Fixture
- DSN from `TEST_DATABASE_URL`; default `postgresql://observer:observer@localhost:5436/observer`.
- Fixture WARN-logs when the default is reachable (test teardown drops tables).

### Manual verification after implementation
1. Against local dev observer + staging app DB + staging Temporal (reads only).
2. Snapshot counts before: `workflows` total, `workflows WHERE status='RUNNING'`, `activities WHERE status='SCHEDULED'`, `column_generation_workflows WHERE metadata IS NULL`.
3. Run `make sync` once (this is the big first-tick).
4. Verify:
   - The previously-invisible running `generation-batch-*` has a `workflows` row with `status='RUNNING'` and a `column_generation_workflows` row.
   - Its children are parsed with correct statuses (`PENDING` / `RUNNING` / terminal variants).
   - `NULL metadata` count ≥ previous minus fetched, remainder logged as orphans.
   - No new SCHEDULED-under-terminal rows added.
5. Run `make sync` a second time. Verify tick is much faster (checkpoints + watermarks working).
6. Inspect `logs/sync.log` for rotation behavior + format.

## Rollout

1. Merge `fix/sync-v2` to `master` after tests green and manual verification passes.
2. On the target host, `make migrate` runs the new alembic migration (adds `last_event_id`).
3. Next `make sync` = first-tick catch-up. Expected to be slow (user-accepted). Logs WARN at start.
4. Second and subsequent ticks run on incremental watermarks + checkpoints.
5. No feature flags, no staged rollout. Changes are additive on the read path.

### Rollback
`alembic downgrade -1` drops `workflows.last_event_id`. Revert the branch. Data written under new semantics (COALESCE metadata, new watermark entries) remains compatible with the pre-fix code path.

## Risks & mitigations

| # | Risk | Mitigation |
|---|------|------------|
| 1 | `last_event_id` checkpoint advances past events we failed to write | Checkpoint update + data writes share a transaction; rollback on error leaves checkpoint un-advanced. |
| 2 | Temporal `start_event_id` parameter behaves unexpectedly on replay / reset workflows | Covered by `test_fetch_workflow_history_passes_start_event_id` + manual verification. Documented SDK behavior: inclusive event-id floor; replay produces identical event stream up to current position. |
| 3 | First-tick catch-up on real data exceeds invoker timeout | User accepted long first tick. Document in rollout note. |
| 4 | Test fixture pointed at dev/staging DB by mistake → teardown drops real tables | Env-driven DSN + fixture WARN on default-that-is-reachable. Developers must opt in explicitly. |
| 5 | Large `backfill_ids` list in `_fetch_batches_to_enrich` ANY(%s) clause | Log a WARN if NULL-metadata row count exceeds a sanity threshold (e.g. 10k). |
| 6 | PENDING / START_FAILED are new statuses the UI doesn't know | UI already renders any status via `Badge`. No visual regression; new statuses just show up with the string label. |

## Non-goals (explicit)

- Incremental `sync_users`.
- Orphan deletion.
- Parallel history fetches.
- UI changes.
- Auth / permissions changes.
- Historical data recovery / re-ingestion.
