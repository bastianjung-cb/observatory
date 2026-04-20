# W Keybinding For Column Creation Workflows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `W` keybinding to the column creations list and detail views that opens the relevant workflow in the Temporal UI, matching the existing behavior on `/chats/[id]`.

**Architecture:** Extract a shared `web/lib/temporal-url.ts` helper (`buildTemporalWorkflowUrl`, `openTemporalWorkflow`) so the three call sites (chat, column-creations list, column-creations detail) share one URL format. Extend three DB queries to also select `run_id`. Add `useEffect` keydown listeners to the two column-creation components, matching the existing guard pattern in `message-list.tsx` (skip when focus is in an input/textarea or a modifier key is held). In `activity-steps.tsx`, the listener also skips when an overlay is open and uses the selected child row's workflow (if selected) or falls back to the current header workflow.

**Tech Stack:** Next.js 16, React 19, TypeScript, pg (Postgres). No test runner in the `web/` project; verification uses `npm run build`, `npm run lint`, and documented manual browser smoke steps.

**Spec reference:** `docs/superpowers/specs/2026-04-20-temporal-w-keybinding-design.md`

**Repository conventions (read before editing):**
- `web/CLAUDE.md` / `web/AGENTS.md`: "This is NOT the Next.js you know" — read docs in `node_modules/next/dist/docs/` before writing Next.js-specific code. This plan only touches client components and plain queries, so Next.js API changes are unlikely to bite, but check if anything surprising comes up.
- Existing components use the `useKeyboardNav` hook (already plumbed). Don't add your own selection state.

---

## Task 1: Extract shared Temporal URL helper

**Files:**
- Create: `web/lib/temporal-url.ts`

Why first: the remaining tasks import from this file. Having it exist (even unused for a moment) keeps downstream tasks compilable on their own.

- [ ] **Step 1: Create the helper file**

Write `web/lib/temporal-url.ts` with exactly this content:

```ts
// Shared helpers for constructing and opening Temporal UI links.
// The URL format mirrors the one used by /chats/[id] so all three
// views (chat, column-creations list, column-creations detail) share
// a single source of truth.

export function buildTemporalWorkflowUrl(
  workflowId: string | null | undefined,
  runId: string | null | undefined,
): string | null {
  const base = process.env.TEMPORAL_UI_URL;
  if (!base || !workflowId) return null;
  const ns = process.env.TEMPORAL_NAMESPACE || "default";
  const runSegment = runId ? `/${runId}` : "";
  return `${base}/namespaces/${ns}/workflows/${workflowId}${runSegment}/timeline`;
}

export function openTemporalWorkflow(
  workflowId: string | null | undefined,
  runId: string | null | undefined,
): boolean {
  const url = buildTemporalWorkflowUrl(workflowId, runId);
  if (!url) return false;
  window.open(url, "_blank");
  return true;
}
```

Notes:
- `buildTemporalWorkflowUrl` accepts nullish `workflowId` too, so callers don't have to pre-guard.
- `runId` is optional: Temporal UI's `/workflows/{id}/timeline` resolves to the latest run when the run segment is absent. This keeps the helper useful even if a query hasn't been extended yet.
- `openTemporalWorkflow` returns a boolean so callers know whether to call `e.preventDefault()`.

- [ ] **Step 2: Verify it compiles**

Run: `cd web && npm run build`
Expected: build completes with no type errors. (If the rest of the repo builds before this task, it will still build after.)

- [ ] **Step 3: Commit**

```bash
git add web/lib/temporal-url.ts
git commit -m "feat(web): add buildTemporalWorkflowUrl / openTemporalWorkflow helpers"
```

---

## Task 2: Expose `run_id` in workflow queries

**Files:**
- Modify: `web/lib/queries/activities.ts` (`WorkflowRow` interface; `getWorkflow`; `ChildWorkflowRow` interface; `getChildWorkflowsWithDetails`; also update `getWorkflowForMessage` and `getChildWorkflows` to stay consistent with the widened row types)

The `workflows` table already has a `run_id` column — these queries just don't select it today.

- [ ] **Step 1: Extend `WorkflowRow` and `ChildWorkflowRow` interfaces**

In `web/lib/queries/activities.ts`, update the two interfaces to include `run_id`:

