# Precomputed Materialized Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace slow live aggregate queries on `/chats`, `/column-creations`, and `/dashboard` with three materialized views that the sync refreshes every 15 minutes.

**Architecture:** Three MVs (`mv_chat_stats`, `mv_column_creation_stats`, `mv_daily_activity_stats`) created `WITH NO DATA` via an alembic migration. A new 5th sync phase, `refresh_materialized_views`, runs `REFRESH MATERIALIZED VIEW CONCURRENTLY` when the view is populated and plain `REFRESH MATERIALIZED VIEW` on the first run. Page queries are rewritten to JOIN the MVs instead of computing aggregates live.

**Tech Stack:** PostgreSQL 16, psycopg 3, Alembic, Next.js 16, TypeScript, pytest.

**Spec:** `docs/superpowers/specs/2026-04-20-precomputed-views-design.md`

---

## File Structure

### New files
- `migrations/versions/<alembic_rev>_add_materialized_views.py` — DDL for 3 MVs + MV indexes + base-table indexes
- `tests/test_mv_refresh.py` — tests for the new refresh function

### Modified files
- `db.py` — `SCHEMA_SQL` and `INDEXES_SQL` gain the MV definitions (idempotent via `IF NOT EXISTS`) and the new base-table indexes, so fresh `init_schema` in tests produces the same shape as prod
- `app_sync.py` — new `refresh_materialized_views()` function
- `main.py` — new 5th phase in `run_sync`
- `tests/test_db.py` — fixture teardown drops the three MVs
- `tests/test_app_sync.py` — fixture teardown drops the three MVs
- `web/lib/queries/chats.ts` — read from `mv_chat_stats`, wrap in `unstable_cache`
- `web/lib/queries/column-creations.ts` — read from `mv_column_creation_stats`
- `web/lib/queries/dashboard.ts` — 4 queries use `mv_column_creation_stats`, 3 queries use `mv_daily_activity_stats`, `message_count` in `getUserCosts` stays live
- `web/app/actions.ts` — `runSync` adds `revalidateTag("chats")`

### Boundaries
- DB-layer DDL + Python refresh: `db.py`, `app_sync.py`, migration file — one concern: "keep MVs correct and fresh"
- Web-layer read-paths: `web/lib/queries/*.ts` — one concern: "render fast"
- Tests: per-module

---

## Task 1: Alembic migration — create 3 MVs + their indexes + base-table indexes

**Files:**
- Create: `migrations/versions/<alembic_rev>_add_materialized_views.py`

- [ ] **Step 1: Generate revision**

Run: `cd /mnt/observatory_dev && uv run alembic revision -m "add materialized views"`
Expected: writes a file under `migrations/versions/`. Note the revision id (e.g. `abc1234567ab`).

- [ ] **Step 2: Fill in the migration body**

Replace the body of the generated file (keep the auto-generated `revision` and `down_revision` values):

```python
"""add materialized views

Revision ID: <generated>
Revises: <previous_head>
Create Date: 2026-04-20 ...

"""
from alembic import op


revision = "<generated>"
down_revision = "<previous_head>"
branch_labels = None
depends_on = None


MV_CHAT_STATS = """
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_chat_stats AS
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
"""


MV_COLUMN_CREATION_STATS = """
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_column_creation_stats AS
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
"""


MV_DAILY_ACTIVITY_STATS = """
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_activity_stats AS
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
"""


MV_INDEXES = """
CREATE UNIQUE INDEX IF NOT EXISTS mv_chat_stats_chat_id ON mv_chat_stats(chat_id);
CREATE INDEX IF NOT EXISTS mv_chat_stats_last_message ON mv_chat_stats(last_message_at DESC NULLS LAST);

CREATE UNIQUE INDEX IF NOT EXISTS mv_cgw_stats_workflow_id ON mv_column_creation_stats(workflow_id);
CREATE UNIQUE INDEX IF NOT EXISTS mv_cgw_stats_batch_id ON mv_column_creation_stats(batch_id);
CREATE INDEX IF NOT EXISTS mv_cgw_stats_start_time ON mv_column_creation_stats(start_time DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS mv_cgw_stats_user_id ON mv_column_creation_stats(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS mv_daily_unique ON mv_daily_activity_stats(day, source, user_id, model_id) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS mv_daily_source_day ON mv_daily_activity_stats(source, day DESC);
"""


BASE_TABLE_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_activities_invokemodel ON activities(workflow_id) WHERE activity_type = 'invokeModel';
CREATE INDEX IF NOT EXISTS idx_activities_invokemodel_scheduled ON activities(scheduled_time) WHERE activity_type = 'invokeModel';
CREATE INDEX IF NOT EXISTS idx_chat_workflows_workflow_id ON chat_workflows(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflows_parent_workflow_id_workflow_id ON workflows(parent_workflow_id, workflow_id);
"""


def upgrade() -> None:
    op.execute(MV_CHAT_STATS)
    op.execute(MV_COLUMN_CREATION_STATS)
    op.execute(MV_DAILY_ACTIVITY_STATS)
    op.execute(MV_INDEXES)
    op.execute(BASE_TABLE_INDEXES)


def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS mv_daily_activity_stats")
    op.execute("DROP MATERIALIZED VIEW IF EXISTS mv_column_creation_stats")
    op.execute("DROP MATERIALIZED VIEW IF EXISTS mv_chat_stats")
    op.execute("DROP INDEX IF EXISTS idx_workflows_parent_workflow_id_workflow_id")
    op.execute("DROP INDEX IF EXISTS idx_chat_workflows_workflow_id")
    op.execute("DROP INDEX IF EXISTS idx_activities_invokemodel_scheduled")
    op.execute("DROP INDEX IF EXISTS idx_activities_invokemodel")
```

