# Temporal Observer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Python script that extracts workflow and activity data from Temporal and upserts it into PostgreSQL, idempotently.

**Architecture:** Three Python modules — `db.py` (Postgres schema + upserts), `temporal_client.py` (Temporal SDK listing + history parsing), and `main.py` (orchestration). Docker Compose provides a local Postgres. The script is async end-to-end using `temporalio` and `psycopg` v3.

**Tech Stack:** Python 3.12+, `temporalio`, `psycopg[binary]` (v3), Docker Compose, PostgreSQL 17

---

## File Structure

| File | Responsibility |
|---|---|
| `docker-compose.yml` | Postgres 16 container for local dev |
| `pyproject.toml` | Project metadata and dependencies |
| `db.py` | Postgres connection, schema init, upsert functions |
| `temporal_client.py` | Temporal client, workflow listing, history parsing |
| `main.py` | Entry point, orchestrates extract-and-load pipeline |
| `tests/test_db.py` | Tests for db module (schema init, upserts, duplicate handling) |
| `tests/test_temporal_client.py` | Tests for history parsing logic |
| `tests/test_main.py` | Integration test for the full pipeline |

---

### Task 1: Project Setup — Docker Compose and Dependencies

**Files:**
- Create: `docker-compose.yml`
- Modify: `pyproject.toml`

- [ ] **Step 1: Create `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:17
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

- [ ] **Step 2: Update `pyproject.toml` with dependencies**

```toml
[project]
name = "observer-app"
version = "0.1.0"
description = "Extracts Temporal workflow/activity data into PostgreSQL"
readme = "README.md"
requires-python = ">=3.12"
dependencies = [
    "temporalio>=1.9.0",
    "psycopg[binary]>=3.2.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.24.0",
]
```

- [ ] **Step 3: Start Postgres and install dependencies**

```bash
docker compose up -d
pip install -e ".[dev]"
```

Run: `docker compose ps` — expect postgres container running on port 5432.
Run: `python -c "import psycopg; import temporalio; print('ok')"` — expect `ok`.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml pyproject.toml
git commit -m "feat: add docker-compose for Postgres and project dependencies"
```

---

### Task 2: Database Module — Schema and Upserts

**Files:**
- Create: `db.py`
- Create: `tests/test_db.py`

- [ ] **Step 1: Write failing tests for schema initialization**

Create `tests/__init__.py` (empty) and `tests/test_db.py`:

```python
import pytest
import psycopg

POSTGRES_DSN = "postgresql://observer:observer@localhost:5432/observer"


@pytest.fixture
def db_conn():
    conn = psycopg.connect(POSTGRES_DSN)
    yield conn
    # Clean up tables after each test
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS activities CASCADE")
        cur.execute("DROP TABLE IF EXISTS workflows CASCADE")
    conn.commit()
    conn.close()


def test_init_schema_creates_tables(db_conn):
    from db import init_schema

    init_schema(db_conn)

    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name IN ('workflows', 'activities') "
            "ORDER BY table_name"
        )
        tables = [row[0] for row in cur.fetchall()]

    assert tables == ["activities", "workflows"]


def test_init_schema_is_idempotent(db_conn):
    from db import init_schema

    init_schema(db_conn)
    init_schema(db_conn)  # Should not raise

    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name IN ('workflows', 'activities') "
            "ORDER BY table_name"
        )
        tables = [row[0] for row in cur.fetchall()]

    assert tables == ["activities", "workflows"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_db.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'db'`

- [ ] **Step 3: Implement `init_schema` in `db.py`**

```python
from __future__ import annotations

import psycopg

SCHEMA_SQL = """
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
"""


def init_schema(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute(SCHEMA_SQL)
    conn.commit()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_db.py -v`
Expected: 2 tests PASS

- [ ] **Step 5: Write failing tests for workflow upsert**

Append to `tests/test_db.py`:

```python
from datetime import datetime, timezone


def _sample_workflow(workflow_id="chat-9e138348-0b53-407e-900e-ccacb83ecf6f"):
    return {
        "workflow_id": workflow_id,
        "chat_uuid": "9e138348-0b53-407e-900e-ccacb83ecf6f",
        "run_id": "run-abc-123",
        "status": "COMPLETED",
        "start_time": datetime(2026, 1, 1, tzinfo=timezone.utc),
        "end_time": datetime(2026, 1, 1, 0, 5, tzinfo=timezone.utc),
        "input": {"prompt": "hello"},
        "output": {"response": "world"},
    }


def test_upsert_workflow_inserts_new(db_conn):
    from db import init_schema, upsert_workflow

    init_schema(db_conn)
    upsert_workflow(db_conn, _sample_workflow())

    with db_conn.cursor() as cur:
        cur.execute("SELECT workflow_id, status FROM workflows")
        row = cur.fetchone()

    assert row[0] == "chat-9e138348-0b53-407e-900e-ccacb83ecf6f"
    assert row[1] == "COMPLETED"


def test_upsert_workflow_updates_running_to_completed(db_conn):
    from db import init_schema, upsert_workflow

    init_schema(db_conn)

    running = _sample_workflow()
    running["status"] = "RUNNING"
    running["end_time"] = None
    running["output"] = None
    upsert_workflow(db_conn, running)

    completed = _sample_workflow()
    upsert_workflow(db_conn, completed)

    with db_conn.cursor() as cur:
        cur.execute("SELECT status, end_time FROM workflows")
        row = cur.fetchone()

    assert row[0] == "COMPLETED"
    assert row[1] is not None


def test_upsert_workflow_skips_terminal_duplicate(db_conn):
    from db import init_schema, upsert_workflow

    init_schema(db_conn)
    upsert_workflow(db_conn, _sample_workflow())
    upsert_workflow(db_conn, _sample_workflow())  # Should not raise

    with db_conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM workflows")
        assert cur.fetchone()[0] == 1
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `pytest tests/test_db.py -v`
Expected: FAIL with `ImportError: cannot import name 'upsert_workflow'`

- [ ] **Step 7: Implement `upsert_workflow` in `db.py`**

Append to `db.py`:

```python
import json
from typing import Any


TERMINAL_STATUSES = frozenset({
    "COMPLETED", "FAILED", "CANCELED", "TERMINATED", "TIMED_OUT",
})

UPSERT_WORKFLOW_SQL = """
INSERT INTO workflows (workflow_id, chat_uuid, run_id, status, start_time, end_time, input, output)
VALUES (%(workflow_id)s, %(chat_uuid)s, %(run_id)s, %(status)s, %(start_time)s, %(end_time)s, %(input)s, %(output)s)
ON CONFLICT (workflow_id) DO UPDATE SET
    status = EXCLUDED.status,
    end_time = EXCLUDED.end_time,
    input = EXCLUDED.input,
    output = EXCLUDED.output
"""


def upsert_workflow(conn: psycopg.Connection, workflow: dict[str, Any]) -> None:
    params = {
        **workflow,
        "input": json.dumps(workflow["input"]) if workflow["input"] is not None else None,
        "output": json.dumps(workflow["output"]) if workflow["output"] is not None else None,
    }
    with conn.cursor() as cur:
        cur.execute(UPSERT_WORKFLOW_SQL, params)
    conn.commit()
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pytest tests/test_db.py -v`
Expected: 5 tests PASS

- [ ] **Step 9: Write failing tests for activity upsert**

Append to `tests/test_db.py`:

```python
def _sample_activity(activity_id="1"):
    return {
        "workflow_id": "chat-9e138348-0b53-407e-900e-ccacb83ecf6f",
        "activity_id": activity_id,
        "activity_type": "llm_call",
        "status": "COMPLETED",
        "scheduled_time": datetime(2026, 1, 1, 0, 0, 1, tzinfo=timezone.utc),
        "started_time": datetime(2026, 1, 1, 0, 0, 2, tzinfo=timezone.utc),
        "completed_time": datetime(2026, 1, 1, 0, 0, 3, tzinfo=timezone.utc),
        "input": {"model": "gpt-4", "prompt": "hello"},
        "output": {"response": "hi"},
    }


def test_upsert_activities_inserts(db_conn):
    from db import init_schema, upsert_workflow, upsert_activities

    init_schema(db_conn)
    upsert_workflow(db_conn, _sample_workflow())
    upsert_activities(db_conn, [_sample_activity("1"), _sample_activity("2")])

    with db_conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM activities")
        assert cur.fetchone()[0] == 2


