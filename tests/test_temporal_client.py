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


def _make_child_initiated(event_id: int, workflow_id: str, workflow_type: str, at: datetime):
    e = MagicMock()
    e.event_type = EventType.EVENT_TYPE_START_CHILD_WORKFLOW_EXECUTION_INITIATED
    e.event_id = event_id
    e.event_time = _make_timestamp(at)
    e.start_child_workflow_execution_initiated_event_attributes.workflow_id = workflow_id
    e.start_child_workflow_execution_initiated_event_attributes.workflow_type.name = workflow_type
    return e


def _make_child_started(workflow_id: str, run_id: str, at: datetime):
    e = MagicMock()
    e.event_type = EventType.EVENT_TYPE_CHILD_WORKFLOW_EXECUTION_STARTED
    e.event_time = _make_timestamp(at)
    e.child_workflow_execution_started_event_attributes.workflow_execution.workflow_id = workflow_id
    e.child_workflow_execution_started_event_attributes.workflow_execution.run_id = run_id
    return e


_CHILD_TERMINAL_ATTR = {
    EventType.EVENT_TYPE_CHILD_WORKFLOW_EXECUTION_COMPLETED:  "child_workflow_execution_completed_event_attributes",
    EventType.EVENT_TYPE_CHILD_WORKFLOW_EXECUTION_FAILED:     "child_workflow_execution_failed_event_attributes",
    EventType.EVENT_TYPE_CHILD_WORKFLOW_EXECUTION_CANCELED:   "child_workflow_execution_canceled_event_attributes",
    EventType.EVENT_TYPE_CHILD_WORKFLOW_EXECUTION_TIMED_OUT:  "child_workflow_execution_timed_out_event_attributes",
    EventType.EVENT_TYPE_CHILD_WORKFLOW_EXECUTION_TERMINATED: "child_workflow_execution_terminated_event_attributes",
}


def _make_child_terminal(event_type, workflow_id: str, at: datetime):
    e = MagicMock()
    e.event_type = event_type
    e.event_time = _make_timestamp(at)
    getattr(e, _CHILD_TERMINAL_ATTR[event_type]).workflow_execution.workflow_id = workflow_id
    return e


def _make_start_child_failed(workflow_id: str, at: datetime):
    e = MagicMock()
    e.event_type = EventType.EVENT_TYPE_START_CHILD_WORKFLOW_EXECUTION_FAILED
    e.event_time = _make_timestamp(at)
    e.start_child_workflow_execution_failed_event_attributes.workflow_id = workflow_id
    return e


def test_parse_child_workflows_handles_canceled_timed_out_terminated():
    from temporal_client import parse_child_workflows_from_history
    t = datetime(2026, 1, 1, tzinfo=timezone.utc)

    events = [
        _make_child_initiated(10, "child-a", "childWf", t),
        _make_child_started("child-a", "run-a", t),
        _make_child_terminal(EventType.EVENT_TYPE_CHILD_WORKFLOW_EXECUTION_CANCELED, "child-a", t),
        _make_child_initiated(20, "child-b", "childWf", t),
        _make_child_started("child-b", "run-b", t),
        _make_child_terminal(EventType.EVENT_TYPE_CHILD_WORKFLOW_EXECUTION_TIMED_OUT, "child-b", t),
        _make_child_initiated(30, "child-c", "childWf", t),
        _make_child_started("child-c", "run-c", t),
        _make_child_terminal(EventType.EVENT_TYPE_CHILD_WORKFLOW_EXECUTION_TERMINATED, "child-c", t),
    ]
    children = parse_child_workflows_from_history(events)
    by_id = {c["workflow_id"]: c for c in children}
    assert by_id["child-a"]["status"] == "CANCELED"
    assert by_id["child-b"]["status"] == "TIMED_OUT"
    assert by_id["child-c"]["status"] == "TERMINATED"


def test_parse_child_workflows_marks_start_failed_without_run_id():
    from temporal_client import parse_child_workflows_from_history
    t = datetime(2026, 1, 1, tzinfo=timezone.utc)
    events = [
        _make_child_initiated(5, "child-x", "childWf", t),
        _make_start_child_failed("child-x", t),
    ]
    children = parse_child_workflows_from_history(events)
    assert len(children) == 1
    assert children[0]["workflow_id"] == "child-x"
    assert children[0]["status"] == "START_FAILED"
    assert "run_id" not in children[0]


