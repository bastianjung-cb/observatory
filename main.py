from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
import psycopg

load_dotenv(Path(__file__).parent / ".env")

from app_sync import sync_app_data
from db import TERMINAL_STATUSES, run_migrations, init_schema, is_workflow_terminal, upsert_activities, upsert_workflow, upsert_chat_workflow, upsert_column_generation_workflow
from temporal_client import (
    _decode_payloads,
    fetch_workflow_history,
    get_client,
    list_chat_workflow_ids,
    list_generation_batch_workflow_ids,
    parse_activities_from_history,
    parse_child_workflows_from_history,
)
from temporalio.api.enums.v1 import EventType

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

OBSERVER_DATABASE_URL = os.environ.get(
    "OBSERVER_DATABASE_URL",
    "postgresql://observer:observer@localhost:5436/observer",
)
APP_DATABASE_URL = os.environ.get(
    "APP_DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/cellbyte",
)


def _extract_message_id(workflow_id: str) -> str | None:
    """Extract message UUID from workflow_id like 'chat-9e138348-...'."""
    if not workflow_id.startswith("chat-"):
        return None
    return workflow_id.removeprefix("chat-")


async def _ingest_workflow(
    temporal_client,
    observer_conn: psycopg.Connection,
    workflow_id: str,
    run_id: str,
    parent_workflow_id: str | None,
    workflow_name: str | None,
    status: str,
    start_time,
    end_time,
) -> int:
    """Ingest a single workflow and its children recursively. Returns count ingested."""
    events = await fetch_workflow_history(temporal_client, workflow_id, run_id)

    activities = parse_activities_from_history(events)
    child_workflows = parse_child_workflows_from_history(events)

    workflow_data: dict[str, Any] = {
        "workflow_id": workflow_id,
        "parent_workflow_id": parent_workflow_id,
        "workflow_name": workflow_name,
        "run_id": run_id,
        "status": status,
        "start_time": start_time,
        "end_time": end_time,
        "input": None,
        "output": None,
    }

    for event in events:
        if event.event_type == EventType.EVENT_TYPE_WORKFLOW_EXECUTION_STARTED:
            attrs = event.workflow_execution_started_event_attributes
            workflow_data["input"] = _decode_payloads(attrs.input.payloads)
        elif event.event_type == EventType.EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED:
            attrs = event.workflow_execution_completed_event_attributes
            workflow_data["output"] = _decode_payloads(attrs.result.payloads)

    upsert_workflow(observer_conn, workflow_data)

    for act in activities:
        act["workflow_id"] = workflow_id
    upsert_activities(observer_conn, activities)
    observer_conn.commit()

    ingested = 1

    # Recursively ingest child workflows
    for child in child_workflows:
        if "run_id" not in child:
            continue  # Child not yet started
        try:
            ingested += await _ingest_workflow(
                temporal_client=temporal_client,
                observer_conn=observer_conn,
                workflow_id=child["workflow_id"],
                run_id=child["run_id"],
                parent_workflow_id=workflow_id,
                workflow_name=child.get("workflow_type"),
                status=child["status"],
                start_time=child.get("started_time") or child.get("initiated_time"),
                end_time=child.get("completed_time"),
            )
        except Exception:
            logger.exception("Failed to process child workflow %s, skipping", child["workflow_id"])

    return ingested


async def sync_temporal_data(observer_conn: psycopg.Connection) -> None:
    """Sync workflow and activity data from Temporal into observer DB."""
    logger.info("Connecting to Temporal...")
    temporal_client = await get_client()

    logger.info("Listing chat workflows from Temporal...")
    workflows = await list_chat_workflow_ids(temporal_client)
    logger.info("Found %d chat workflows", len(workflows))

    ingested = 0
    skipped = 0

    for wf in workflows:
        wf_id = wf["workflow_id"]

        if wf["status"] not in TERMINAL_STATUSES:
            logger.debug("Skipping non-terminal workflow %s (status=%s)", wf_id, wf["status"])
            skipped += 1
            continue

        if is_workflow_terminal(observer_conn, wf_id):
            skipped += 1
            continue

        try:
            logger.info("Processing workflow %s", wf_id)
            ingested += await _ingest_workflow(
                temporal_client=temporal_client,
                observer_conn=observer_conn,
                workflow_id=wf_id,
                run_id=wf["run_id"],
                parent_workflow_id=None,
                workflow_name=None,
                status=wf["status"],
                start_time=wf["start_time"],
                end_time=wf["close_time"],
            )
            message_id = _extract_message_id(wf_id)
            if message_id:
                upsert_chat_workflow(observer_conn, wf_id, message_id)
        except Exception:
            logger.exception("Failed to process workflow %s, skipping", wf_id)
            continue

    logger.info(
        "Temporal sync done. Ingested: %d, Skipped: %d", ingested, skipped
    )


