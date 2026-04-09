from __future__ import annotations

import json
from typing import Any

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
WHERE workflows.status NOT IN ('COMPLETED', 'FAILED', 'CANCELED', 'TERMINATED', 'TIMED_OUT')
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
