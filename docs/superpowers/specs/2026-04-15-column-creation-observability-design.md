# Column Creation Observability

Add observability for column creation workflows (generation batches) to the Cellbyte Observatory, alongside the existing chat workflow tracking.

## Context

The cellbyte app has two distinct LLM workflow types:

1. **Chat workflows** — triggered by user messages, run on the `"chat"` task queue, workflow IDs prefixed `chat-<messageId>`
2. **Column creation workflows** — triggered by column generation actions, run on the `"generation"` task queue, workflow IDs prefixed `generation-batch-<batchId>` with children `generate-value-<batchId>-<rowId>`

The observatory currently only syncs and displays chat workflows. Column creation workflows are not synced, tracked, or visible.

### Source data model (cellbyte app DB)

`GenerationBatch` (Prisma model):
- `id` — UUID PK (used in Temporal workflow ID)
- `columnId` — UUID, references a `Resource` of type `COLUMN`
- `prompt` — the column instruction text
- `variant` — output type (`text`, `multiSelect`, etc.)
- `variantOptions` — constrained options for multiSelect
- `rows` — JSONB array of `{rowId, rowKey, anchors}`
- `totalRows`, `completedRows`, `failedRows` — progress counters
- `status` — `PENDING | RUNNING | COMPLETED | FAILED`
- `userId` — UUID, who triggered the batch
- `createdAt`, `updatedAt`

### Temporal workflow hierarchy

```
generateBatchWorkflow (generation-batch-<batchId>)
├── loadGenerationBatch activity
├── resolveReferencesActivity
├── updateBatchProgress activity (RUNNING)
├── [fan-out up to 100 concurrent children]
│   └── generateValueWorkflow (generate-value-<batchId>-<rowId>)
│       ├── updateRowStatus activity
│       ├── getSkillsFormatted activity
│       ├── generateText (invokeModel via @temporalio/ai-sdk)
│       └── writeRowValue activity
└── updateBatchProgress activity (COMPLETED/FAILED)
```

Token usage is not tracked in the cellbyte app, but the observer can extract it from Temporal activity event history (`invokeModel` activities carry usage data in their output JSONB).

## Development Setup

All development and migration testing uses a local throwaway Postgres instance, keeping the production observatory DB (Azure) untouched.

- **Test DB**: Docker container `observer-test-db` on port **5438**, credentials `observer:observer`, database `observer`
- **`.env`**: `OBSERVER_DATABASE_URL` switched to `postgresql://observer:observer@localhost:5438/observer`, Azure URL commented out for easy switch-back
- **Seeded**: populated by running the existing sync (`uv run python main.py`) against the same Azure app DB + Temporal sources — contains a full copy of the current observatory data (38 workflows, 1272 activities, 9 chats, 3 users)
- **Workflow**: develop and test migrations against this DB. Once validated, switch `.env` back to Azure and run the migration on production.

## Database Schema Changes

### Refactor: split `workflows` into base + domain tables

**`workflows`** — thin shared base table (remove `message_id`):

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PRIMARY KEY | |
| workflow_id | TEXT UNIQUE NOT NULL | |
| parent_workflow_id | TEXT REFERENCES workflows(workflow_id) | self-ref for workflow tree |
| workflow_name | TEXT | Temporal workflow type name |
| run_id | TEXT NOT NULL | |
| status | TEXT NOT NULL | |
| start_time | TIMESTAMPTZ NOT NULL | |
| end_time | TIMESTAMPTZ | |
| input | JSONB | |
| output | JSONB | |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT NOW() | |

**`chat_workflows`** — chat-specific extension:

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PRIMARY KEY | |
| workflow_id | TEXT UNIQUE NOT NULL REFERENCES workflows(workflow_id) | |
| message_id | UUID | link to messages table |

**`column_generation_workflows`** — batch-specific extension:

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PRIMARY KEY | |
| workflow_id | TEXT UNIQUE NOT NULL REFERENCES workflows(workflow_id) | |
| batch_id | UUID NOT NULL | GenerationBatch.id from app DB |
| user_id | UUID REFERENCES users(id) | who triggered the batch |
| metadata | JSONB | full GenerationBatch snapshot |

**`activities`** — unchanged, FK stays on `workflows(workflow_id)`.

### Migration strategy (non-destructive)

All existing data is chat workflows. The migration must preserve it:

1. Create `chat_workflows` table
2. Populate: `INSERT INTO chat_workflows (workflow_id, message_id) SELECT workflow_id, message_id FROM workflows WHERE message_id IS NOT NULL`
3. Create `column_generation_workflows` table (empty)
4. Drop `message_id` column from `workflows`
5. Create indexes: `idx_chat_workflows_message_id` on `chat_workflows(message_id)`, `idx_column_generation_workflows_batch_id` on `column_generation_workflows(batch_id)`, `idx_column_generation_workflows_user_id` on `column_generation_workflows(user_id)`
6. Update existing code references from `workflows.message_id` to join through `chat_workflows`