def _extract_batch_id(workflow_id: str) -> str | None:
    """Extract batch UUID from workflow_id like 'generation-batch-550e8400-...'."""
    if not workflow_id.startswith("generation-batch-"):
        return None
    return workflow_id.removeprefix("generation-batch-")


async def sync_temporal_generation_data(observer_conn: psycopg.Connection) -> None:
    """Sync generation batch workflow data from Temporal into observer DB."""
    logger.info("Connecting to Temporal for generation batches...")
    temporal_client = await get_client()

    logger.info("Listing generation batch workflows from Temporal...")
    workflows = await list_generation_batch_workflow_ids(temporal_client)
    logger.info("Found %d generation batch workflows", len(workflows))

    ingested = 0
    skipped = 0

    for wf in workflows:
        wf_id = wf["workflow_id"]

        if wf["status"] not in TERMINAL_STATUSES:
            skipped += 1
            continue

        if is_workflow_terminal(observer_conn, wf_id):
            skipped += 1
            continue

        try:
            logger.info("Processing generation workflow %s", wf_id)
            ingested += await _ingest_workflow(
                temporal_client=temporal_client,
                observer_conn=observer_conn,
                workflow_id=wf_id,
                run_id=wf["run_id"],
                parent_workflow_id=None,
                workflow_name="generateBatchWorkflow",
                status=wf["status"],
                start_time=wf["start_time"],
                end_time=wf["close_time"],
            )
            batch_id = _extract_batch_id(wf_id)
            if batch_id:
                upsert_column_generation_workflow(observer_conn, {
                    "workflow_id": wf_id,
                    "batch_id": batch_id,
                    "user_id": None,
                    "metadata": None,
                })
                observer_conn.commit()
        except Exception:
            logger.exception("Failed to process generation workflow %s, skipping", wf_id)
            continue

    logger.info("Generation temporal sync done. Ingested: %d, Skipped: %d", ingested, skipped)


async def run_sync() -> None:
    """Run the full sync pipeline: app data + temporal data."""
    logger.info("Connecting to observer DB...")
    observer_conn = psycopg.connect(OBSERVER_DATABASE_URL)

    try:
        init_schema(observer_conn)

        # Sync app data (users, chats, messages, message_parts)
        try:
            logger.info("Connecting to app DB...")
            app_conn = psycopg.connect(APP_DATABASE_URL)
            try:
                sync_app_data(app_conn, observer_conn)
            finally:
                app_conn.close()
        except Exception:
            logger.exception("App data sync failed, continuing with temporal sync")
            observer_conn.rollback()

        # Sync temporal data (chat workflows + activities)
        await sync_temporal_data(observer_conn)

        # Sync temporal data (generation batch workflows + activities)
        await sync_temporal_generation_data(observer_conn)

        # Enrich generation batches with app DB metadata
        try:
            logger.info("Connecting to app DB for generation batch enrichment...")
            app_conn = psycopg.connect(APP_DATABASE_URL)
            try:
                from app_sync import sync_generation_batches
                sync_generation_batches(app_conn, observer_conn)
            finally:
                app_conn.close()
        except Exception:
            logger.exception("Generation batch enrichment failed")
            observer_conn.rollback()

    finally:
        observer_conn.close()


def main() -> None:
    import sys
    if "--skip-migrations" not in sys.argv:
        logger.info("Running migrations...")
        run_migrations(OBSERVER_DATABASE_URL)
    asyncio.run(run_sync())


if __name__ == "__main__":
    main()