```ts
export interface WorkflowRow {
  workflow_id: string;
  run_id: string | null;
  status: string;
  start_time: string;
  end_time: string | null;
  parent_workflow_id: string | null;
  workflow_name: string | null;
}

export interface ChildWorkflowRow {
  workflow_id: string;
  run_id: string | null;
  workflow_name: string | null;
  status: string;
  start_time: string;
  end_time: string | null;
  cost_usd?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  output_value?: string | null;
  input_label?: string | null;
}
```

- [ ] **Step 2: Update `getWorkflow` to select `run_id`**

Replace the SQL in `getWorkflow` (currently selects `workflow_id, status, start_time, end_time, parent_workflow_id, workflow_name`) with:

```ts
export async function getWorkflow(
  workflowId: string
): Promise<WorkflowRow | null> {
  const result = await pool.query(
    `SELECT workflow_id, run_id, status, start_time, end_time, parent_workflow_id, workflow_name
     FROM workflows
     WHERE workflow_id = $1`,
    [workflowId]
  );
  return result.rows[0] || null;
}
```

- [ ] **Step 3: Update `getWorkflowForMessage` to select `run_id`**

This query also returns `WorkflowRow`, so add `w.run_id` to keep the row shape consistent:

```ts
export async function getWorkflowForMessage(
  messageId: string
): Promise<WorkflowRow | null> {
  const result = await pool.query(
    `SELECT w.workflow_id, w.run_id, w.status, w.start_time, w.end_time, w.parent_workflow_id, w.workflow_name
     FROM chat_workflows cw
     JOIN workflows w ON w.workflow_id = cw.workflow_id
     WHERE cw.message_id = $1
     LIMIT 1`,
    [messageId]
  );
  return result.rows[0] || null;
}
```

- [ ] **Step 4: Update `getChildWorkflows` to select `run_id`**

```ts
export async function getChildWorkflows(
  parentWorkflowId: string
): Promise<ChildWorkflowRow[]> {
  const result = await pool.query(
    `SELECT workflow_id, run_id, workflow_name, status, start_time, end_time
     FROM workflows
     WHERE parent_workflow_id = $1
     ORDER BY start_time ASC`,
    [parentWorkflowId]
  );
  return result.rows;
}
```

- [ ] **Step 5: Update `getChildWorkflowsWithDetails` to select `run_id`**

Add `w.run_id,` to the top of the SELECT list (just after `w.workflow_name`). The relevant beginning of the SQL becomes:

```sql
SELECT
  w.workflow_id,
  w.run_id,
  w.workflow_name,
  w.status,
  w.start_time,
  w.end_time,
  (
    SELECT COALESCE(SUM(
      ...
```

Leave the rest of the function (cost/tokens/output_value/input_label subqueries and the `WHERE w.parent_workflow_id = $1` clause) untouched.

- [ ] **Step 6: Build + lint**

Run: `cd web && npm run build && npm run lint`
Expected: clean build, no type errors, no lint errors. (No current consumer reads `run_id`, so widening the row type is additive.)

- [ ] **Step 7: Commit**

```bash
git add web/lib/queries/activities.ts
git commit -m "feat(web): include run_id in workflow query results"
```

---

## Task 3: Expose `run_id` on column-creation list rows

**Files:**
- Modify: `web/lib/queries/column-creations.ts` (`ColumnCreationRow` interface; `_getColumnCreations` SQL)

- [ ] **Step 1: Extend `ColumnCreationRow` interface**

Add `run_id: string | null` to `ColumnCreationRow` in `web/lib/queries/column-creations.ts`:

```ts
export interface ColumnCreationRow {
  batch_id: string;
  workflow_id: string;
  run_id: string | null;
  column_name: string | null;
  prompt: string | null;
  variant: string | null;
  total_rows: number;
  completed_rows: number;
  failed_rows: number;
  status: string;
  user_name: string | null;
  user_email: string | null;
  total_cost_usd: number;
  created_at: string;
}
```

- [ ] **Step 2: Add `w.run_id` to the list SELECT**

In `_getColumnCreations`, locate the `dataQuery` template string. In the SELECT list, just after `cgw.workflow_id,`, add `w.run_id,`:

```sql
SELECT
   cgw.batch_id,
   cgw.workflow_id,
   w.run_id,
   cgw.metadata->>'columnName' as column_name,
   ...
```

Leave every other line (joins, where-clause, ORDER BY, LIMIT, OFFSET) untouched.

Do **not** modify `getColumnCreation` (the detail query) — the detail page pulls the workflow separately via `getWorkflow`, which Task 2 already widened.

