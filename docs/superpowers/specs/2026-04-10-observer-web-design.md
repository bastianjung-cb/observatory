# Observer Web — Design Spec

## Purpose

A Next.js app for developers to explore what LLM agents did for each message response. Lets you find chats by user, time, or content, navigate messages, and inspect the detailed workflow steps (activities) with their inputs and outputs — all keyboard-driven.

## Context

The cellbyte app has users, chats, and messages stored in its Postgres database. Each assistant message triggers a Temporal workflow (ID = `chat-<message_uuid>`) whose activities represent the steps the agent took (LLM calls, tool calls, searches, etc.). The observer pipeline already syncs workflows and activities from Temporal into our observer DB.

This app brings both data sources together into a single read-optimized database and provides a fast, keyboard-navigable UI for exploring agent behavior.

## Architecture

### Data Layer

**Three source databases (configurable via env vars):**

| Env Var | Source | Data |
|---|---|---|
| `APP_DATABASE_URL` | cellbyte Postgres | users, chats, messages, message_parts |
| `OBSERVER_DATABASE_URL` | observer Postgres | workflows, activities (synced from Temporal) |
| `TEMPORAL_DATABASE_URL` | Temporal Postgres | reserved for future use |

**Single read database:**
All data is synced into the observer DB. The Next.js app only connects to the observer DB for reads. This avoids cross-database joins and lets us control indexes for fast queries.

### Data Sync

Extend the existing cron-based sync script to also copy app data into the observer DB.

**New tables in observer DB (mirroring app DB):**

```sql
CREATE TABLE IF NOT EXISTS users (
    id          UUID PRIMARY KEY,
    auth_id     TEXT UNIQUE NOT NULL,
    email       TEXT,
    given_name  TEXT,
    family_name TEXT,
    is_suspended BOOLEAN NOT NULL DEFAULT false,
    deleted_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS chats (
    id          UUID PRIMARY KEY,
    title       TEXT,
    created_at  TIMESTAMPTZ NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL,
    deleted_at  TIMESTAMPTZ,
    user_id     UUID NOT NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS messages (
    id          UUID PRIMARY KEY,
    "order"     INTEGER NOT NULL,
    role        TEXT NOT NULL,
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL,
    chat_id     UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS message_parts (
    id          UUID PRIMARY KEY,
    "order"     INTEGER NOT NULL,
    content     JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL,
    message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE
);
```

**Existing tables (modified):**
- Rename `workflows.chat_uuid` to `workflows.message_id` (UUID, references messages)

**Sync strategy:**

A `sync_state` table tracks the last successful sync time:

```sql
CREATE TABLE IF NOT EXISTS sync_state (
    entity      TEXT PRIMARY KEY,
    last_sync_at TIMESTAMPTZ NOT NULL
);
```

**Note:** The cellbyte app DB uses PascalCase table names (Prisma convention): `"User"`, `"Chat"`, `"Message"`, `"MessagePart"`. Column names are camelCase (`userId`, `createdAt`, etc.). Our observer DB uses snake_case for both.

Per entity:
- **Users:** Full upsert every run (small table, no `updated_at` field available). Source: `"User"` table.
- **Chats:** Upsert where `"updatedAt" > last_sync_at`. Sync `deleted_at` to reflect soft deletes. Source: `"Chat"` table.
- **Messages:** Insert where `"createdAt" > last_sync_at` (append-only). Source: `"Message"` table.
- **MessageParts:** Insert where `"createdAt" > last_sync_at` (append-only). Source: `"MessagePart"` table.

After each successful sync run, update `sync_state` for each entity.

**Indexes for fast queries:**

```sql
CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_chat_id_order ON messages(chat_id, "order");
CREATE INDEX IF NOT EXISTS idx_message_parts_message_id_order ON message_parts(message_id, "order");
CREATE INDEX IF NOT EXISTS idx_workflows_message_id ON workflows(message_id);
CREATE INDEX IF NOT EXISTS idx_activities_workflow_id ON activities(workflow_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_given_name ON users(given_name);
CREATE INDEX IF NOT EXISTS idx_users_family_name ON users(family_name);
```

For content search on text message parts (`content->>'type' = 'text'`):
```sql
CREATE INDEX IF NOT EXISTS idx_message_parts_content_text ON message_parts USING GIN (to_tsvector('english', content->>'text')) WHERE content->>'type' = 'text';
```

**Message part content structure:**
The `content` JSONB always has a `type` field. Key types:
- `text` — has `text` field with the actual message text (searchable)
- `tool-*` — has `input`/`output` fields (tool call details)
- `source-url` — has `url`, `title` fields

Content search targets `content->>'text'` on parts where `type = 'text'`, using full-text search via `to_tsvector`/`plainto_tsquery`.

### Next.js App

**Location:** `web/` directory in the monorepo.

