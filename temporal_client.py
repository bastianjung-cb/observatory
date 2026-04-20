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


async def _list_workflows_since(
    client: Client,
    id_prefix: str,
    since: datetime | None,
) -> list[dict[str, Any]]:
    """List workflows whose WorkflowId starts with `id_prefix`:
    all currently Running + all closed with CloseTime > `since`.

    `since=None` → no lower bound on CloseTime (initial sync / backfill).
    Dedup'd by workflow_id.
    """
    seen: dict[str, dict[str, Any]] = {}

    async for wf in client.list_workflows(
        f'WorkflowId STARTS_WITH "{id_prefix}" AND ExecutionStatus = "Running"'
    ):
        seen[wf.id] = {
            "workflow_id": wf.id,
            "run_id": wf.run_id,
            "status": wf.status.name if wf.status else "UNKNOWN",
            "start_time": wf.start_time,
            "close_time": wf.close_time,
        }

    if since is None:
        closed_query = f'WorkflowId STARTS_WITH "{id_prefix}" AND ExecutionStatus != "Running"'
    else:
        closed_query = (
            f'WorkflowId STARTS_WITH "{id_prefix}" '
            f'AND ExecutionStatus != "Running" '
            f'AND CloseTime > "{since.isoformat()}"'
        )
    async for wf in client.list_workflows(closed_query):
        if wf.id in seen:
            continue
        seen[wf.id] = {
            "workflow_id": wf.id,
            "run_id": wf.run_id,
            "status": wf.status.name if wf.status else "UNKNOWN",
            "start_time": wf.start_time,
            "close_time": wf.close_time,
        }

    return list(seen.values())


async def list_chat_workflow_ids(
    client: Client, since: datetime | None = None
) -> list[dict[str, Any]]:
    """Chat workflows currently Running + closed since `since`."""
    return await _list_workflows_since(client, "chat-", since)


async def list_generation_batch_workflow_ids(
    client: Client, since: datetime | None = None
) -> list[dict[str, Any]]:
    """generation-batch workflows currently Running + closed since `since`."""
    return await _list_workflows_since(client, "generation-batch-", since)


def _decode_payloads(payloads) -> Any | None:
    """Decode payloads from a Temporal activity. Returns a single value if one payload, or a list if multiple."""
    try:
        if not payloads or len(payloads) == 0:
            return None
        decoded = []
        for p in payloads:
            try:
                decoded.append(json.loads(p.data))
            except (json.JSONDecodeError, AttributeError) as exc:
                logger.debug("JSON decode failed for payload, falling back to string: %s", exc)
                try:
                    decoded.append(p.data.decode("utf-8"))
                except Exception as inner_exc:
                    logger.debug("UTF-8 decode failed for payload, using str(): %s", inner_exc)
                    decoded.append(str(p.data))
        if len(decoded) == 1:
            return decoded[0]
        return decoded
    except (IndexError, AttributeError) as exc:
        logger.debug("Failed to decode payloads: %s", exc)
    return None


def _event_time_to_datetime(event_time) -> datetime | None:
    """Convert a protobuf Timestamp to a timezone-aware datetime."""
    try:
        return event_time.ToDatetime().replace(tzinfo=timezone.utc)
    except (AttributeError, ValueError):
        return None