- [ ] **Step 3: Apply migration**

Run: `cd /mnt/observatory_dev && OBSERVER_DATABASE_URL="postgresql://observer:observer@localhost:5437/observer" uv run alembic upgrade head`
Expected: migration applies without error.

- [ ] **Step 4: Verify MVs exist and are empty**

Run: `psql "postgresql://observer:observer@localhost:5437/observer" -c "SELECT matviewname, ispopulated FROM pg_matviews WHERE schemaname='public' ORDER BY matviewname;"`
Expected:
```
        matviewname         | ispopulated 
----------------------------+-------------
 mv_chat_stats              | f
 mv_column_creation_stats   | f
 mv_daily_activity_stats    | f
```

- [ ] **Step 5: Commit**

```bash
git add migrations/versions/<alembic_rev>_add_materialized_views.py
git commit -m "Add materialized views for lists + dashboard"
```

---

## Task 2: Update `db.py` SCHEMA_SQL + INDEXES_SQL for test parity

**Files:**
- Modify: `db.py:9-133` (append MV + index definitions)

- [ ] **Step 1: Add MV DDL to `SCHEMA_SQL` block**

At the end of `SCHEMA_SQL` string in `db.py` (right before the closing `"""`), append the three `CREATE MATERIALIZED VIEW IF NOT EXISTS ... WITH NO DATA` statements verbatim from Task 1's migration (MV_CHAT_STATS, MV_COLUMN_CREATION_STATS, MV_DAILY_ACTIVITY_STATS).

- [ ] **Step 2: Add MV + base-table indexes to `INDEXES_SQL`**

At the end of `INDEXES_SQL` string, append the MV_INDEXES and BASE_TABLE_INDEXES blocks verbatim from Task 1.

- [ ] **Step 3: Verify fresh init_schema produces MVs**

Run:
```bash
cd /mnt/observatory_dev && psql "postgresql://observer:observer@localhost:5437/observer" -c "
DROP MATERIALIZED VIEW IF EXISTS mv_chat_stats, mv_column_creation_stats, mv_daily_activity_stats CASCADE;
" && \
  TEST_DATABASE_URL="postgresql://observer:observer@localhost:5437/observer" uv run python -c "
import psycopg
from db import init_schema
conn = psycopg.connect('postgresql://observer:observer@localhost:5437/observer')
init_schema(conn)
with conn.cursor() as cur:
    cur.execute(\"SELECT matviewname FROM pg_matviews WHERE schemaname='public' ORDER BY matviewname\")
    print([row[0] for row in cur.fetchall()])
conn.close()
"
```
Expected: `['mv_chat_stats', 'mv_column_creation_stats', 'mv_daily_activity_stats']`.

- [ ] **Step 4: Run full test suite to confirm no regressions**

Run: `cd /mnt/observatory_dev && TEST_DATABASE_URL="postgresql://observer:observer@localhost:5437/observer" uv run pytest -v`
Expected: all tests pass. Tests that drop tables via fixture may fail with dependency errors — Task 3 fixes that.

- [ ] **Step 5: Commit**

```bash
git add db.py
git commit -m "db.py: include materialized views in init_schema"
```

---

## Task 3: Test fixtures drop MVs in teardown

**Files:**
- Modify: `tests/test_db.py` — fixture `db_conn`
- Modify: `tests/test_app_sync.py` — fixture `observer_conn`

- [ ] **Step 1: Update `tests/test_db.py` fixture**

In the `db_conn` fixture in `tests/test_db.py`, add MV drops BEFORE the existing table drops (MVs depend on tables — drop in reverse dependency order):