- [ ] **Step 3: Build + lint**

Run: `cd web && npm run build && npm run lint`
Expected: clean build, no type errors, no lint errors.

- [ ] **Step 4: Commit**

```bash
git add web/lib/queries/column-creations.ts
git commit -m "feat(web): include run_id in column-creation list rows"
```

---

## Task 4: Route `message-list.tsx` through the shared helper

**Files:**
- Modify: `web/components/message-list.tsx`

This is a refactor-only change: same behavior, same URL, fewer inlined strings. Doing it here (before touching the column-creation components) proves the helper works against the existing, already-verified call site.

- [ ] **Step 1: Import the helpers**

At the top of `web/components/message-list.tsx`, add after the existing `useKeyboardNav` import:

```ts
import { buildTemporalWorkflowUrl, openTemporalWorkflow } from "@/lib/temporal-url";
```

- [ ] **Step 2: Replace the W keydown handler URL construction**

Find this block (currently at lines ~105–114):

```ts
if (e.key === "w" || e.key === "W") {
  const msg = displayMessages[selectedIndex];
  if (msg?.workflow_id && msg?.run_id && process.env.TEMPORAL_UI_URL) {
    e.preventDefault();
    window.open(
      `${process.env.TEMPORAL_UI_URL}/namespaces/${process.env.TEMPORAL_NAMESPACE || "default"}/workflows/${msg.workflow_id}/${msg.run_id}/timeline`,
      "_blank"
    );
  }
}
```

Replace with:

```ts
if (e.key === "w" || e.key === "W") {
  const msg = displayMessages[selectedIndex];
  if (msg?.workflow_id && openTemporalWorkflow(msg.workflow_id, msg.run_id)) {
    e.preventDefault();
  }
}
```

Note the guard loosens from `msg?.workflow_id && msg?.run_id && TEMPORAL_UI_URL` to `msg?.workflow_id && helper-returned-true`. This is intentional: Temporal UI works fine without `run_id`, and the helper handles the `TEMPORAL_UI_URL` check itself.

- [ ] **Step 3: Replace the anchor tag's inline URL**

Find this block (currently around lines ~197–212):

```tsx
{process.env.TEMPORAL_UI_URL && (
  <a
    title="Open in Temporal UI"
    href={`${process.env.TEMPORAL_UI_URL}/namespaces/${process.env.TEMPORAL_NAMESPACE || "default"}/workflows/${msg.workflow_id}/${msg.run_id}/timeline`}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex items-center justify-center w-6 h-6 rounded border border-border bg-background hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
    onClick={(e) => e.stopPropagation()}
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  </a>
)}
```

Replace with an IIFE-style render that uses the helper (keeping the icon and styling identical):

```tsx
{(() => {
  const temporalUrl = buildTemporalWorkflowUrl(msg.workflow_id, msg.run_id);
  if (!temporalUrl) return null;
  return (
    <a
      title="Open in Temporal UI"
      href={temporalUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center justify-center w-6 h-6 rounded border border-border bg-background hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
      onClick={(e) => e.stopPropagation()}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </svg>
    </a>
  );
})()}
```

- [ ] **Step 4: Build + lint**

Run: `cd web && npm run build && npm run lint`
Expected: clean. If unused imports warn, remove them.

- [ ] **Step 5: Manual smoke**

If a dev server is not already running: `cd web && npm run dev` (port 3001 by default).
- Navigate to `/chats/<any-id>` that has a workflow badge on at least one message.
- Select that message with `↑/↓` and press `W`. A new tab must open to the Temporal UI at the correct workflow.
- Hover over a message with a workflow and click the external-link icon: same URL opens.
- If `TEMPORAL_UI_URL` is unset in the env, the icon must be hidden and `W` must no-op.

- [ ] **Step 6: Commit**

```bash
git add web/components/message-list.tsx
git commit -m "refactor(web): route chat message W handler through shared helper"
```

---

## Task 5: Add `W` to column-creation list

**Files:**
- Modify: `web/components/column-creation-table.tsx`

- [ ] **Step 1: Add imports**

At the top of `web/components/column-creation-table.tsx`, after the existing `useKeyboardNav` import, add:

```ts
import { openTemporalWorkflow } from "@/lib/temporal-url";
```

You also need `useEffect` — it is **not** imported yet in this file. Find the line `import { useRef, useEffect } from "react";` — actually the file currently has `import { useRef, useEffect } from "react";` already (line 4). If `useEffect` is not there, add it.

