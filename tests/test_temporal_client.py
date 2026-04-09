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