## Sync Pipeline Changes

### Temporal sync

Add `list_generation_batch_workflow_ids` in `temporal_client.py`:
- Query: `WorkflowId STARTS_WITH "generation-batch-"`
- Returns same structure as `list_chat_workflow_ids`

Add `sync_temporal_generation_data` in `main.py`:
- Uses the same `_ingest_workflow` recursive function (already generic)
- After ingesting each root workflow, inserts into `column_generation_workflows` with `workflow_id` and `batch_id` (extracted from workflow ID: `generation-batch-<batchId>` → `batchId`)

Update existing `sync_temporal_data`:
- After upserting into `workflows`, also insert into `chat_workflows` with `workflow_id` + `message_id`
- Remove `message_id` from the `upsert_workflow` call

### App data sync

Add `sync_generation_batches` in `app_sync.py`:
- Reads `GenerationBatch` records from app DB (via existing `APP_DATABASE_URL` connection)
- For each batch: updates the matching `column_generation_workflows` row with `user_id` and full record as `metadata` JSONB
- Incremental: uses `sync_state` entity `"generation_batches"`, filters by `updatedAt`

### Sync order

1. App data sync: users, chats, messages, message_parts (unchanged)
2. Temporal chat workflows (updated to write `chat_workflows`)
3. Temporal generation batch workflows (new)
4. Generation batch metadata enrichment from app DB (new)

## UI Changes

### Navigation

Logo and title stay on the left as-is. Replace the Dashboard/Settings icon links on the right side of the header with a single dropdown menu:
- Items: "Chats", "Column Creations", "Dashboard", "Settings"
- Current page highlighted
- SyncButton, ThemeToggle, and "Chat now" link remain alongside the dropdown

### Route structure

```
/                                                → redirect to /chats
/chats                                           → chat list (current /, moved)
/chats/[id]                                      → chat messages (unchanged)
/chats/[id]/messages/[messageId]                 → workflow drill-down (unchanged)
/column-creations                                → batch list (new)
/column-creations/[batchId]                      → batch detail (new)
/column-creations/[batchId]?wf=<workflowId>     → child workflow drill-down (new)
/dashboard                                       → usage dashboard (updated)
/settings                                        → settings (unchanged)
```

### Column creation list page (`/column-creations`)

Table columns:
- Column name (resolved during sync: read `Resource.name` from app DB where `Resource.id = GenerationBatch.columnId`, stored in metadata JSONB as `columnName`)
- Prompt (truncated)
- Variant
- Rows (completedRows / totalRows)
- Status
- Cost (aggregated from child workflow activities)
- User (from user_id → users table)
- Date

Sorted by date descending. Same visual style as the chat list.

### Column creation detail page (`/column-creations/[batchId]`)

Header: batch metadata — column name, prompt, variant, row progress, status, user, cost summary.

Body: reuses the existing `ActivitySteps` component directly — it already handles activity list display (with type filtering, keyboard nav), JSON viewer (syntax-highlighted with search), markdown viewer (ReactMarkdown), token/cost/duration formatting, child workflow drill-down links, and breadcrumbs. The component is domain-agnostic; it takes activities, child workflows, breadcrumbs, and cost summary as props.

The only new code is the page wrapper that resolves the root workflow from a `batchId` (via `column_generation_workflows`) instead of a `messageId` (via `chat_workflows`). The `?wf=` drill-down pattern works identically.

### Dashboard updates

Existing charts and summary cards remain unchanged but are clearly labeled as "Chat" metrics (e.g. "Chat Costs", "Chat Usage by User"). Section headers or labels distinguish chat data from column creation data.

Add two new charts at the bottom:

1. **Column Creation Volume** — dual-axis line chart over time. Left Y-axis: number of columns created (count of `column_generation_workflows`). Right Y-axis: number of rows generated (sum of `metadata->>'totalRows'`). X-axis: date. Two lines, one per metric.

2. **Column Creation Cost** — line chart over time. Y-axis: cost in USD (aggregated from `invokeModel` activities under column generation workflows). X-axis: date. Same cost formula as existing charts.

New query functions in `dashboard.ts`:
- `getDailyColumnCreationVolume(from, to)` — returns `{day, columns_created, rows_generated}[]`
- `getDailyColumnCreationCosts(from, to)` — returns `{day, total_cost}[]`

### Query layer

New file `web/lib/queries/column-creations.ts`:
- `getColumnCreations()` — list all batches with cost aggregation
- `getColumnCreation(batchId)` — single batch detail
- `getColumnCreationCostSummary(batchId)` — cost for a batch (recursive over child workflows)

Update `web/lib/queries/activities.ts`:
- `getWorkflowForMessage` → join through `chat_workflows` instead of `workflows.message_id`
- `getMessageCost` → join through `chat_workflows`
- Breadcrumbs, child workflows, activities queries stay unchanged (they use the base `workflows` table)

Update `web/lib/queries/dashboard.ts`:
- All three functions updated to include column creation workflow costs
