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