def test_upsert_activities_skips_duplicates(db_conn):
    from db import init_schema, upsert_workflow, upsert_activities

    init_schema(db_conn)
    upsert_workflow(db_conn, _sample_workflow())
    upsert_activities(db_conn, [_sample_activity("1")])
    upsert_activities(db_conn, [_sample_activity("1")])  # Duplicate

    with db_conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM activities")
        assert cur.fetchone()[0] == 1
```

- [ ] **Step 10: Run tests to verify they fail**

Run: `pytest tests/test_db.py -v`
Expected: FAIL with `ImportError: cannot import name 'upsert_activities'`

- [ ] **Step 11: Implement `upsert_activities` in `db.py`**

Append to `db.py`:

```python
UPSERT_ACTIVITY_SQL = """
INSERT INTO activities (workflow_id, activity_id, activity_type, status, scheduled_time, started_time, completed_time, input, output)
VALUES (%(workflow_id)s, %(activity_id)s, %(activity_type)s, %(status)s, %(scheduled_time)s, %(started_time)s, %(completed_time)s, %(input)s, %(output)s)
ON CONFLICT (workflow_id, activity_id) DO NOTHING
"""


def upsert_activities(conn: psycopg.Connection, activities: list[dict[str, Any]]) -> None:
    with conn.cursor() as cur:
        for activity in activities:
            params = {
                **activity,
                "input": json.dumps(activity["input"]) if activity["input"] is not None else None,
                "output": json.dumps(activity["output"]) if activity["output"] is not None else None,
            }
            cur.execute(UPSERT_ACTIVITY_SQL, params)
    conn.commit()
```

- [ ] **Step 12: Run tests to verify they pass**

Run: `pytest tests/test_db.py -v`
Expected: 7 tests PASS

- [ ] **Step 13: Write failing test for `is_workflow_terminal`**

Append to `tests/test_db.py`:

```python
def test_is_workflow_terminal_returns_true_for_completed(db_conn):
    from db import init_schema, upsert_workflow, is_workflow_terminal

    init_schema(db_conn)
    upsert_workflow(db_conn, _sample_workflow())

    assert is_workflow_terminal(db_conn, "chat-9e138348-0b53-407e-900e-ccacb83ecf6f") is True


def test_is_workflow_terminal_returns_false_for_running(db_conn):
    from db import init_schema, upsert_workflow, is_workflow_terminal

    init_schema(db_conn)
    running = _sample_workflow()
    running["status"] = "RUNNING"
    upsert_workflow(db_conn, running)

    assert is_workflow_terminal(db_conn, "chat-9e138348-0b53-407e-900e-ccacb83ecf6f") is False


def test_is_workflow_terminal_returns_false_for_unknown(db_conn):
    from db import init_schema, is_workflow_terminal

    init_schema(db_conn)

    assert is_workflow_terminal(db_conn, "chat-nonexistent") is False
```

- [ ] **Step 14: Run tests to verify they fail**

Run: `pytest tests/test_db.py -v`
Expected: FAIL with `ImportError: cannot import name 'is_workflow_terminal'`

- [ ] **Step 15: Implement `is_workflow_terminal` in `db.py`**

Append to `db.py`:

```python
def is_workflow_terminal(conn: psycopg.Connection, workflow_id: str) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT status FROM workflows WHERE workflow_id = %s",
            (workflow_id,),
        )
        row = cur.fetchone()
    if row is None:
        return False
    return row[0] in TERMINAL_STATUSES
```

- [ ] **Step 16: Run tests to verify they pass**

Run: `pytest tests/test_db.py -v`
Expected: 10 tests PASS

- [ ] **Step 17: Commit**

```bash
git add db.py tests/__init__.py tests/test_db.py
git commit -m "feat: add db module with schema init, upsert, and terminal check"
```

---

### Task 3: Temporal Client Module — Listing and History Parsing

**Files:**
- Create: `temporal_client.py`
- Create: `tests/test_temporal_client.py`

- [ ] **Step 1: Write failing test for `parse_activities_from_history`**

The history parsing logic is pure — it takes a list of history events and returns structured activity dicts. We can test this without a real Temporal server by constructing mock event objects.

Create `tests/test_temporal_client.py`:

```python
from datetime import datetime, timezone
from unittest.mock import MagicMock
from google.protobuf.timestamp_pb2 import Timestamp
from temporalio.api.common.v1 import Payloads, Payload
from temporalio.api.history.v1 import HistoryEvent
from temporalio.api.enums.v1 import EventType
import json


