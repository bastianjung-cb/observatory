# Cellbyte Observatory

A keyboard-driven web app for exploring what LLM agents did for each message response. Browse chats, inspect messages, drill into workflow steps, view LLM prompts in markdown, track token usage and costs.

## Architecture

```
.env                        ← Single config for all connections
main.py                     ← Sync pipeline: app DB + Temporal → observer DB
web/                        ← Next.js app: reads from observer DB only
migrations/                 ← Alembic database migrations

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

## Prerequisites

- Docker & Docker Compose
- Python 3.12+ with [uv](https://docs.astral.sh/uv/)
- Node.js 20+ with npm

## Installation

```bash
# Clone
git clone https://github.com/bastianjung-cb/observatory.git
cd observatory

# Install Python dependencies
uv sync --all-extras

# Install web app dependencies
cd web && npm install && cd ..
```

## Configuration

All config is in a single `.env` file at the project root. Both the Python sync scripts and the Next.js web app read from it. Copy `.env` and fill in your values.

| Variable | Required | Used by | Description |
|---|---|---|---|
| `OBSERVER_DATABASE_URL` | Yes | Python + Web | Postgres connection for the observer DB (our local store). Default: `postgresql://observer:observer@localhost:5436/observer` |
| `APP_DATABASE_URL` | Yes | Python | Postgres connection for the cellbyte app DB (source for users, chats, messages). |
| `TEMPORAL_HOST` | Yes | Python | Temporal gRPC address. Default: `localhost:7233` |
| `TEMPORAL_NAMESPACE` | No | Python + Web | Temporal namespace. Default: `default` |
| `TEMPORAL_UI_URL` | No | Web | Base URL of the Temporal UI. Enables the "Open in Temporal" button on messages. |
| `APP_URL` | No | Web | URL of the main product. Shows a "Chat now" button in the header linking to it. |

```env
# Observer Database (our local store)
OBSERVER_DATABASE_URL=postgresql://observer:observer@localhost:5436/observer

# App Database (cellbyte - source for users, chats, messages)
APP_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cellbyte

# Temporal
TEMPORAL_HOST=localhost:7233
TEMPORAL_NAMESPACE=default

# Temporal UI (for deep-link button on messages)
TEMPORAL_UI_URL=https://your-temporal-ui.example.com

# App URL (for "Chat now" button in the header)
APP_URL=https://your-app.example.com/
```

## Quick Start

```bash
# 1. Copy and edit config
cp .env.example .env        # then edit with your DB/Temporal URLs

# 2. Start observer Postgres
make up

# 3. Run database migrations
make migrate

# 4. Sync data from app DB + Temporal
make sync

# 5. Start the web app
make dev                    # http://localhost:3001
```

## Database & Migrations

Schema is managed by **Alembic**. Never manually edit tables — use migrations.

```bash
# Apply all pending migrations (safe, idempotent)
make migrate

# Create a new migration
make migration              # prompts for a name

# Check current migration status
uv run alembic current

# View migration history
uv run alembic history
```

### Resetting the database

**Warning:** The observer DB contains workflow and activity data synced from Temporal. Once Temporal purges old workflows (retention policy), this data **cannot be recovered**. Think twice before resetting.

```bash
# Safe: reset only app data (users, chats, messages) — keeps workflows intact
make reset-app-data

# Dangerous: wipe everything (requires typing confirmation)
make reset
```

## Project Structure

```
observatory/
├── .env                          # All connection config
├── Makefile                      # Dev commands
├── docker-compose.yml            # Observer Postgres (port 5436)
│
├── main.py                       # Sync pipeline entry point
├── db.py                         # Schema, upserts, sync state helpers
├── app_sync.py                   # Syncs users/chats/messages from app DB
├── temporal_client.py            # Temporal SDK client, history parsing
│
├── alembic.ini                   # Alembic config
├── migrations/
│   ├── env.py                    # Migration environment (reads .env)
│   └── versions/                 # Migration files
│
├── tests/
│   ├── test_db.py                # DB module tests (24 tests)
│   └── test_temporal_client.py   # Temporal parsing tests
│
├── web/                          # Next.js app
│   ├── app/
│   │   ├── page.tsx              # Chat list (home)
│   │   ├── chats/[id]/
│   │   │   └── page.tsx          # Message list
│   │   │   └── messages/[messageId]/
│   │   │       └── page.tsx      # Activity steps
│   │   ├── dashboard/            # Usage & cost dashboard
│   │   └── settings/             # Model pricing & DB status
│   ├── components/
│   │   ├── chat-table.tsx        # Chat list with sort/filter
│   │   ├── message-list.tsx      # Message cards with markdown
│   │   ├── activity-steps.tsx    # Activities, JSON viewer, prompt viewer
│   │   ├── use-keyboard-nav.ts   # Shared keyboard navigation hook
│   │   └── ...                   # UI components
│   └── lib/
│       ├── db.ts                 # Postgres connection pool
│       └── queries/              # SQL query functions
│           ├── chats.ts
│           ├── messages.ts
│           ├── activities.ts
│           ├── dashboard.ts
│           └── settings.ts
│
├── logos/                        # Cellbyte brand assets
└── docs/superpowers/             # Design specs & implementation plans
```