```python
@pytest.fixture
def db_conn():
    conn = psycopg.connect(POSTGRES_DSN)
    yield conn
    with conn.cursor() as cur:
        cur.execute("DROP MATERIALIZED VIEW IF EXISTS mv_daily_activity_stats CASCADE")
        cur.execute("DROP MATERIALIZED VIEW IF EXISTS mv_column_creation_stats CASCADE")
        cur.execute("DROP MATERIALIZED VIEW IF EXISTS mv_chat_stats CASCADE")
        cur.execute("DROP TABLE IF EXISTS column_generation_workflows CASCADE")
        cur.execute("DROP TABLE IF EXISTS chat_workflows CASCADE")
        cur.execute("DROP TABLE IF EXISTS activities CASCADE")
        cur.execute("DROP TABLE IF EXISTS workflows CASCADE")
        cur.execute("DROP TABLE IF EXISTS message_parts CASCADE")
        cur.execute("DROP TABLE IF EXISTS messages CASCADE")
        cur.execute("DROP TABLE IF EXISTS chats CASCADE")
        cur.execute("DROP TABLE IF EXISTS users CASCADE")
        cur.execute("DROP TABLE IF EXISTS sync_state CASCADE")
        cur.execute("DROP TABLE IF EXISTS settings CASCADE")
        cur.execute("DROP TABLE IF EXISTS model_pricing CASCADE")
    conn.commit()
    conn.close()
```

- [ ] **Step 2: Update `tests/test_app_sync.py` fixture (same edit)**

Same three `DROP MATERIALIZED VIEW IF EXISTS ... CASCADE` lines added before the table drops in the `observer_conn` fixture.

- [ ] **Step 3: Run full test suite**

Run: `cd /mnt/observatory_dev && TEST_DATABASE_URL="postgresql://observer:observer@localhost:5437/observer" uv run pytest -v`
Expected: all tests pass cleanly across multiple runs.

- [ ] **Step 4: Commit**

```bash
git add tests/test_db.py tests/test_app_sync.py
git commit -m "Test fixtures: drop materialized views in teardown"
```

---

## Task 4: Implement `refresh_materialized_views` + tests (TDD)

**Files:**
- Modify: `app_sync.py` — add `refresh_materialized_views` at the end of the file
- Create: `tests/test_mv_refresh.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_mv_refresh.py`:

```python
import os
import json
import uuid
from datetime import datetime, timezone

import psycopg
import pytest

POSTGRES_DSN = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql://observer:observer@localhost:5436/observer",
)


@pytest.fixture
def observer_conn():
    conn = psycopg.connect(POSTGRES_DSN)
    yield conn
    with conn.cursor() as cur:
        cur.execute("DROP MATERIALIZED VIEW IF EXISTS mv_daily_activity_stats CASCADE")
        cur.execute("DROP MATERIALIZED VIEW IF EXISTS mv_column_creation_stats CASCADE")
        cur.execute("DROP MATERIALIZED VIEW IF EXISTS mv_chat_stats CASCADE")
        cur.execute("DROP TABLE IF EXISTS column_generation_workflows CASCADE")
        cur.execute("DROP TABLE IF EXISTS chat_workflows CASCADE")
        cur.execute("DROP TABLE IF EXISTS activities CASCADE")
        cur.execute("DROP TABLE IF EXISTS workflows CASCADE")
        cur.execute("DROP TABLE IF EXISTS message_parts CASCADE")
        cur.execute("DROP TABLE IF EXISTS messages CASCADE")
        cur.execute("DROP TABLE IF EXISTS chats CASCADE")
        cur.execute("DROP TABLE IF EXISTS users CASCADE")
        cur.execute("DROP TABLE IF EXISTS sync_state CASCADE")
        cur.execute("DROP TABLE IF EXISTS settings CASCADE")
        cur.execute("DROP TABLE IF EXISTS model_pricing CASCADE")
    conn.commit()
    conn.close()


def _seed_minimal(conn):
    """One user, one chat, one message, one workflow, one invokeModel activity."""
    user_id = "11111111-1111-1111-1111-111111111111"
    chat_id = "22222222-2222-2222-2222-222222222222"
    msg_id = "33333333-3333-3333-3333-333333333333"
    wf_id = "chat-test-001"
    t = datetime(2026, 1, 1, tzinfo=timezone.utc)
    with conn.cursor() as cur:
        cur.execute("INSERT INTO users (id, auth_id, email) VALUES (%s, %s, %s)",
                    (user_id, "auth-1", "user@example.com"))
        cur.execute("INSERT INTO chats (id, title, created_at, updated_at, user_id) "
                    "VALUES (%s, 'Test', %s, %s, %s)",
                    (chat_id, t, t, user_id))
        cur.execute('INSERT INTO messages (id, "order", role, created_at, chat_id) '
                    "VALUES (%s, 0, 'user', %s, %s)",
                    (msg_id, t, chat_id))
        cur.execute("INSERT INTO workflows (workflow_id, run_id, status, start_time, end_time) "
                    "VALUES (%s, 'run-1', 'COMPLETED', %s, %s)",
                    (wf_id, t, t))
        cur.execute("INSERT INTO chat_workflows (workflow_id, message_id) VALUES (%s, %s)",
                    (wf_id, msg_id))
        cur.execute(
            "INSERT INTO activities (workflow_id, activity_id, activity_type, status, "
            "scheduled_time, started_time, completed_time, input, output) "
            "VALUES (%s, '1', 'invokeModel', 'COMPLETED', %s, %s, %s, %s::jsonb, %s::jsonb)",
            (
                wf_id, t, t, t,
                json.dumps({"modelId": "vertex:gemini-3-flash-preview"}),
                json.dumps({"usage": {"inputTokens": {"total": 100, "noCache": 100}, "outputTokens": {"total": 50, "text": 50}}}),
            ),
        )
    conn.commit()
    return user_id, chat_id, msg_id, wf_id


def test_refresh_populates_all_three_mvs(observer_conn):
    from db import init_schema
    from app_sync import refresh_materialized_views

    init_schema(observer_conn)
    _seed_minimal(observer_conn)

    refresh_materialized_views(observer_conn)

    with observer_conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM mv_chat_stats")
        assert cur.fetchone()[0] == 1
        cur.execute("SELECT COUNT(*) FROM mv_daily_activity_stats")
        assert cur.fetchone()[0] == 1
        cur.execute("SELECT COUNT(*) FROM mv_column_creation_stats")
        assert cur.fetchone()[0] == 0  # no cgw rows seeded

        cur.execute("SELECT message_count, total_cost_usd, llm_calls FROM mv_chat_stats")
        row = cur.fetchone()
        assert row[0] == 1
        assert row[1] > 0
        assert row[2] == 1

        cur.execute("SELECT source, total_input_tokens, total_output_tokens, llm_calls FROM mv_daily_activity_stats")
        row = cur.fetchone()
        assert row[0] == "chat"
        assert row[1] == 100
        assert row[2] == 50
        assert row[3] == 1


def test_refresh_is_idempotent_uses_concurrently_on_second_run(observer_conn, caplog):
    import logging
    caplog.set_level(logging.INFO)
    from db import init_schema
    from app_sync import refresh_materialized_views

    init_schema(observer_conn)
    _seed_minimal(observer_conn)

    refresh_materialized_views(observer_conn)
    first_messages = [r.message for r in caplog.records if "Refreshed mv_" in r.message]
    assert any("blocking" in m for m in first_messages)

    caplog.clear()
    refresh_materialized_views(observer_conn)
    second_messages = [r.message for r in caplog.records if "Refreshed mv_" in r.message]
    assert any("CONCURRENTLY" in m for m in second_messages)

    # Data still consistent
    with observer_conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM mv_chat_stats")
        assert cur.fetchone()[0] == 1


def test_refresh_continues_if_one_mv_fails(observer_conn, caplog):
    import logging
    caplog.set_level(logging.ERROR)
    from db import init_schema
    from app_sync import refresh_materialized_views

    init_schema(observer_conn)
    _seed_minimal(observer_conn)

    # Drop one MV to force a refresh failure on it
    with observer_conn.cursor() as cur:
        cur.execute("DROP MATERIALIZED VIEW mv_chat_stats")
    observer_conn.commit()

    refresh_materialized_views(observer_conn)

    # Error logged for the missing one
    assert any("mv_chat_stats" in r.message for r in caplog.records if r.levelno >= logging.ERROR)

    # Other two still populated
    with observer_conn.cursor() as cur:
        cur.execute("SELECT ispopulated FROM pg_matviews WHERE matviewname = 'mv_column_creation_stats'")
        assert cur.fetchone()[0] is True
        cur.execute("SELECT ispopulated FROM pg_matviews WHERE matviewname = 'mv_daily_activity_stats'")
        assert cur.fetchone()[0] is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /mnt/observatory_dev && TEST_DATABASE_URL="postgresql://observer:observer@localhost:5437/observer" uv run pytest tests/test_mv_refresh.py -v`
Expected: fail with `ImportError: cannot import name 'refresh_materialized_views'`.

- [ ] **Step 3: Add `refresh_materialized_views` to `app_sync.py`**

Append to the end of `app_sync.py`:

```python
import time

_MATERIALIZED_VIEWS = (
    "mv_chat_stats",
    "mv_column_creation_stats",
    "mv_daily_activity_stats",
)


def refresh_materialized_views(observer_conn: psycopg.Connection) -> None:
    """Refresh the dashboard/list MVs.

    Uses CONCURRENTLY when the MV is already populated; falls back to plain
    REFRESH on first run (CONCURRENTLY can't run on an unpopulated MV).
    Each MV is refreshed in its own try/except — one failure doesn't block
    the others. Caller commits at phase boundaries."""
    for mv_name in _MATERIALIZED_VIEWS:
        try:
            t0 = time.monotonic()
            with observer_conn.cursor() as cur:
                cur.execute(
                    "SELECT ispopulated FROM pg_matviews "
                    "WHERE schemaname = 'public' AND matviewname = %s",
                    (mv_name,),
                )
                row = cur.fetchone()
                if row is None:
                    raise RuntimeError(f"materialized view {mv_name} does not exist")
                populated = bool(row[0])
            mode = "CONCURRENTLY" if populated else ""
            # mv_name is hardcoded — safe to interpolate.
            with observer_conn.cursor() as cur:
                cur.execute(f"REFRESH MATERIALIZED VIEW {mode} {mv_name}")
            observer_conn.commit()
            logger.info(
                "Refreshed %s (%s) in %.2fs",
                mv_name,
                mode or "blocking",
                time.monotonic() - t0,
            )
        except Exception:
            logger.exception("Failed to refresh %s; continuing", mv_name)
            observer_conn.rollback()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /mnt/observatory_dev && TEST_DATABASE_URL="postgresql://observer:observer@localhost:5437/observer" uv run pytest tests/test_mv_refresh.py -v`
Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app_sync.py tests/test_mv_refresh.py
git commit -m "Add refresh_materialized_views + tests"
```

---

## Task 5: Wire `refresh_materialized_views` into `run_sync`

**Files:**
- Modify: `main.py` — add 5th phase in `run_sync`

- [ ] **Step 1: Update `run_sync`**

In `main.py`, locate `run_sync` (the function that wraps each phase in try/except). After the existing `try` block for `sync_generation_batches`, add a 5th phase:

```python
        try:
            logger.info("Phase: refresh_materialized_views")
            from app_sync import refresh_materialized_views
            refresh_materialized_views(observer_conn)
        except Exception:
            logger.exception("Phase refresh_materialized_views failed; continuing")
            observer_conn.rollback()
```

Place this after the `sync_generation_batches` try block and before the `finally: observer_conn.close()`.

- [ ] **Step 2: Verify module imports**

Run: `cd /mnt/observatory_dev && uv run python -c "import main; print('ok')"`
Expected: `ok`.

- [ ] **Step 3: Run full test suite**

Run: `cd /mnt/observatory_dev && TEST_DATABASE_URL="postgresql://observer:observer@localhost:5437/observer" uv run pytest -v`
Expected: all pass.

- [ ] **Step 4: Smoke-test a full sync**

Run:
```bash
cd /mnt/observatory_dev && \
  OBSERVER_DATABASE_URL="postgresql://observer:observer@localhost:5437/observer" \
  APP_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/cellbyte" \
  TEMPORAL_HOST="localhost:7233" \
  uv run python main.py --skip-migrations 2>&1 | grep -E "Phase|Refreshed|Failed"