def _make_timestamp(dt: datetime) -> Timestamp:
    ts = Timestamp()
    ts.FromDatetime(dt)
    return ts


def _make_payload(data: dict) -> Payload:
    return Payload(data=json.dumps(data).encode())


def test_parse_activities_from_history_completed():
    from temporal_client import parse_activities_from_history

    scheduled_time = datetime(2026, 1, 1, 0, 0, 1, tzinfo=timezone.utc)
    started_time = datetime(2026, 1, 1, 0, 0, 2, tzinfo=timezone.utc)
    completed_time = datetime(2026, 1, 1, 0, 0, 3, tzinfo=timezone.utc)

    # Build mock events matching Temporal's protobuf structure
    scheduled_event = MagicMock()
    scheduled_event.event_type = EventType.EVENT_TYPE_ACTIVITY_TASK_SCHEDULED
    scheduled_event.event_id = 5
    scheduled_event.event_time = _make_timestamp(scheduled_time)
    scheduled_event.activity_task_scheduled_event_attributes.activity_type.name = "llm_call"
    scheduled_event.activity_task_scheduled_event_attributes.input.payloads = [_make_payload({"prompt": "hello"})]

    started_event = MagicMock()
    started_event.event_type = EventType.EVENT_TYPE_ACTIVITY_TASK_STARTED
    started_event.event_time = _make_timestamp(started_time)
    started_event.activity_task_started_event_attributes.scheduled_event_id = 5

    completed_event = MagicMock()
    completed_event.event_type = EventType.EVENT_TYPE_ACTIVITY_TASK_COMPLETED
    completed_event.event_time = _make_timestamp(completed_time)
    completed_event.activity_task_completed_event_attributes.scheduled_event_id = 5
    completed_event.activity_task_completed_event_attributes.result.payloads = [_make_payload({"response": "hi"})]

    events = [scheduled_event, started_event, completed_event]
    activities = parse_activities_from_history(events)

    assert len(activities) == 1
    act = activities[0]
    assert act["activity_id"] == "5"
    assert act["activity_type"] == "llm_call"
    assert act["status"] == "COMPLETED"
    assert act["input"] == {"prompt": "hello"}
    assert act["output"] == {"response": "hi"}
    assert act["scheduled_time"] == scheduled_time
    assert act["started_time"] == started_time
    assert act["completed_time"] == completed_time


def test_parse_activities_from_history_failed():
    from temporal_client import parse_activities_from_history

    scheduled_time = datetime(2026, 1, 1, 0, 0, 1, tzinfo=timezone.utc)
    failed_time = datetime(2026, 1, 1, 0, 0, 3, tzinfo=timezone.utc)

    scheduled_event = MagicMock()
    scheduled_event.event_type = EventType.EVENT_TYPE_ACTIVITY_TASK_SCHEDULED
    scheduled_event.event_id = 7
    scheduled_event.event_time = _make_timestamp(scheduled_time)
    scheduled_event.activity_task_scheduled_event_attributes.activity_type.name = "tool_call"
    scheduled_event.activity_task_scheduled_event_attributes.input.payloads = [_make_payload({"tool": "search"})]

    failed_event = MagicMock()
    failed_event.event_type = EventType.EVENT_TYPE_ACTIVITY_TASK_FAILED
    failed_event.event_time = _make_timestamp(failed_time)
    failed_event.activity_task_failed_event_attributes.scheduled_event_id = 7

    events = [scheduled_event, failed_event]
    activities = parse_activities_from_history(events)

    assert len(activities) == 1
    act = activities[0]
    assert act["activity_id"] == "7"
    assert act["activity_type"] == "tool_call"
    assert act["status"] == "FAILED"
    assert act["output"] is None
    assert act["completed_time"] == failed_time
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_temporal_client.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'temporal_client'`

- [ ] **Step 3: Implement `temporal_client.py`**

```python
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

from temporalio.api.enums.v1 import EventType
from temporalio.client import Client

logger = logging.getLogger(__name__)

TEMPORAL_HOST = os.environ.get("TEMPORAL_HOST", "localhost:7233")
TEMPORAL_NAMESPACE = os.environ.get("TEMPORAL_NAMESPACE", "default")


