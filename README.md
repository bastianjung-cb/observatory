# Cellbyte Observatory

A keyboard-driven web app for exploring what LLM agents did for each message response. Browse chats, inspect messages, and drill into the detailed workflow steps (activities) with their inputs and outputs.

## Architecture

```
.env                    ← Single config file for all connections
main.py                 ← Sync pipeline: pulls data from app DB + Temporal → observer DB
web/                    ← Next.js app: reads from observer DB only

App DB (cellbyte)  ──→  Observer DB  ←──  Temporal
  users, chats,           (unified)         workflows,
  messages, parts                           activities
```

**Three data sources, one read database:**

| Source | What it has | How we sync |
|---|---|---|
| App DB (cellbyte) | Users, chats, messages, message parts | Incremental via timestamps |
| Temporal | Workflows, activities (LLM calls, tool calls) | Fetch history for terminal workflows |
| Observer DB | All of the above, unified | The only DB the web app reads |

## Quick Start

```bash
# 1. Configure (edit if needed)
cp .env.example .env    # or just use the defaults

# 2. Start infrastructure
make up                 # Observer Postgres on :5436, cellbyte DB on :5432

# 3. Sync data
make sync               # Pull app data + Temporal workflows into observer DB

# 4. Start the web app
make dev                # http://localhost:3001
```

## Configuration

All config is in `.env` at the project root. Both the Python sync scripts and the Next.js app read from this file.

```env
# Observer Database (our local store)
OBSERVER_DATABASE_URL=postgresql://observer:observer@localhost:5436/observer

# App Database (cellbyte - source for users, chats, messages)
APP_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cellbyte

# Temporal
TEMPORAL_HOST=localhost:7233
TEMPORAL_NAMESPACE=default
```

## Makefile Commands

| Command | Description |
|---|---|
| `make up` | Start all infrastructure (observer Postgres + cellbyte DB) |
| `make down` | Stop all infrastructure |
| `make reset` | Wipe observer DB and recreate |
| `make sync` | Run the sync pipeline (app data + Temporal) |
| `make fresh` | Reset + sync in one go |
| `make dev` | Start web app in dev mode (port 3001) |
| `make dev-stop` | Stop dev server |
| `make build` | Production build of the web app |
| `make start` | Run production build (port 3001) |
| `make start-stop` | Stop production server |
| `make db-shell` | psql into observer DB |
| `make status` | Show running containers |
| `make test` | Run Python tests |
| `make typecheck` | TypeScript check |

## Keyboard Navigation

The app is designed for keyboard-first navigation.

### Chat List (`/`)

| Key | Action |
|---|---|
| `↑` `↓` | Navigate between chats |
| `Enter` | Open selected chat |

### Message List (`/chats/[id]`)

| Key | Action |
|---|---|
| `↑` `↓` | Navigate between messages |
| `Enter` | View workflow for selected message |
| `E` | Toggle full text / truncated preview |
| `Esc` | Back to chat list |

### Activity Steps (`/chats/[id]/messages/[messageId]`)

| Key | Action |
|---|---|
| `↑` `↓` | Navigate between activities |
| `Space` | Prompt view (invokeModel) or JSON view (others) |
| `Enter` | JSON view / drill into child workflow |
| `F` | Open/close activity type filter |
| `T` | Bypass filter (show all) |
| `Esc` | Back to messages / close overlay |

### Prompt View (invokeModel overlay)

| Key | Action |
|---|---|
| `S` | Toggle system messages (collapse/expand) |
| `Esc` | Close overlay |

### JSON View (overlay)

| Key | Action |
|---|---|
| Type in search | Search and highlight matches |
| `Enter` | Next match |
| `Shift+Enter` | Previous match |
| `Esc` | Close overlay |

## Data Model

### Sync Strategy

- **Users**: Full upsert every run (small table)
- **Chats**: Incremental — only chats updated since last sync
- **Messages**: Incremental — only new messages since last sync
- **Message Parts**: Incremental — only new parts since last sync
- **Workflows**: Skip terminal workflows already in DB, re-fetch running ones
- **Activities**: Insert with dedup (ON CONFLICT DO NOTHING)
- **Child Workflows**: Recursively ingested from parent workflow history

### Key Relationships

- `workflows.message_id` → links a workflow to the message it produced
- `workflows.parent_workflow_id` → links child workflows to their parent (for sub-agents)
- Activities are the individual steps within a workflow (LLM calls, tool calls, etc.)

## Tech Stack

- **Sync**: Python 3.12+, `temporalio`, `psycopg` v3, `python-dotenv`
- **Web**: Next.js 15, React 19, shadcn/ui, Tailwind CSS, `pg` (node-postgres)
- **Database**: PostgreSQL 17
- **Package Management**: `uv` (Python), `npm` (Node)
