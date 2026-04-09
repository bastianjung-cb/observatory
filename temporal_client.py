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