async def get_client() -> Client:
    return await Client.connect(TEMPORAL_HOST, namespace=TEMPORAL_NAMESPACE)


async def list_chat_workflow_ids(client: Client) -> list[dict[str, str]]:
    """List all workflow executions matching chat-* pattern.

    Returns list of dicts with workflow_id, run_id, and status.
    """
    workflows = []
    async for wf in client.list_workflows('WorkflowId LIKE "chat-%"'):
        workflows.append({
            "workflow_id": wf.id,
            "run_id": wf.run_id,
            "status": wf.status.name if wf.status else "UNKNOWN",
            "start_time": wf.start_time,
            "close_time": wf.close_time,
        })
    return workflows


def _decode_payloads(payloads) -> Any | None:
    """Decode the first payload from a Payloads message as JSON."""
    try:
        if payloads and len(payloads) > 0:
            raw = payloads[0].data
            return json.loads(raw)
    except (json.JSONDecodeError, IndexError, AttributeError):
        pass
    return None


def _event_time_to_datetime(event_time) -> datetime | None:
    """Convert a protobuf Timestamp to a timezone-aware datetime."""
    try:
        return event_time.ToDatetime().replace(tzinfo=timezone.utc)
    except (AttributeError, ValueError):
        return None


def parse_activities_from_history(events: list) -> list[dict[str, Any]]:
    """Parse activity events from a workflow history into structured dicts."""
    scheduled: dict[int, dict[str, Any]] = {}
    activities: list[dict[str, Any]] = []

    for event in events:
        if event.event_type == EventType.EVENT_TYPE_ACTIVITY_TASK_SCHEDULED:
            attrs = event.activity_task_scheduled_event_attributes
            scheduled[event.event_id] = {
                "activity_id": str(event.event_id),
                "activity_type": attrs.activity_type.name,
                "status": "SCHEDULED",
                "scheduled_time": _event_time_to_datetime(event.event_time),
                "started_time": None,
                "completed_time": None,
                "input": _decode_payloads(attrs.input.payloads),
                "output": None,
            }

        elif event.event_type == EventType.EVENT_TYPE_ACTIVITY_TASK_STARTED:
            attrs = event.activity_task_started_event_attributes
            sched_id = attrs.scheduled_event_id
            if sched_id in scheduled:
                scheduled[sched_id]["started_time"] = _event_time_to_datetime(event.event_time)

        elif event.event_type == EventType.EVENT_TYPE_ACTIVITY_TASK_COMPLETED:
            attrs = event.activity_task_completed_event_attributes
            sched_id = attrs.scheduled_event_id
            if sched_id in scheduled:
                entry = scheduled.pop(sched_id)
                entry["status"] = "COMPLETED"
                entry["completed_time"] = _event_time_to_datetime(event.event_time)
                entry["output"] = _decode_payloads(attrs.result.payloads)
                activities.append(entry)

        elif event.event_type == EventType.EVENT_TYPE_ACTIVITY_TASK_FAILED:
            attrs = event.activity_task_failed_event_attributes
            sched_id = attrs.scheduled_event_id
            if sched_id in scheduled:
                entry = scheduled.pop(sched_id)
                entry["status"] = "FAILED"
                entry["completed_time"] = _event_time_to_datetime(event.event_time)
                activities.append(entry)

    # Any still-scheduled activities (no completion event yet)
    for entry in scheduled.values():
        activities.append(entry)

    return activities


async def fetch_workflow_history(client: Client, workflow_id: str, run_id: str) -> list:
    """Fetch full event history for a workflow execution."""
    handle = client.get_workflow_handle(workflow_id, run_id=run_id)
    events = []
    async for event in handle.fetch_history_events():
        events.append(event)
    return events
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_temporal_client.py -v`
Expected: 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add temporal_client.py tests/test_temporal_client.py
git commit -m "feat: add temporal_client module with listing and history parsing"
```

---

### Task 4: Main Orchestration Script

**Files:**
- Modify: `main.py`

- [ ] **Step 1: Implement `main.py`**