**Stack:** Next.js 15 (App Router, Server Components), shadcn/ui, Tailwind CSS, node-postgres (`pg`), no auth.

**Single DB connection from the app:** The Next.js app only reads from the observer DB (`OBSERVER_DATABASE_URL`).

### Views

**View 1: Chat List (`/`)**

A shadcn DataTable showing all chats (excluding soft-deleted).

| Column | Source |
|---|---|
| User | `users.given_name + family_name` (or email fallback) |
| Chat Title | `chats.title` (or "Untitled") |
| Messages | COUNT of messages in chat |
| Last Message | MAX `messages.created_at` |

- Sorted by last message time, newest first
- Search bar at top: filters by user name/email OR message content keywords
- Content search queries `message_parts.content` via the GIN index
- Paginated (server-side)

**View 2: Message List (`/chats/[id]`)**

A list of messages in the chat, ordered chronologically (oldest first, by `messages.order`).

Each row shows:
- Role badge (USER / ASSISTANT / SYSTEM)
- Content preview (first message_part content, truncated)
- Timestamp

**View 3: Activity Steps (`/chats/[chatId]/messages/[messageId]`)**

Shows the workflow linked to this message (via `workflows.message_id`) and its activities.

Each row:
- Activity type name
- Status badge
- Duration (scheduled_time → completed_time)

**Activity type filter:**
- Multi-select dropdown listing all activity types found for this workflow
- Each type toggleable on/off
- Default filter hides: `appendMessagePart`, `markResponseCompleted`, `getSkillsFormatted`, `loadContext`
- `F` key toggles the filter panel open/closed

**Space expand (activity detail):**
- Press Space on a selected activity to expand an inline panel below the row
- Left half: input JSON (formatted)
- Right half: output JSON (formatted)
- Press Space again to collapse
- JSON displayed as formatted code blocks (markdown rendering deferred to future)

### Keyboard Navigation

| Key | Action | Where |
|---|---|---|
| Arrow Up/Down | Move selection between list items | All views |
| Enter | Drill into selected item | Views 1, 2 |
| Escape | Go back one level | Views 2, 3 |
| Space | Toggle input/output expand on selected activity | View 3 only |
| F | Toggle activity type filter panel | View 3 only |

Navigation implemented as a shared React hook (`useKeyboardNav`) that manages selected index, handles key events, and calls callbacks for enter/escape/space actions.

### Manual Sync Trigger

A "Sync Now" button in the app header. Triggers the full data sync (app DB → observer DB + Temporal → observer DB) via a Server Action. Shows a loading spinner while running and a success/error toast when done. This is in addition to the cron job — same sync logic, just invoked from the UI.

### File Structure

```
web/
  app/
    layout.tsx                            — Root layout, global styles
    page.tsx                              — Chat list view (View 1)
    chats/[id]/
      page.tsx                            — Message list view (View 2)
      messages/[messageId]/
        page.tsx                          — Activity steps view (View 3)
  components/
    chat-table.tsx                        — Chat list table + search
    message-list.tsx                      — Message list
    activity-steps.tsx                    — Activity list + filter + expand
    use-keyboard-nav.ts                   — Keyboard navigation hook
    sync-button.tsx                       — Manual sync trigger button
  lib/
    db.ts                                 — DB connection pool (observer DB)
    queries/
      chats.ts                            — Chat list + search queries
      messages.ts                         — Message + parts queries
      activities.ts                       — Workflow + activity queries
  .env.local                              — DB connection strings
```

### Docker Compose & Port Isolation

The observer stack must not interfere with the cellbyte stack. The cellbyte app DB uses port 5432, Temporal DB uses 5433. Our observer Postgres uses port **5436** to avoid any conflict.

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_DB: observer
      POSTGRES_USER: observer
      POSTGRES_PASSWORD: observer
    ports:
      - "5436:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
```

The Next.js app uses port **3001** (cellbyte app uses 3000).

Default `OBSERVER_DATABASE_URL`: `postgresql://observer:observer@localhost:5436/observer`

### Default Environment Variables

```
APP_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cellbyte
OBSERVER_DATABASE_URL=postgresql://observer:observer@localhost:5436/observer
TEMPORAL_DATABASE_URL=postgresql://temporal:temporal@localhost:5433/temporal
```

## Error Handling

- If the observer DB is unreachable, the app shows a connection error page
- Empty states: "No chats found" / "No messages" / "No workflow found for this message"
- Search with no results shows empty state with the search term

## Scope Boundaries

**In scope:**
- Data sync (users, chats, messages, message_parts from app DB)
- Chat list with search (user, content)
- Message list per chat
- Activity steps per message with filter and input/output expand
- Keyboard navigation throughout
- JSON display for inputs/outputs

**Out of scope (future):**
- Markdown rendering for LLM prompts/responses
- Auth
- Real-time updates / websockets
- Temporal DB direct queries