def parse_activities_from_history(events: list) -> list[dict[str, Any]]:
    """Parse activity events from a workflow history into structured dicts.

    Keyed by the SCHEDULED event_id (same id we store in observer as `activity_id`).
    Terminal: COMPLETED / FAILED / CANCELED / TIMED_OUT. Still-open: SCHEDULED.
    """
    scheduled: dict[int, dict[str, Any]] = {}
    activities: list[dict[str, Any]] = []

    for event in events:
        if event.event_type == EventType.EVENT_TYPE_ACTIVITY_TASK_SCHEDULED:
            attrs = event.activity_task_scheduled_event_attributes
            scheduled[event.event_id] = {
                "activity_id": str(event.event_id),
                "activity_type": attrs.activity_type.name,
                "status": "SCHEDULED",
                "attempt": 1,
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
                scheduled[sched_id]["attempt"] = attrs.attempt

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
            sched_id = event.activity_task_failed_event_attributes.scheduled_event_id
            if sched_id in scheduled:
                entry = scheduled.pop(sched_id)
                entry["status"] = "FAILED"
                entry["completed_time"] = _event_time_to_datetime(event.event_time)
                activities.append(entry)

        elif event.event_type == EventType.EVENT_TYPE_ACTIVITY_TASK_CANCELED:
            sched_id = event.activity_task_canceled_event_attributes.scheduled_event_id
            if sched_id in scheduled:
                entry = scheduled.pop(sched_id)
                entry["status"] = "CANCELED"
                entry["completed_time"] = _event_time_to_datetime(event.event_time)
                activities.append(entry)

        elif event.event_type == EventType.EVENT_TYPE_ACTIVITY_TASK_TIMED_OUT:
            sched_id = event.activity_task_timed_out_event_attributes.scheduled_event_id
            if sched_id in scheduled:
                entry = scheduled.pop(sched_id)
                entry["status"] = "TIMED_OUT"
                entry["completed_time"] = _event_time_to_datetime(event.event_time)
                activities.append(entry)

    for entry in scheduled.values():
        activities.append(entry)

    return activities


_CHILD_TERMINAL_EVENTS = {
    EventType.EVENT_TYPE_CHILD_WORKFLOW_EXECUTION_COMPLETED:  ("child_workflow_execution_completed_event_attributes",  "COMPLETED"),
    EventType.EVENT_TYPE_CHILD_WORKFLOW_EXECUTION_FAILED:     ("child_workflow_execution_failed_event_attributes",     "FAILED"),
    EventType.EVENT_TYPE_CHILD_WORKFLOW_EXECUTION_CANCELED:   ("child_workflow_execution_canceled_event_attributes",   "CANCELED"),
    EventType.EVENT_TYPE_CHILD_WORKFLOW_EXECUTION_TIMED_OUT:  ("child_workflow_execution_timed_out_event_attributes",  "TIMED_OUT"),
    EventType.EVENT_TYPE_CHILD_WORKFLOW_EXECUTION_TERMINATED: ("child_workflow_execution_terminated_event_attributes", "TERMINATED"),
}


def parse_child_workflows_from_history(events: list) -> list[dict[str, Any]]:
    """Parse child workflow events from a workflow history.

    Keyed by child workflow_id (not event_id): all child events carry
    workflow_execution.workflow_id, which matches Temporal's own correlation
    attribute. Terminal statuses: COMPLETED / FAILED / CANCELED / TIMED_OUT /
    TERMINATED / START_FAILED. Open: RUNNING (started) or PENDING (initiated
    but never started).
    """
    initiated: dict[str, dict[str, Any]] = {}
    children: list[dict[str, Any]] = []

    for event in events:
        if event.event_type == EventType.EVENT_TYPE_START_CHILD_WORKFLOW_EXECUTION_INITIATED:
            attrs = event.start_child_workflow_execution_initiated_event_attributes
            wf_id = attrs.workflow_id
            initiated[wf_id] = {
                "workflow_id": wf_id,
                "workflow_type": attrs.workflow_type.name,
                "initiated_time": _event_time_to_datetime(event.event_time),
            }

        elif event.event_type == EventType.EVENT_TYPE_START_CHILD_WORKFLOW_EXECUTION_FAILED:
            attrs = event.start_child_workflow_execution_failed_event_attributes
            wf_id = attrs.workflow_id
            entry = initiated.pop(wf_id, {"workflow_id": wf_id})
            entry["status"] = "START_FAILED"
            entry["completed_time"] = _event_time_to_datetime(event.event_time)
            children.append(entry)

        elif event.event_type == EventType.EVENT_TYPE_CHILD_WORKFLOW_EXECUTION_STARTED:
            attrs = event.child_workflow_execution_started_event_attributes
            wf_id = attrs.workflow_execution.workflow_id
            if wf_id in initiated:
                initiated[wf_id]["run_id"] = attrs.workflow_execution.run_id
                initiated[wf_id]["started_time"] = _event_time_to_datetime(event.event_time)
                initiated[wf_id]["status"] = "RUNNING"

        elif event.event_type in _CHILD_TERMINAL_EVENTS:
            attr_name, status = _CHILD_TERMINAL_EVENTS[event.event_type]
            attrs = getattr(event, attr_name)
            wf_id = attrs.workflow_execution.workflow_id
            entry = initiated.pop(wf_id, {"workflow_id": wf_id})
            entry["status"] = status
            entry["completed_time"] = _event_time_to_datetime(event.event_time)
            children.append(entry)

    for entry in initiated.values():
        if "status" not in entry:
            entry["status"] = "RUNNING" if "run_id" in entry else "PENDING"
        children.append(entry)

    return children


async def fetch_workflow_history(client: Client, workflow_id: str, run_id: str) -> list:
    """Fetch full event history for a workflow execution."""
    handle = client.get_workflow_handle(workflow_id, run_id=run_id)
    events = []
    async for event in handle.fetch_history_events():
        events.append(event)
    return events
