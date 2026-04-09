# Temporal Observer — Design Spec

## Purpose

A Python script that polls a self-hosted Temporal server, extracts workflow and activity data for agent runs, and upserts it into PostgreSQL. Designed to run on a cron job, it must be idempotent — never creating duplicate rows.

## Context

Each Temporal workflow represents an agent run. Workflow IDs follow the pattern `chat-<uuid>`. Activities within these workflows represent LLM calls, tool calls, and other operations. We need to capture the inputs, outputs, types, and timing of both workflows and activities for observability.

## Architecture

### Components

1. **`main.py`** — Entry point. Connects to Temporal and Postgres, orchestrates the extract-and-load pipeline.
2. **`db.py`** — Postgres connection, schema initialization, and upsert functions.
3. **`temporal_client.py`** — Temporal SDK client, workflow listing, and history fetching.
4. **`docker-compose.yml`** — Postgres container for local development.

### Stack

- **Python 3.12+**
- **`temporalio`** — Temporal Python SDK (async)
- **`psycopg[binary]`** (v3) — Postgres driver with async support
- **Docker Compose** — Postgres setup

### Configuration

All via environment variables with local defaults:

| Variable | Default | Description |
|---|---|---|
| `TEMPORAL_HOST` | `localhost:7233` | Temporal gRPC address |
| `TEMPORAL_NAMESPACE` | `default` | Temporal namespace |
| `POSTGRES_HOST` | `localhost` | Postgres host |
| `POSTGRES_PORT` | `5432` | Postgres port |
| `POSTGRES_DB` | `observer` | Database name |
| `POSTGRES_USER` | `observer` | Database user |
| `POSTGRES_PASSWORD` | `observer` | Database password |

## Data Flow

1. Connect to Temporal and Postgres.
2. Ensure Postgres schema exists (create tables if missing).
3. List workflows matching `WorkflowId LIKE 'chat-%'` via Temporal's visibility query.
4. For each workflow:
   a. Check if workflow already exists in Postgres with a terminal status (COMPLETED, FAILED, CANCELED, TERMINATED, TIMED_OUT). If so, skip — it's fully ingested.
   b. Fetch workflow execution info (status, times).
   c. Fetch full event history.
   d. Parse activity events: pair `ActivityTaskScheduled` with `ActivityTaskCompleted`/`ActivityTaskFailed` to extract type, input, output, and timing.
   e. Extract the UUID from the workflow ID (`chat-<uuid>` -> `<uuid>`).
   f. Upsert workflow row.
   g. Upsert activity rows.
5. Close connections.

## Database Schema

```sql
CREATE TABLE IF NOT EXISTS workflows (
    id              SERIAL PRIMARY KEY,
    workflow_id     TEXT UNIQUE NOT NULL,
    chat_uuid       UUID NOT NULL,
    run_id          TEXT NOT NULL,
    status          TEXT NOT NULL,
    start_time      TIMESTAMPTZ NOT NULL,
    end_time        TIMESTAMPTZ,
    input           JSONB,
    output          JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activities (
    id              SERIAL PRIMARY KEY,
    workflow_id     TEXT NOT NULL REFERENCES workflows(workflow_id),
    activity_id     TEXT NOT NULL,
    activity_type   TEXT NOT NULL,
    status          TEXT NOT NULL,
    scheduled_time  TIMESTAMPTZ,
    started_time    TIMESTAMPTZ,
    completed_time  TIMESTAMPTZ,
    input           JSONB,
    output          JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workflow_id, activity_id)
);
```

## Duplicate Avoidance Strategy

Two layers:

1. **Skip check:** Before fetching history for a workflow, query Postgres. If the workflow exists with a terminal status, skip entirely. This avoids redundant Temporal API calls.
2. **Upsert:** `INSERT ... ON CONFLICT DO NOTHING` on `workflows(workflow_id)` and `activities(workflow_id, activity_id)`. This handles race conditions and partial ingestion from prior runs.

For workflows still in RUNNING status, we re-fetch and update them (using `ON CONFLICT (workflow_id) DO UPDATE`) so we capture the final status and any new activities.

## Docker Compose

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: observer
      POSTGRES_USER: observer
      POSTGRES_PASSWORD: observer
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

## Error Handling

- If Temporal is unreachable, fail fast with a clear error message.
- If Postgres is unreachable, fail fast with a clear error message.
- Individual workflow fetch failures are logged and skipped — the next cron run will retry them.
- All database operations for a single workflow (workflow upsert + activity upserts) happen in a single transaction.

## File Structure

```
observer_app/
  main.py              # Entry point
  db.py                # Postgres connection, schema, upserts
  temporal_client.py   # Temporal SDK client, listing, history parsing
  docker-compose.yml   # Postgres container
  pyproject.toml       # Dependencies
```