```python
from __future__ import annotations

import asyncio
import logging
import os
import sys

import psycopg

from db import init_schema, is_workflow_terminal, upsert_activities, upsert_workflow
from temporal_client import (
    _decode_payloads,
    fetch_workflow_history,
    get_client,
    list_chat_workflow_ids,
    parse_activities_from_history,
)
from temporalio.api.enums.v1 import EventType

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

POSTGRES_DSN = "postgresql://{user}:{password}@{host}:{port}/{db}".format(
    user=os.environ.get("POSTGRES_USER", "observer"),
    password=os.environ.get("POSTGRES_PASSWORD", "observer"),
    host=os.environ.get("POSTGRES_HOST", "localhost"),
    port=os.environ.get("POSTGRES_PORT", "5432"),
    db=os.environ.get("POSTGRES_DB", "observer"),
)


def _extract_uuid(workflow_id: str) -> str:
    """Extract UUID from workflow_id like 'chat-9e138348-...'."""
    return workflow_id.removeprefix("chat-")


async def run() -> None:
    logger.info("Connecting to Temporal...")
    temporal_client = await get_client()

    logger.info("Connecting to Postgres...")
    conn = psycopg.connect(POSTGRES_DSN)

    try:
        init_schema(conn)

        logger.info("Listing chat workflows from Temporal...")
        workflows = await list_chat_workflow_ids(temporal_client)
        logger.info("Found %d chat workflows", len(workflows))

        ingested = 0
        skipped = 0

        for wf in workflows:
            wf_id = wf["workflow_id"]

            if is_workflow_terminal(conn, wf_id):
                skipped += 1
                continue

            try:
                logger.info("Processing workflow %s", wf_id)
                events = await fetch_workflow_history(
                    temporal_client, wf_id, wf["run_id"]
                )

                activities = parse_activities_from_history(events)

                workflow_data = {
                    "workflow_id": wf_id,
                    "chat_uuid": _extract_uuid(wf_id),
                    "run_id": wf["run_id"],
                    "status": wf["status"],
                    "start_time": wf["start_time"],
                    "end_time": wf["close_time"],
                    "input": None,
                    "output": None,
                }

                # Extract workflow input/output from history if available
                for event in events:
                    if event.event_type == EventType.EVENT_TYPE_WORKFLOW_EXECUTION_STARTED:
                        attrs = event.workflow_execution_started_event_attributes
                        workflow_data["input"] = _decode_payloads(attrs.input.payloads)
                    elif event.event_type == EventType.EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED:
                        attrs = event.workflow_execution_completed_event_attributes
                        workflow_data["output"] = _decode_payloads(attrs.result.payloads)

                upsert_workflow(conn, workflow_data)

                for act in activities:
                    act["workflow_id"] = wf_id
                upsert_activities(conn, activities)

                ingested += 1
            except Exception:
                logger.exception("Failed to process workflow %s, skipping", wf_id)
                continue

        logger.info(
            "Done. Ingested: %d, Skipped (already terminal): %d", ingested, skipped
        )
    finally:
        conn.close()


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verify script can at least be imported without errors**

Run: `python -c "import main; print('ok')"`
Expected: `ok` (will fail to actually run without Temporal, but should import cleanly)

- [ ] **Step 3: Commit**

```bash
git add main.py
git commit -m "feat: add main orchestration script for temporal-to-postgres pipeline"
```

---

### Task 5: Manual Integration Test

This is a manual smoke test against real Temporal + Postgres.

- [ ] **Step 1: Ensure Postgres is running**

Run: `docker compose up -d && docker compose ps`
Expected: postgres container is `Up`

- [ ] **Step 2: Run the script (requires Temporal to be running)**

Run: `python main.py`

If Temporal is running with chat-* workflows, expect log output showing workflows listed, processed, and ingested. If Temporal is not available, expect a connection error — that's fine for now.

- [ ] **Step 3: Verify data in Postgres**

```bash
docker compose exec postgres psql -U observer -d observer -c "SELECT workflow_id, status FROM workflows LIMIT 5;"
docker compose exec postgres psql -U observer -d observer -c "SELECT workflow_id, activity_type, status FROM activities LIMIT 10;"
```

- [ ] **Step 4: Run idempotency test — run script again**

Run: `python main.py`
Then verify counts haven't changed:

```bash
docker compose exec postgres psql -U observer -d observer -c "SELECT count(*) FROM workflows;"
docker compose exec postgres psql -U observer -d observer -c "SELECT count(*) FROM activities;"
```

- [ ] **Step 5: Final commit with any fixes**

```bash
git add -A
git commit -m "chore: finalize temporal observer pipeline"
```