def test_parse_child_workflows_open_children_are_pending_not_running():
    from temporal_client import parse_child_workflows_from_history
    t = datetime(2026, 1, 1, tzinfo=timezone.utc)
    events = [
        _make_child_initiated(1, "child-pending", "childWf", t),
        _make_child_initiated(2, "child-running", "childWf", t),
        _make_child_started("child-running", "run-r", t),
    ]
    children = parse_child_workflows_from_history(events)
    by_id = {c["workflow_id"]: c for c in children}
    assert by_id["child-pending"]["status"] == "PENDING"
    assert "run_id" not in by_id["child-pending"]
    assert by_id["child-running"]["status"] == "RUNNING"
    assert by_id["child-running"]["run_id"] == "run-r"


def test_parse_child_workflows_keyed_by_workflow_id():
    """Completed event must match INITIATED by workflow_id even if event_ids differ."""
    from temporal_client import parse_child_workflows_from_history
    t = datetime(2026, 1, 1, tzinfo=timezone.utc)
    events = [
        _make_child_initiated(10, "child-x", "childWf", t),
        _make_child_started("child-x", "run-x", t),
        _make_child_terminal(EventType.EVENT_TYPE_CHILD_WORKFLOW_EXECUTION_COMPLETED, "child-x", t),
    ]
    children = parse_child_workflows_from_history(events)
    assert len(children) == 1
    assert children[0]["workflow_id"] == "child-x"
    assert children[0]["status"] == "COMPLETED"
    assert children[0]["run_id"] == "run-x"


_ACTIVITY_TERMINAL_ATTR = {
    EventType.EVENT_TYPE_ACTIVITY_TASK_COMPLETED: "activity_task_completed_event_attributes",
    EventType.EVENT_TYPE_ACTIVITY_TASK_FAILED:    "activity_task_failed_event_attributes",
    EventType.EVENT_TYPE_ACTIVITY_TASK_CANCELED:  "activity_task_canceled_event_attributes",
    EventType.EVENT_TYPE_ACTIVITY_TASK_TIMED_OUT: "activity_task_timed_out_event_attributes",
}


def _make_activity_terminal(event_type, scheduled_event_id: int, at: datetime):
    e = MagicMock()
    e.event_type = event_type
    e.event_time = _make_timestamp(at)
    getattr(e, _ACTIVITY_TERMINAL_ATTR[event_type]).scheduled_event_id = scheduled_event_id
    if event_type == EventType.EVENT_TYPE_ACTIVITY_TASK_COMPLETED:
        getattr(e, _ACTIVITY_TERMINAL_ATTR[event_type]).result.payloads = []
    return e


def _make_activity_scheduled(event_id: int, activity_type: str, at: datetime):
    sched = MagicMock()
    sched.event_type = EventType.EVENT_TYPE_ACTIVITY_TASK_SCHEDULED
    sched.event_id = event_id
    sched.event_time = _make_timestamp(at)
    sched.activity_task_scheduled_event_attributes.activity_type.name = activity_type
    sched.activity_task_scheduled_event_attributes.input.payloads = []
    return sched


def test_parse_activities_handles_canceled():
    from temporal_client import parse_activities_from_history
    t = datetime(2026, 1, 1, tzinfo=timezone.utc)
    events = [
        _make_activity_scheduled(11, "doThing", t),
        _make_activity_terminal(EventType.EVENT_TYPE_ACTIVITY_TASK_CANCELED, 11, t),
    ]
    activities = parse_activities_from_history(events)
    assert len(activities) == 1
    assert activities[0]["activity_id"] == "11"
    assert activities[0]["status"] == "CANCELED"


def test_parse_activities_handles_timed_out():
    from temporal_client import parse_activities_from_history
    t = datetime(2026, 1, 1, tzinfo=timezone.utc)
    events = [
        _make_activity_scheduled(13, "doThing", t),
        _make_activity_terminal(EventType.EVENT_TYPE_ACTIVITY_TASK_TIMED_OUT, 13, t),
    ]
    activities = parse_activities_from_history(events)
    assert len(activities) == 1
    assert activities[0]["status"] == "TIMED_OUT"
