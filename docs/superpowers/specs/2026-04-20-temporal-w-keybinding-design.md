# W keybinding for column creation workflows — design

## Goal

Press `W` to open the Temporal UI for the relevant workflow from the column
creations list and detail views, mirroring the existing `W` behavior on the
chat messages list.

## Current state

- `/chats/[id]` (`web/components/message-list.tsx`) already implements `W`:
  the selected message's `workflow_id` + `run_id` are used to open a new tab
  at `{TEMPORAL_UI_URL}/namespaces/{ns}/workflows/{wf}/{run}/timeline`.
- `/column-creations` (`web/components/column-creation-table.tsx`) and
  `/column-creations/[batchId]` (`web/components/activity-steps.tsx`) have no
  Temporal shortcut.

## Behavior

### Column creation list — `column-creation-table.tsx`
- `W` with a row selected opens the Temporal UI for that row's parent
  workflow.
- Silent no-op if `TEMPORAL_UI_URL` is unset or the row lacks workflow/run IDs.
- Ignored when focus is in an `<input>` / `<textarea>` or any modifier key is
  held (mirrors existing pattern).

### Column creation detail — `activity-steps.tsx`
- `W` with an activity (or nothing) selected opens the Temporal UI for the
  currently-viewed workflow — the workflow whose activities are rendered in
  the header. This is the parent workflow by default, or a drilled-into child
  when navigated via `?wf=...`.
- `W` with a child workflow row selected opens the Temporal UI for that child
  workflow specifically.
- Ignored when any overlay is open (`expandedId != null`): the JSON/Prompt
  views have their own keyboard grammar and `W` should not leak through.
- Ignored in input/textarea focus and with modifier keys.

### Keyboard hints
- Add `{ key: "W", action: "Temporal UI" }` to the hints footer on
  `/column-creations/[batchId]`.
- The list view has no hints footer today; no change there.

## Data plumbing

The Temporal UI URL needs both `workflow_id` and `run_id`. `run_id` is already
stored in the `workflows` table; it is not currently selected by the queries
used by these views.

1. `web/lib/queries/column-creations.ts` — add `run_id` (from the joined
   workflows row) to the list query's SELECT; extend the `ColumnCreation` row
   type with `run_id: string | null`.
2. `web/lib/queries/activities.ts`:
   - `getWorkflow` — add `run_id` to SELECT; extend `WorkflowRow` with
     `run_id: string | null`.
   - `getChildWorkflowsWithDetails` — add `w.run_id` to SELECT; extend
     `ChildWorkflowRow`.
3. `web/components/activity-steps.tsx` — extend the local `ChildWorkflow`
   interface with `run_id: string | null`.

## New helper — `web/lib/temporal-url.ts`

```ts
export function buildTemporalWorkflowUrl(
  workflowId: string,
  runId: string | null | undefined,
): string | null {
  const base = process.env.TEMPORAL_UI_URL;
  if (!base || !workflowId) return null;
  const ns = process.env.TEMPORAL_NAMESPACE || "default";
  const runSegment = runId ? `/${runId}` : "";
  return `${base}/namespaces/${ns}/workflows/${workflowId}${runSegment}/timeline`;
}

export function openTemporalWorkflow(
  workflowId: string,
  runId: string | null | undefined,
): boolean {
  const url = buildTemporalWorkflowUrl(workflowId, runId);
  if (!url) return false;
  window.open(url, "_blank");
  return true;
}
```

- `openTemporalWorkflow` returns `boolean` so callers can decide whether to
  call `e.preventDefault()`.
- `run_id` is treated as optional: Temporal UI's `/workflows/{id}/timeline`
  route resolves to the latest run when `run_id` is absent, so the helper
  degrades gracefully.

## Component wiring

### `column-creation-table.tsx`
Add a `useEffect` keydown listener with the standard input/modifier guards.
On `w`/`W`, read `rows[selectedIndex]` and call `openTemporalWorkflow(row.workflow_id, row.run_id)`; call `e.preventDefault()` only if the helper succeeded.

### `activity-steps.tsx`
- Add two new optional props: `currentWorkflowId: string` and
  `currentRunId: string | null`.
- Extend the existing `useEffect` keydown listener (where `F`, `T`, `R`, `I`
  are handled): short-circuit to no-op if `expandedId` is set, otherwise
  inspect `displayItems[selectedIndex]`:
  - `item.kind === "child"` → `openTemporalWorkflow(item.data.workflow_id, item.data.run_id)`.
  - otherwise → `openTemporalWorkflow(currentWorkflowId, currentRunId)`.

### `column-creations/[batchId]/page.tsx`
- Pass `currentWorkflowId={workflow.workflow_id}` and
  `currentRunId={workflow.run_id}` to `<ActivitySteps>`.
- Add the `W — Temporal UI` entry to `<KeyboardHints>`.

### `message-list.tsx`
- Replace the inline URL construction in the `W` handler with
  `openTemporalWorkflow(msg.workflow_id, msg.run_id)`.
- Replace the anchor tag's `href` with `buildTemporalWorkflowUrl(...)` and
  guard rendering on a non-null return (matching today's
  `process.env.TEMPORAL_UI_URL` check).

## Verification

Build / type-check: `next build` (or the project's standard type-check
command) passes.

Manual browser smoke:
1. `/column-creations` — select a row, press `W` → new tab at Temporal for
   that workflow.
2. `/column-creations/[batchId]` — `W` on an activity → opens header
   workflow. Drill into a child via `→`, press `W` → opens child workflow.
   Select a child row in the list, press `W` → opens that child.
3. Open the JSON overlay, press `W` → no-op.
4. Type in a filter input, press `W` while focused → no-op.
5. `/chats/[id]` — existing `W` still works (regression).
6. Unset `TEMPORAL_UI_URL` — `W` is a silent no-op in all three views.

## Out of scope

- No new hover-icon buttons on the column-creation tables.
- No keyboard hints footer added to the `/column-creations` list (matches the
  existing styling of that view).
- No changes to the Temporal URL beyond `/timeline`; we do not introduce
  `/history`, `/stack-trace`, or any alternate landing page.