```
Expected: output includes `Phase: refresh_materialized_views` and three `Refreshed mv_...` lines. First run logs `blocking`, subsequent runs `CONCURRENTLY`.

- [ ] **Step 5: Commit**

```bash
git add main.py
git commit -m "run_sync: add refresh_materialized_views as phase 5"
```

---

## Task 6: Rewrite `web/lib/queries/chats.ts`

**Files:**
- Modify: `web/lib/queries/chats.ts` (full rewrite)

- [ ] **Step 1: Replace file contents**

Replace `web/lib/queries/chats.ts` with:

```typescript
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
```

- [ ] **Step 2: TypeScript check**

Run: `cd /mnt/observatory_dev && make -C . typecheck 2>&1 | tail -15`
Expected: no errors.

- [ ] **Step 3: Build and smoke-test**

Run:
```bash
cd /mnt/observatory_dev/web && npm run build 2>&1 | tail -10
```
Expected: successful build.

- [ ] **Step 4: Verify the page renders**

(Requires a previous sync + deployed web.) Run: `curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:9101/chats`
Expected: `HTTP 200`.

- [ ] **Step 5: Commit**

```bash
git add web/lib/queries/chats.ts
git commit -m "chats query: read from mv_chat_stats + cache with tag"
```

---

## Task 7: Rewrite `web/lib/queries/column-creations.ts`

**Files:**
- Modify: `web/lib/queries/column-creations.ts`

- [ ] **Step 1: Replace `_getColumnCreations` body**

In `web/lib/queries/column-creations.ts`, replace the SQL construction inside `_getColumnCreations` so it reads from the MV. The resulting function body:

```typescript
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

  const orderCol = SORT_COLUMNS[sortKey] || "created_at";
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
```

Also update the `SORT_COLUMNS` map at the top of the file (current map references `w.status` — switch to the MV column name):

```typescript
const SORT_COLUMNS: Record<SortKey, string> = {
  column_name: "cgw.column_name",
  variant: "cgw.variant",
  rows: "cgw.total_rows",
  status: "cgw.status",
  cost: "cgw.total_cost_usd",
  user: "user_name",
  date: "cgw.start_time",
};
```

- [ ] **Step 2: Update `getColumnCreation` (detail fetch)**

Replace the `getColumnCreation(batchId)` function to pull from the MV:

```typescript
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
```

Note: The existing `ColumnCreationDetail.metadata` type is `Record<string, unknown> | null`. We reconstruct a subset JSON object from MV columns for compatibility — consumers that expect `metadata.columnName`, `metadata.status`, etc., keep working.

- [ ] **Step 3: Leave `getColumnCreationCostSummary` as-is**

That function is only used on the detail page and returns workflow-level token totals + cost. It already reads efficiently (single workflow) and isn't in scope for MV migration.

- [ ] **Step 4: TypeScript check**

Run: `cd /mnt/observatory_dev/web && npx tsc --noEmit 2>&1 | tail -10`
Expected: no errors.

- [ ] **Step 5: Build**

Run: `cd /mnt/observatory_dev/web && npm run build 2>&1 | tail -5`
Expected: successful build.

- [ ] **Step 6: Smoke-test**

Run: `curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:9101/column-creations`
Expected: `HTTP 200`.

- [ ] **Step 7: Commit**

```bash
git add web/lib/queries/column-creations.ts
git commit -m "column-creations query: read from mv_column_creation_stats"
```

---

## Task 8: Rewrite `web/lib/queries/dashboard.ts`

**Files:**
- Modify: `web/lib/queries/dashboard.ts`

This task rewrites all 7 exported functions. `getUserCosts` keeps a live subquery for `message_count` (user decision); everything else reads from MVs.

- [ ] **Step 1: Replace `getDailyCosts`**

```typescript
export const getDailyCosts = unstable_cache(
  async (from: string, to: string): Promise<DailyCost[]> => {
    const result = await pool.query(
      `SELECT
         to_char(day, 'YYYY-MM-DD') as day,
         SUM(total_cost_usd)::float as total_cost,
         SUM(total_input_tokens)::bigint as total_input_tokens,
         SUM(total_output_tokens)::bigint as total_output_tokens,
         (SUM(total_input_tokens) + SUM(total_output_tokens))::bigint as total_tokens
       FROM mv_daily_activity_stats
       WHERE source = 'chat'
         AND day >= $1::date
         AND day <= $2::date
       GROUP BY day
       ORDER BY day`,
      [from, to]
    );
    return result.rows;
  },
  ["dashboard:daily-costs"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: CACHE_TAGS }
);
```

- [ ] **Step 2: Replace `getUserCosts`**

Cost grouped by user from the MV; `message_count` stays a live subquery.

```typescript
export const getUserCosts = unstable_cache(
  async (from: string, to: string, limit = 20): Promise<UserCost[]> => {
    const result = await pool.query(
      `SELECT
         COALESCE(u.given_name || ' ' || u.family_name, u.email, 'Unknown') AS user_name,
         u.email AS user_email,
         SUM(s.total_cost_usd)::float AS total_cost,
         (
           SELECT COUNT(DISTINCT m.id)::int
           FROM messages m
           JOIN chat_workflows cw ON cw.message_id = m.id
           JOIN activities a ON a.workflow_id = cw.workflow_id AND a.activity_type = 'invokeModel'
           WHERE a.scheduled_time >= $1::timestamptz
             AND a.scheduled_time < ($2::timestamptz + interval '1 day')
             AND m.chat_id IN (SELECT id FROM chats WHERE user_id = u.id)
         ) AS message_count
       FROM mv_daily_activity_stats s
       JOIN users u ON u.id = s.user_id
       WHERE s.source = 'chat'
         AND s.day >= $1::date
         AND s.day <= $2::date
       GROUP BY u.id, u.given_name, u.family_name, u.email
       ORDER BY total_cost DESC
       LIMIT $3`,
      [from, to, limit]
    );
    return result.rows;
  },
  ["dashboard:user-costs"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: CACHE_TAGS }
);
```

- [ ] **Step 3: Replace `getCostSummary`**

```typescript
export const getCostSummary = unstable_cache(
  async (from: string, to: string): Promise<CostSummaryCard> => {
    const result = await pool.query(
      `SELECT
         COALESCE(SUM(s.total_cost_usd), 0)::float AS total_cost,
         COALESCE(SUM(s.total_input_tokens) + SUM(s.total_output_tokens), 0)::bigint AS total_tokens,
         COALESCE(SUM(s.llm_calls), 0)::int AS total_llm_calls,
         (
           SELECT COUNT(DISTINCT c.id)::int
           FROM chats c
           JOIN messages m ON m.chat_id = c.id
           JOIN chat_workflows cw ON cw.message_id = m.id
           JOIN activities a ON a.workflow_id = cw.workflow_id AND a.activity_type = 'invokeModel'
           WHERE a.scheduled_time >= $1::timestamptz
             AND a.scheduled_time < ($2::timestamptz + interval '1 day')
         ) AS total_chats
       FROM mv_daily_activity_stats s
       WHERE s.source = 'chat'
         AND s.day >= $1::date
         AND s.day <= $2::date`,
      [from, to]
    );
    return result.rows[0];
  },
  ["dashboard:cost-summary"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: CACHE_TAGS }
);
```

- [ ] **Step 4: Replace `getColGenSummary`**

```typescript
export const getColGenSummary = unstable_cache(
  async (from: string, to: string): Promise<ColGenSummaryCard> => {
    const result = await pool.query(
      `SELECT
         COALESCE(SUM(total_cost_usd), 0)::float AS total_cost,
         COALESCE(SUM(llm_calls), 0)::int AS total_llm_calls,
         COUNT(*)::int AS total_columns,
         COALESCE(SUM(total_rows), 0)::int AS total_cells
       FROM mv_column_creation_stats
       WHERE start_time >= $1::timestamptz
         AND start_time < ($2::timestamptz + interval '1 day')`,
      [from, to]
    );
    return result.rows[0];
  },
  ["dashboard:colgen-summary"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: CACHE_TAGS }
);
```

- [ ] **Step 5: Replace `getDailyColumnCreationVolume`**

```typescript
export const getDailyColumnCreationVolume = unstable_cache(
  async (from: string, to: string): Promise<DailyColumnCreationVolume[]> => {
    const result = await pool.query(
      `SELECT
         to_char(date_trunc('day', start_time), 'YYYY-MM-DD') AS day,
         COUNT(*)::int AS columns_created,
         COALESCE(SUM(total_rows), 0)::int AS rows_generated
       FROM mv_column_creation_stats
       WHERE start_time >= $1::timestamptz
         AND start_time < ($2::timestamptz + interval '1 day')
       GROUP BY date_trunc('day', start_time)
       ORDER BY day`,
      [from, to]
    );
    return result.rows;
  },
  ["dashboard:colgen-volume"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: CACHE_TAGS }
);
```

- [ ] **Step 6: Replace `getUserColumnCreationStats`**

```typescript
export const getUserColumnCreationStats = unstable_cache(
  async (from: string, to: string, limit = 20): Promise<UserColumnCreation[]> => {
    const result = await pool.query(
      `SELECT
         COALESCE(u.given_name || ' ' || u.family_name, u.email, 'Unknown') AS user_name,
         u.email AS user_email,
         COUNT(*)::int AS columns_created,
         COALESCE(SUM(cgw.total_rows), 0)::int AS rows_generated
       FROM mv_column_creation_stats cgw
       LEFT JOIN users u ON u.id = cgw.user_id
       WHERE cgw.start_time >= $1::timestamptz
         AND cgw.start_time < ($2::timestamptz + interval '1 day')
       GROUP BY u.id, u.given_name, u.family_name, u.email
       ORDER BY columns_created DESC
       LIMIT $3`,
      [from, to, limit]
    );
    return result.rows;
  },
  ["dashboard:colgen-user-stats"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: CACHE_TAGS }
);
```

- [ ] **Step 7: Replace `getDailyColumnCreationCosts`**

```typescript
export const getDailyColumnCreationCosts = unstable_cache(
  async (from: string, to: string): Promise<DailyColumnCreationCost[]> => {
    const result = await pool.query(
      `SELECT
         to_char(day, 'YYYY-MM-DD') AS day,
         SUM(total_cost_usd)::float AS total_cost
       FROM mv_daily_activity_stats
       WHERE source = 'colgen'
         AND day >= $1::date
         AND day <= $2::date
       GROUP BY day
       ORDER BY day`,
      [from, to]
    );
    return result.rows;
  },
  ["dashboard:colgen-daily-costs"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: CACHE_TAGS }
);
```

- [ ] **Step 8: TypeScript check + build**

Run: `cd /mnt/observatory_dev/web && npx tsc --noEmit && npm run build 2>&1 | tail -10`
Expected: no errors, successful build.

- [ ] **Step 9: Smoke-test**

Run: `curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:9101/dashboard`
Expected: `HTTP 200`.

- [ ] **Step 10: Commit**

```bash
git add web/lib/queries/dashboard.ts
git commit -m "dashboard queries: read from materialized views"
```

---

## Task 9: Add `revalidateTag("chats")` to runSync action

**Files:**
- Modify: `web/app/actions.ts`

- [ ] **Step 1: Edit the action**

In `web/app/actions.ts` inside the success branch of `runSync`, add one line after the existing `revalidateTag("column-creations")` call:

```typescript
revalidatePath("/");
revalidateTag("dashboard", { expire: 0 });
revalidateTag("column-creations", { expire: 0 });
revalidateTag("chats", { expire: 0 });
```

- [ ] **Step 2: TypeScript check + build**

Run: `cd /mnt/observatory_dev/web && npx tsc --noEmit && npm run build 2>&1 | tail -5`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/app/actions.ts
git commit -m "runSync action: invalidate chats cache tag"
```