- [ ] **Step 2: Extend the `ColumnCreation` interface**

The component has its own local interface (distinct from `ColumnCreationRow` in the queries file). Add `run_id` to it:

```ts
interface ColumnCreation {
  batch_id: string;
  workflow_id: string;
  run_id: string | null;
  column_name: string | null;
  prompt: string | null;
  variant: string | null;
  total_rows: number;
  completed_rows: number;
  failed_rows: number;
  status: string;
  user_name: string | null;
  user_email: string | null;
  total_cost_usd: number;
  created_at: string;
}
```

- [ ] **Step 3: Add the keydown listener**

Inside the component body, after the existing `useEffect` that handles scrolling (ends around line 136, `}, [selectedIndex, rows.length]);`), add a new `useEffect`:

```ts
useEffect(() => {
  function handleKey(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "w" || e.key === "W") {
      const row = rows[selectedIndex];
      if (row && openTemporalWorkflow(row.workflow_id, row.run_id)) {
        e.preventDefault();
      }
    }
  }
  window.addEventListener("keydown", handleKey);
  return () => window.removeEventListener("keydown", handleKey);
}, [rows, selectedIndex]);
```

- [ ] **Step 4: Build + lint**

Run: `cd web && npm run build && npm run lint`
Expected: clean.

- [ ] **Step 5: Manual smoke**

With the dev server running:
- Navigate to `/column-creations`.
- Select a row with `↑/↓`. Press `W`. New tab opens to the Temporal UI for that batch's workflow.
- Type in the "Search by column name..." input and press `W` there: **must not** open a tab (input guard).
- Press `Cmd+W` / `Ctrl+W`: must fall through to the browser (modifier guard).

- [ ] **Step 6: Commit**

```bash
git add web/components/column-creation-table.tsx
git commit -m "feat(web): press W on column-creations list to open Temporal UI"
```

---

## Task 6: Add `W` to column-creation detail (activity-steps)

**Files:**
- Modify: `web/components/activity-steps.tsx` (extend `ChildWorkflow` interface; add `currentWorkflowId` + `currentRunId` props on `ActivitySteps`; extend the existing keydown `useEffect`)
- Modify: `web/app/column-creations/[batchId]/page.tsx` (pass the two new props; add `W` to `KeyboardHints`)

- [ ] **Step 1: Add import in `activity-steps.tsx`**

At the top of `web/components/activity-steps.tsx`, after the `CopyButton` import, add:

```ts
import { openTemporalWorkflow } from "@/lib/temporal-url";
```

- [ ] **Step 2: Extend local `ChildWorkflow` interface**

In `web/components/activity-steps.tsx`, update:

```ts
interface ChildWorkflow {
  workflow_id: string;
  run_id: string | null;
  workflow_name: string | null;
  status: string;
  start_time: string;
  end_time: string | null;
  cost_usd?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  output_value?: string | null;
  input_label?: string | null;
}
```

- [ ] **Step 3: Add new props to `ActivitySteps`**

Update the signature (around lines 504–516) to accept `currentWorkflowId` and `currentRunId`:

```ts
export function ActivitySteps({
  activities,
  childWorkflows = [],
  basePath,
  backPath,
  parentWorkflowId,
  currentWorkflowId,
  currentRunId,
}: {
  activities: Activity[];
  childWorkflows?: ChildWorkflow[];
  basePath: string;
  backPath: string;
  parentWorkflowId?: string;
  currentWorkflowId: string;
  currentRunId: string | null;
}) {
```

Both are required (non-optional) because the only caller always has a workflow to hand.

- [ ] **Step 4: Extend the existing keydown `useEffect`**

Find the existing `useEffect` with `function handleKey(e: KeyboardEvent)` that handles `F`/`T`/`R`/`I` (around lines 639–675). It currently has an early-return branch for when `expandedId` is set:

```ts
if (expandedId) {
  // When overlay is open, F focuses the search box
  if (e.key === "f" || e.key === "F") {
    e.preventDefault();
    const el = document.getElementById("json-overlay-search") as HTMLInputElement | null;
    el?.focus();
  }
  return;
}
```

Do **not** add `W` handling inside that branch; leave it as-is (W should no-op when an overlay is open).

After the existing `if (e.key === "i" || e.key === "I") { ... setInvokeOnly(...); }` block, add a `W` handler:

```ts
if (e.key === "w" || e.key === "W") {
  const item = displayItems[selectedIndex];
  let wfId: string | null | undefined = currentWorkflowId;
  let runId: string | null | undefined = currentRunId;
  if (item && item.kind === "child") {
    wfId = item.data.workflow_id;
    runId = item.data.run_id;
  }
  if (openTemporalWorkflow(wfId, runId)) {
    e.preventDefault();
  }
}
```

Then update the effect's dependency array to include the new values. The current dependency array is `[expandedId]`; change to:

```ts
}, [expandedId, displayItems, selectedIndex, currentWorkflowId, currentRunId]);
```

- [ ] **Step 5: Update the `column-creations/[batchId]` page to pass new props + keyboard hint**

In `web/app/column-creations/[batchId]/page.tsx`, find the `<ActivitySteps ... />` call (around lines 123–129). Add the two new props:

```tsx
<ActivitySteps
  activities={activities}
  childWorkflows={childWorkflows}
  basePath={`/column-creations/${batchId}`}
  backPath="/column-creations"
  parentWorkflowId={workflow.parent_workflow_id ?? undefined}
  currentWorkflowId={workflow.workflow_id}
  currentRunId={workflow.run_id}
/>
```

Find the `<KeyboardHints shortcuts={...}>` call (lines 109–118). Add `{ key: "W", action: "Temporal UI" }` as the last entry:

```tsx
<KeyboardHints shortcuts={[
  { key: "↑↓", action: "Navigate" },
  { key: "→", action: "JSON view / Child workflow" },
  { key: "←", action: "Back" },
  { key: "Space", action: "Prompt view (invokeModel) / JSON" },
  { key: "F", action: "Edit filter" },
  { key: "T", action: "Bypass filter" },
  { key: "I", action: "invokeModel only" },
  { key: "R", action: "Reverse order" },
  { key: "W", action: "Temporal UI" },
]} />
```

- [ ] **Step 6: Build + lint**

Run: `cd web && npm run build && npm run lint`
Expected: clean.

- [ ] **Step 7: Manual smoke**

With the dev server running:
- Navigate to `/column-creations/<id>`.
- With no child workflow row selected (or an activity row selected), press `W` → new tab opens to Temporal for the header workflow.
- Drill into a child via `→`. The breadcrumb should show two entries. Press `W` → new tab opens to that child's workflow on Temporal. The URL's workflow_id must be the child's, not the parent's.
- Navigate back (`←`) to the parent. Select a child workflow row (should be visible below the activity rows). Press `W` → new tab opens for that specific child's workflow.
- Open the JSON overlay (`Enter` on an activity). Press `W` → no tab opens (overlay guard).
- Type in the filter popover search (if there is a text input there) or in any input → `W` typed into the input must not trigger the shortcut. (If no input is focusable at the top of the view, you can skip this substep — the input guard already matches `message-list` behavior and is tested there.)
- The keyboard footer at the bottom of the page now shows `W — Temporal UI`.

- [ ] **Step 8: Commit**

```bash
git add web/components/activity-steps.tsx web/app/column-creations/[batchId]/page.tsx
git commit -m "feat(web): press W on column-creation activities to open Temporal UI"
```

---

## Task 7: Final verification pass

**Files:** none

- [ ] **Step 1: Full build + lint**

Run: `cd web && npm run build && npm run lint`
Expected: clean.

- [ ] **Step 2: Regression smoke on chats**

With the dev server running, revisit `/chats/<id>`:
- `W` still opens Temporal for the selected message (unchanged behavior).
- The external-link icon on a message still opens the same URL as `W`.

- [ ] **Step 3: End-to-end smoke across all three views**

1. `/chats/<id>` — `W` opens correct Temporal URL.
2. `/column-creations` — `W` on a selected row opens correct Temporal URL for the parent workflow.
3. `/column-creations/<id>` — `W` on an activity opens the header workflow; drilling into a child and pressing `W` opens the child; selecting a child row in the list and pressing `W` opens that child; with an overlay open, `W` is a no-op; typing `W` into an input is a no-op.
4. Unset `TEMPORAL_UI_URL` (temporarily) and restart the dev server — `W` is a silent no-op in all three views and the external-link icon on chat messages is hidden. Re-set the env and restart.

- [ ] **Step 4: No extra commit needed**

If every smoke step passes, the work is done. If any fails, go back to the relevant task, fix, and commit a follow-up.