## Makefile Commands

| Command | Description |
|---|---|
| `make up` | Start observer Postgres |
| `make down` | Stop observer Postgres |
| `make migrate` | Run Alembic migrations |
| `make migration` | Create a new migration |
| `make sync` | Sync app data + Temporal workflows |
| `make reset-app-data` | Clear rebuildable data (keeps workflows) |
| `make reset` | Wipe entire DB (requires confirmation) |
| `make dev` | Start web app in dev mode (:3001) |
| `make dev-stop` | Stop dev server |
| `make build` | Production build |
| `make start` | Run production build (:3001) |
| `make start-stop` | Stop production server |
| `make db-shell` | psql into observer DB |
| `make status` | Show running containers |
| `make test` | Run Python tests |
| `make typecheck` | TypeScript type check |

## Keyboard Navigation

The app is keyboard-first. Arrow keys navigate, right arrow drills in, left arrow goes back.

### Chat List (`/`)

| Key | Action |
|---|---|
| `↑` `↓` | Navigate chats |
| `→` / `Enter` | Open chat |
| `Shift+↑` / `Shift+↓` | Jump to first / last |

### Message List (`/chats/[id]`)

| Key | Action |
|---|---|
| `↑` `↓` | Navigate messages |
| `→` / `Enter` | View workflow steps |
| `←` / `Esc` | Back to chats |
| `Shift+↑` / `Shift+↓` | Jump to first / last |
| `E` | Toggle full text / preview |
| `R` | Reverse message order |
| `W` | Open workflow in Temporal UI |

### Activity Steps (`/chats/[id]/messages/[messageId]`)

| Key | Action |
|---|---|
| `↑` `↓` | Navigate activities |
| `Space` | Prompt view (invokeModel) / JSON view |
| `→` / `Enter` | JSON view / enter child workflow |
| `←` / `Esc` | Back / close overlay |
| `Shift+↑` / `Shift+↓` | Jump to first / last |
| `F` | Toggle activity type filter |
| `T` | Bypass filter (show all) |
| `I` | Show invokeModel calls only |
| `R` | Reverse activity order |

### Prompt View (invokeModel overlay)

| Key | Action |
|---|---|
| `S` | Toggle system messages |
| `←` / `Esc` | Close |

### JSON View (overlay)

| Key | Action |
|---|---|
| `F` | Focus search box |
| `Enter` | Next search match |
| `Shift+Enter` | Previous match |
| `←` / `Esc` | Close |

## Features

- **Chat explorer** — search by user, email, or message content (full-text search)
- **Server-side sorting** — sort by user, title, messages, cost, cost/msg, last message
- **Markdown rendering** — messages rendered as markdown with GFM tables
- **Prompt viewer** — split-panel view of invokeModel input/output with system message toggle
- **JSON viewer** — syntax-highlighted JSON with search, match navigation, and copy
- **Token & cost tracking** — per-activity, per-message, per-chat costs with model pricing
- **Usage dashboard** — daily cost/token charts, per-user cost breakdown
- **Activity filtering** — whitelist-based filter with keyboard toggle
- **Child workflow support** — drill-down navigation with breadcrumbs
- **Dark mode** — default dark, toggle in header, no flash on navigation
- **Position memory** — remembers selected item when navigating back
- **Sync from UI** — "Sync Now" button in header
- **Auto sync** — hourly background sync, toggle on/off from Settings page

## Data Sync

### Manual

- Click **"Sync Now"** in the header for an immediate sync
- Run `make sync` from the command line

### Auto Sync

Enable hourly background sync from the **Settings** page. When enabled, the Next.js server runs the sync pipeline every 60 minutes. The first sync runs immediately on enable. Status (last run time, success/error) is shown on the Settings page.

The enabled/disabled state is persisted in the database (`settings` table), so it survives server restarts.

### Strategy

- **Users**: Full upsert every run (small table)
- **Chats**: Incremental — only chats updated since last sync
- **Messages**: Incremental — only new messages since last sync
- **Message Parts**: Incremental — only new parts since last sync
- **Workflows**: Skip terminal workflows already in DB
- **Activities**: Insert with dedup (ON CONFLICT DO NOTHING)
- **Child Workflows**: Recursively ingested from parent workflow history

### Important

Workflow data synced from Temporal is **irreplaceable** once Temporal purges it. The sync should run frequently (e.g., every hour) to capture workflows before they expire. Never reset the observer DB unless absolutely necessary.

## Tech Stack

- **Sync**: Python 3.12+, `temporalio`, `psycopg` v3, `python-dotenv`, `alembic`
- **Web**: Next.js 15, React 19, shadcn/ui, Tailwind CSS, `pg`, `recharts`
- **Database**: PostgreSQL 17
- **Package Management**: `uv` (Python), `npm` (Node)