---

## Task 10: Manual verification

**Files:** none modified.

- [ ] **Step 1: Rebuild and restart the dev web server**

Run:
```bash
make -C /mnt/observatory_dev deploy
```
Expected: build succeeds, server listening on port 9101.

- [ ] **Step 2: Snapshot state before sync**

Run:
```bash
psql "postgresql://observer:observer@localhost:5437/observer" -c "
SELECT matviewname, ispopulated,
       (SELECT count(*) FROM pg_stat_user_tables WHERE relname = matviewname) as dummy
FROM pg_matviews WHERE schemaname='public' ORDER BY matviewname;
"
```
Expected: all three MVs listed; `ispopulated` may be `f` (first run) or `t` (if earlier steps already populated).

- [ ] **Step 3: Hit Sync and observe logs**

Click the Sync button in the web UI (or `curl -X POST http://localhost:9101/api/sync` if there's an endpoint) or run `make -C /mnt/observatory_dev sync`.

Tail: `tail -f /mnt/observatory_dev/logs/sync.log | grep -E "Phase|Refreshed"`

Expected: line `Phase: refresh_materialized_views` followed by three `Refreshed mv_...` lines (`blocking` on first, `CONCURRENTLY` on subsequent).

- [ ] **Step 4: Verify MVs are populated**

Run:
```bash
psql "postgresql://observer:observer@localhost:5437/observer" -c "
SELECT
  (SELECT COUNT(*) FROM mv_chat_stats) AS chat_stats,
  (SELECT COUNT(*) FROM mv_column_creation_stats) AS cgw_stats,
  (SELECT COUNT(*) FROM mv_daily_activity_stats) AS daily_stats;
"
```
Expected: non-zero counts (≥1 each, depending on what data is in the observer DB).

- [ ] **Step 5: Time the page loads**

Run three curls, timed:
```bash
for page in chats column-creations dashboard; do
  curl -s -o /dev/null -w "$page: %{time_total}s (HTTP %{http_code})\n" http://localhost:9101/$page
done
```
Expected: all three under 500 ms; HTTP 200.

- [ ] **Step 6: Visually inspect pages**

Open `http://localhost:9101/chats`, `/column-creations`, `/dashboard` in a browser. Confirm:
- Data renders.
- Default sorts behave correctly.
- Text searches still work on chats (search box filters chats containing the term in user name, title, or message content).
- Column-creations filters (column, user, status) still work.
- Dashboard charts render with non-zero data.

- [ ] **Step 7: Time one more sync to confirm CONCURRENTLY mode**

Run `make sync` again. `tail -n 20 logs/sync.log | grep Refreshed`. Expected: each `Refreshed mv_...` line says `(CONCURRENTLY)`.

- [ ] **Step 8: Document outcome**

Append a short section to the end of this plan file with:
- Population counts after first refresh.
- Refresh durations (blocking vs CONCURRENTLY) per MV.
- Page load times before/after (optional — eyeball, not benchmark).
- Any rendering regressions observed.

No code commit required.

---

## Self-review notes

**Spec coverage:**
- MV 1 definition: Task 1 + Task 2 (SCHEMA_SQL mirror).
- MV 2 definition: Task 1 + Task 2.
- MV 3 definition: Task 1 + Task 2.
- MV indexes: Task 1 + Task 2.
- Base-table indexes: Task 1 + Task 2.
- Refresh function + tests: Task 4.
- Wire into run_sync: Task 5.
- chats.ts rewrite + cache: Task 6.
- column-creations.ts list rewrite: Task 7.
- column-creations.ts detail rewrite (getColumnCreation): Task 7 step 2.
- dashboard.ts rewrites (7 functions, including live `message_count` subquery): Task 8.
- revalidateTag("chats"): Task 9.
- Manual verification (migration, sync, page smoke, rebench): Task 10.

**Spec `message_count` in `UserCost` stays live** — Task 8 step 2 preserves the distinct-message-count semantics via a correlated subquery.

**Types / consistency:**
- `mv_chat_stats.chat_id` matches `chats.id` (uuid).
- `mv_column_creation_stats.workflow_id` matches `column_generation_workflows.workflow_id` (text).
- `mv_column_creation_stats.batch_id` matches `column_generation_workflows.batch_id` (uuid) — detail page casts `$1::uuid` to match.
- `mv_daily_activity_stats.day` is `date` (not timestamptz). Dashboard queries use `$1::date` / `$2::date` — no timezone mismatch.
- `ColumnCreationDetail.metadata` shape preserved via `jsonb_build_object` in Task 7 step 2.

**Known non-goals referenced in spec:** detail-page MVs (skipped), incremental updates (skipped), LISTEN/NOTIFY triggers (skipped).

**Risks in plan:**
- Task 2 changes `INDEXES_SQL` to include MV indexes. `init_schema` runs `INDEXES_SQL` before `SEED_PRICING_SQL`, and the MV indexes reference MVs that also live in SCHEMA_SQL → MV must be created before its index. Confirm Task 2 step 1 appends MVs to SCHEMA_SQL (which runs first) and step 2 appends MV indexes to INDEXES_SQL (which runs second). Order preserved.
- Task 5 is tiny but critical — missing commit = MVs never refresh in production.
- Task 8 introduces a semantic drift for `getDailyColumnCreationCosts`: the existing implementation buckets by `activity.scheduled_time`, the new implementation does too (via `mv_daily_activity_stats.day`). ✓ matches spec.
