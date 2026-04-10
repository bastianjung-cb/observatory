# Observer Web App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a keyboard-driven Next.js app for exploring LLM agent workflow steps per chat message, reading from the observer Postgres database.

**Architecture:** Next.js 15 App Router with Server Components for data fetching, Client Components for interactivity (keyboard nav, search, filters). Single DB connection to the observer Postgres via `pg`. shadcn/ui for all UI components, Tailwind for styling. Three views: chat list → message list → activity steps.

**Tech Stack:** Next.js 15, React 19, shadcn/ui, Tailwind CSS, `pg` (node-postgres), TypeScript

---

## File Structure

| File | Responsibility |
|---|---|
| `web/` | Next.js app root |
| `web/lib/db.ts` | Postgres connection pool (observer DB) |
| `web/lib/queries/chats.ts` | Chat list + search SQL queries |
| `web/lib/queries/messages.ts` | Message + parts SQL queries |
| `web/lib/queries/activities.ts` | Workflow + activity SQL queries |
| `web/components/use-keyboard-nav.ts` | Shared keyboard navigation hook |
| `web/components/chat-table.tsx` | Chat list table + search (Client Component) |
| `web/components/message-list.tsx` | Message list (Client Component) |
| `web/components/activity-steps.tsx` | Activity list + filter + expand (Client Component) |
| `web/components/sync-button.tsx` | Manual sync trigger (Client Component) |
| `web/app/layout.tsx` | Root layout with header + sync button |
| `web/app/page.tsx` | Chat list page (Server Component) |
| `web/app/chats/[id]/page.tsx` | Message list page (Server Component) |
| `web/app/chats/[id]/messages/[messageId]/page.tsx` | Activity steps page (Server Component) |
| `web/app/actions.ts` | Server Actions (sync trigger) |
| `web/.env.local` | Environment variables |

---

### Task 1: Project Scaffold

**Files:**
- Create: `web/` (via create-next-app)
- Create: `web/.env.local`

- [ ] **Step 1: Create Next.js app**

```bash
cd /mnt/observer_app
npx create-next-app@latest web --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*" --use-npm --no-turbopack
```

When prompted, accept defaults. This creates the `web/` directory with Next.js 15, TypeScript, Tailwind, App Router.

- [ ] **Step 2: Install dependencies**

```bash
cd /mnt/observer_app/web
npm install pg
npm install -D @types/pg
```

- [ ] **Step 3: Initialize shadcn/ui**

```bash
cd /mnt/observer_app/web
npx shadcn@latest init -d
```

This sets up shadcn with default config (New York style, CSS variables).

- [ ] **Step 4: Install shadcn components we need**

```bash
cd /mnt/observer_app/web
npx shadcn@latest add table badge input button popover checkbox
```

- [ ] **Step 5: Create `.env.local`**

```
OBSERVER_DATABASE_URL=postgresql://observer:observer@localhost:5436/observer
```

- [ ] **Step 6: Set dev server to port 3001**

Edit `web/package.json` — change the `dev` script:

```json
"dev": "next dev -p 3001",
```

- [ ] **Step 7: Verify it runs**

```bash
cd /mnt/observer_app/web
npm run dev &
sleep 5
curl -s http://localhost:3001 | head -20
kill %1
```

Expected: HTML output from Next.js default page.

---

### Task 2: Database Connection + Query Functions

**Files:**
- Create: `web/lib/db.ts`
- Create: `web/lib/queries/chats.ts`
- Create: `web/lib/queries/messages.ts`
- Create: `web/lib/queries/activities.ts`

- [ ] **Step 1: Create `web/lib/db.ts`**

```typescript
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.OBSERVER_DATABASE_URL,
});

export default pool;
```

- [ ] **Step 2: Create `web/lib/queries/chats.ts`**

```typescript
import pool from "@/lib/db";

export interface ChatRow {
  id: string;
  title: string | null;
  user_name: string;
  user_email: string | null;
  message_count: number;
  last_message_at: string | null;
}

export async function getChats(
  search?: string,
  page = 1,
  pageSize = 50
): Promise<{ chats: ChatRow[]; total: number }> {
  const offset = (page - 1) * pageSize;

  let whereClause = 'WHERE c.deleted_at IS NULL';
  const params: (string | number)[] = [];
  let paramIndex = 1;

  if (search && search.trim()) {
    const term = search.trim();
    whereClause += ` AND (
      u.given_name ILIKE $${paramIndex}
      OR u.family_name ILIKE $${paramIndex}
      OR u.email ILIKE $${paramIndex}
      OR EXISTS (
        SELECT 1 FROM messages m2
        JOIN message_parts mp ON mp.message_id = m2.id
        WHERE m2.chat_id = c.id
          AND mp.content->>'type' = 'text'
          AND to_tsvector('english', mp.content->>'text') @@ plainto_tsquery('english', $${paramIndex + 1})
      )
    )`;
    params.push(`%${term}%`, term);
    paramIndex += 2;
  }

  const countQuery = `
    SELECT COUNT(*) as total
    FROM chats c
    JOIN users u ON u.id = c.user_id
    ${whereClause}
  `;
  const countResult = await pool.query(countQuery, params);
  const total = parseInt(countResult.rows[0].total, 10);

  const dataQuery = `
    SELECT
      c.id,
      c.title,
      COALESCE(u.given_name || ' ' || u.family_name, u.email, 'Unknown') as user_name,
      u.email as user_email,
      COUNT(m.id)::int as message_count,
      MAX(m.created_at) as last_message_at
    FROM chats c
    JOIN users u ON u.id = c.user_id
    LEFT JOIN messages m ON m.chat_id = c.id
    ${whereClause}
    GROUP BY c.id, c.title, u.given_name, u.family_name, u.email
    ORDER BY MAX(m.created_at) DESC NULLS LAST
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;

  const result = await pool.query(dataQuery, [...params, pageSize, offset]);

  return {
    chats: result.rows,
    total,
  };
}
```

- [ ] **Step 3: Create `web/lib/queries/messages.ts`**

```typescript
import pool from "@/lib/db";

export interface MessageRow {
  id: string;
  order: number;
  role: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  content_preview: string | null;
  has_workflow: boolean;
}

export interface ChatInfo {
  id: string;
  title: string | null;
  user_name: string;
}

export async function getChatInfo(chatId: string): Promise<ChatInfo | null> {
  const result = await pool.query(
    `SELECT c.id, c.title,
       COALESCE(u.given_name || ' ' || u.family_name, u.email, 'Unknown') as user_name
     FROM chats c
     JOIN users u ON u.id = c.user_id
     WHERE c.id = $1`,
    [chatId]
  );
  return result.rows[0] || null;
}

export async function getMessages(chatId: string): Promise<MessageRow[]> {
  const result = await pool.query(
    `SELECT
       m.id,
       m."order",
       m.role,
       m.metadata,
       m.created_at,
       (
         SELECT mp.content->>'text'
         FROM message_parts mp
         WHERE mp.message_id = m.id AND mp.content->>'type' = 'text'
         ORDER BY mp."order"
         LIMIT 1
       ) as content_preview,
       EXISTS (
         SELECT 1 FROM workflows w WHERE w.message_id = m.id
       ) as has_workflow
     FROM messages m
     WHERE m.chat_id = $1
     ORDER BY m."order" ASC`,
    [chatId]
  );
  return result.rows;
}
```

- [ ] **Step 4: Create `web/lib/queries/activities.ts`**

```typescript
import pool from "@/lib/db";

export interface WorkflowRow {
  workflow_id: string;
  status: string;
  start_time: string;
  end_time: string | null;
}

export interface ActivityRow {
  activity_id: string;
  activity_type: string;
  status: string;
  scheduled_time: string | null;
  started_time: string | null;
  completed_time: string | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  duration_ms: number | null;
}

export interface MessageInfo {
  id: string;
  role: string;
  chat_id: string;
  chat_title: string | null;
}

export const DEFAULT_HIDDEN_ACTIVITIES = [
  "appendMessagePart",
  "markResponseCompleted",
  "getSkillsFormatted",
  "loadContext",
];

export async function getMessageInfo(
  messageId: string
): Promise<MessageInfo | null> {
  const result = await pool.query(
    `SELECT m.id, m.role, c.id as chat_id, c.title as chat_title
     FROM messages m
     JOIN chats c ON c.id = m.chat_id
     WHERE m.id = $1`,
    [messageId]
  );
  return result.rows[0] || null;
}

export async function getWorkflowForMessage(
  messageId: string
): Promise<WorkflowRow | null> {
  const result = await pool.query(
    `SELECT workflow_id, status, start_time, end_time
     FROM workflows
     WHERE message_id = $1
     LIMIT 1`,
    [messageId]
  );
  return result.rows[0] || null;
}

export async function getActivities(
  workflowId: string
): Promise<ActivityRow[]> {
  const result = await pool.query(
    `SELECT
       activity_id,
       activity_type,
       status,
       scheduled_time,
       started_time,
       completed_time,
       input,
       output,
       CASE
         WHEN completed_time IS NOT NULL AND scheduled_time IS NOT NULL
         THEN EXTRACT(EPOCH FROM (completed_time - scheduled_time)) * 1000
         ELSE NULL
       END as duration_ms
     FROM activities
     WHERE workflow_id = $1
     ORDER BY activity_id::int ASC`,
    [workflowId]
  );
  return result.rows;
}
```

- [ ] **Step 5: Verify queries compile**

```bash
cd /mnt/observer_app/web
npx tsc --noEmit
```

Expected: No errors (or only pre-existing Next.js template warnings).

---

### Task 3: Keyboard Navigation Hook

**Files:**
- Create: `web/components/use-keyboard-nav.ts`

- [ ] **Step 1: Create the hook**

```typescript
"use client";

import { useCallback, useEffect, useState } from "react";

interface UseKeyboardNavOptions {
  itemCount: number;
  onEnter?: (index: number) => void;
  onEscape?: () => void;
  onSpace?: (index: number) => void;
  enabled?: boolean;
}

export function useKeyboardNav({
  itemCount,
  onEnter,
  onEscape,
  onSpace,
  enabled = true,
}: UseKeyboardNavOptions) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Reset selection when item count changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [itemCount]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      // Don't capture when typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        // Allow Escape to blur the input
        if (e.key === "Escape") {
          (e.target as HTMLElement).blur();
          e.preventDefault();
          return;
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, itemCount - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          onEnter?.(selectedIndex);
          break;
        case "Escape":
          e.preventDefault();
          onEscape?.();
          break;
        case " ":
          e.preventDefault();
          onSpace?.(selectedIndex);
          break;
      }
    },
    [enabled, itemCount, onEnter, onEscape, onSpace, selectedIndex]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return { selectedIndex, setSelectedIndex };
}
```

---

### Task 4: Root Layout + Chat List Page (View 1)

**Files:**
- Modify: `web/app/layout.tsx`
- Create: `web/app/page.tsx` (replace default)
- Create: `web/components/chat-table.tsx`

- [ ] **Step 1: Replace `web/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Observer",
  description: "Explore LLM agent workflow steps",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-background text-foreground`}>
        <div className="min-h-screen">
          <header className="border-b px-6 py-3 flex items-center justify-between">
            <h1 className="text-lg font-semibold">Observer</h1>
          </header>
          <main className="p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Create `web/components/chat-table.tsx`**

```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useEffect } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { useKeyboardNav } from "@/components/use-keyboard-nav";

interface Chat {
  id: string;
  title: string | null;
  user_name: string;
  user_email: string | null;
  message_count: number;
  last_message_at: string | null;
}

export function ChatTable({
  chats,
  search,
  total,
  page,
  pageSize,
}: {
  chats: Chat[];
  search: string;
  total: number;
  page: number;
  pageSize: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);

  const { selectedIndex } = useKeyboardNav({
    itemCount: chats.length,
    onEnter: (index) => {
      if (chats[index]) {
        router.push(`/chats/${chats[index].id}`);
      }
    },
  });

  // Scroll selected row into view
  const selectedRowRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  function handleSearch(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set("q", value);
    } else {
      params.delete("q");
    }
    params.delete("page");
    router.push(`/?${params.toString()}`);
  }

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Input
          ref={searchRef}
          placeholder="Search by user or message content..."
          defaultValue={search}
          onChange={(e) => {
            const timeout = setTimeout(() => handleSearch(e.target.value), 300);
            return () => clearTimeout(timeout);
          }}
          className="max-w-sm"
        />
        <span className="text-sm text-muted-foreground">
          {total} chat{total !== 1 ? "s" : ""}
        </span>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Chat</TableHead>
            <TableHead className="text-right">Messages</TableHead>
            <TableHead>Last Message</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {chats.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                {search ? `No chats found for "${search}"` : "No chats found"}
              </TableCell>
            </TableRow>
          ) : (
            chats.map((chat, index) => (
              <TableRow
                key={chat.id}
                ref={index === selectedIndex ? selectedRowRef : undefined}
                className={`cursor-pointer ${
                  index === selectedIndex
                    ? "bg-accent"
                    : "hover:bg-accent/50"
                }`}
                onClick={() => router.push(`/chats/${chat.id}`)}
              >
                <TableCell>
                  <div className="font-medium">{chat.user_name}</div>
                  {chat.user_email && (
                    <div className="text-xs text-muted-foreground">
                      {chat.user_email}
                    </div>
                  )}
                </TableCell>
                <TableCell>{chat.title || "Untitled"}</TableCell>
                <TableCell className="text-right">{chat.message_count}</TableCell>
                <TableCell>
                  {chat.last_message_at
                    ? new Date(chat.last_message_at).toLocaleString()
                    : "—"}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <button
            className="px-3 py-1 rounded border disabled:opacity-50"
            disabled={page <= 1}
            onClick={() => {
              const params = new URLSearchParams(searchParams.toString());
              params.set("page", String(page - 1));
              router.push(`/?${params.toString()}`);
            }}
          >
            Previous
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            className="px-3 py-1 rounded border disabled:opacity-50"
            disabled={page >= totalPages}
            onClick={() => {
              const params = new URLSearchParams(searchParams.toString());
              params.set("page", String(page + 1));
              router.push(`/?${params.toString()}`);
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Replace `web/app/page.tsx`**

```tsx
import { Suspense } from "react";
import { getChats } from "@/lib/queries/chats";
import { ChatTable } from "@/components/chat-table";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const search = params.q || "";
  const page = parseInt(params.page || "1", 10);
  const pageSize = 50;

  const { chats, total } = await getChats(search, page, pageSize);

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Chats</h2>
      <Suspense fallback={<div>Loading...</div>}>
        <ChatTable
          chats={chats}
          search={search}
          total={total}
          page={page}
          pageSize={pageSize}
        />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 4: Verify it compiles**

```bash
cd /mnt/observer_app/web
npx tsc --noEmit
```

---

### Task 5: Message List Page (View 2)

**Files:**
- Create: `web/app/chats/[id]/page.tsx`
- Create: `web/components/message-list.tsx`

- [ ] **Step 1: Create `web/components/message-list.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useRef, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { useKeyboardNav } from "@/components/use-keyboard-nav";

interface Message {
  id: string;
  order: number;
  role: string;
  created_at: string;
  content_preview: string | null;
  has_workflow: boolean;
}

const roleBadgeVariant: Record<string, "default" | "secondary" | "outline"> = {
  USER: "default",
  ASSISTANT: "secondary",
  SYSTEM: "outline",
};

export function MessageList({
  messages,
  chatId,
}: {
  messages: Message[];
  chatId: string;
}) {
  const router = useRouter();

  const { selectedIndex } = useKeyboardNav({
    itemCount: messages.length,
    onEnter: (index) => {
      const msg = messages[index];
      if (msg?.has_workflow) {
        router.push(`/chats/${chatId}/messages/${msg.id}`);
      }
    },
    onEscape: () => {
      router.push("/");
    },
  });

  const selectedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  return (
    <div className="space-y-1">
      {messages.length === 0 ? (
        <div className="text-center text-muted-foreground py-8">
          No messages
        </div>
      ) : (
        messages.map((msg, index) => (
          <div
            key={msg.id}
            ref={index === selectedIndex ? selectedRef : undefined}
            className={`flex items-start gap-3 p-3 rounded-md cursor-pointer ${
              index === selectedIndex ? "bg-accent" : "hover:bg-accent/50"
            }`}
            onClick={() => {
              if (msg.has_workflow) {
                router.push(`/chats/${chatId}/messages/${msg.id}`);
              }
            }}
          >
            <Badge variant={roleBadgeVariant[msg.role] || "outline"}>
              {msg.role}
            </Badge>
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">
                {msg.content_preview || "(no text content)"}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {msg.has_workflow && (
                <Badge variant="outline" className="text-xs">
                  workflow
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {new Date(msg.created_at).toLocaleTimeString()}
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `web/app/chats/[id]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { getChatInfo, getMessages } from "@/lib/queries/messages";
import { MessageList } from "@/components/message-list";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const chat = await getChatInfo(id);

  if (!chat) {
    notFound();
  }

  const messages = await getMessages(id);

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-bold">
          {chat.title || "Untitled Chat"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {chat.user_name} &middot; {messages.length} messages &middot; Press
          Esc to go back
        </p>
      </div>
      <MessageList messages={messages} chatId={id} />
    </div>
  );
}
```

---

### Task 6: Activity Steps Page (View 3)

**Files:**
- Create: `web/app/chats/[id]/messages/[messageId]/page.tsx`
- Create: `web/components/activity-steps.tsx`

- [ ] **Step 1: Create `web/components/activity-steps.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useRef, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useKeyboardNav } from "@/components/use-keyboard-nav";

interface Activity {
  activity_id: string;
  activity_type: string;
  status: string;
  scheduled_time: string | null;
  started_time: string | null;
  completed_time: string | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  duration_ms: number | null;
}

const DEFAULT_HIDDEN = new Set([
  "appendMessagePart",
  "markResponseCompleted",
  "getSkillsFormatted",
  "loadContext",
]);

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ActivitySteps({
  activities,
  chatId,
}: {
  activities: Activity[];
  chatId: string;
}) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  // Build set of all activity types
  const allTypes = Array.from(
    new Set(activities.map((a) => a.activity_type))
  ).sort();

  // Hidden types state
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(
    () => new Set(allTypes.filter((t) => DEFAULT_HIDDEN.has(t)))
  );

  const filteredActivities = activities.filter(
    (a) => !hiddenTypes.has(a.activity_type)
  );

  const { selectedIndex } = useKeyboardNav({
    itemCount: filteredActivities.length,
    onEscape: () => {
      router.push(`/chats/${chatId}`);
    },
    onSpace: (index) => {
      const activity = filteredActivities[index];
      if (activity) {
        setExpandedId((prev) =>
          prev === activity.activity_id ? null : activity.activity_id
        );
      }
    },
  });

  // F key for filter toggle
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        setFilterOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const selectedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  function toggleType(type: string) {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Popover open={filterOpen} onOpenChange={setFilterOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              Filter ({filteredActivities.length}/{activities.length})
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64">
            <div className="space-y-2">
              <p className="text-sm font-medium">Activity Types</p>
              {allTypes.map((type) => (
                <label
                  key={type}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <Checkbox
                    checked={!hiddenTypes.has(type)}
                    onCheckedChange={() => toggleType(type)}
                  />
                  {type}
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <span className="text-xs text-muted-foreground">
          Press F to toggle filter &middot; Space to expand &middot; Esc to go
          back
        </span>
      </div>

      <div className="space-y-1">
        {filteredActivities.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            No activities (adjust filter)
          </div>
        ) : (
          filteredActivities.map((activity, index) => (
            <div key={activity.activity_id}>
              <div
                ref={index === selectedIndex ? selectedRef : undefined}
                className={`flex items-center gap-3 p-3 rounded-md cursor-pointer ${
                  index === selectedIndex ? "bg-accent" : "hover:bg-accent/50"
                }`}
                onClick={() =>
                  setExpandedId((prev) =>
                    prev === activity.activity_id
                      ? null
                      : activity.activity_id
                  )
                }
              >
                <span className="font-mono text-sm font-medium min-w-0 truncate">
                  {activity.activity_type}
                </span>
                <Badge
                  variant={
                    activity.status === "COMPLETED" ? "secondary" : "destructive"
                  }
                >
                  {activity.status}
                </Badge>
                <span className="text-xs text-muted-foreground ml-auto shrink-0">
                  {formatDuration(activity.duration_ms)}
                </span>
              </div>

              {expandedId === activity.activity_id && (
                <div className="grid grid-cols-2 gap-4 p-4 mx-3 mb-1 rounded-md border bg-muted/30">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      Input
                    </p>
                    <pre className="text-xs overflow-auto max-h-96 p-3 rounded bg-background border">
                      {activity.input
                        ? JSON.stringify(activity.input, null, 2)
                        : "null"}
                    </pre>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      Output
                    </p>
                    <pre className="text-xs overflow-auto max-h-96 p-3 rounded bg-background border">
                      {activity.output
                        ? JSON.stringify(activity.output, null, 2)
                        : "null"}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `web/app/chats/[id]/messages/[messageId]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import {
  getMessageInfo,
  getWorkflowForMessage,
  getActivities,
} from "@/lib/queries/activities";
import { ActivitySteps } from "@/components/activity-steps";
import { Badge } from "@/components/ui/badge";

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ id: string; messageId: string }>;
}) {
  const { id, messageId } = await params;
  const messageInfo = await getMessageInfo(messageId);

  if (!messageInfo) {
    notFound();
  }

  const workflow = await getWorkflowForMessage(messageId);

  if (!workflow) {
    return (
      <div>
        <h2 className="text-2xl font-bold mb-2">
          {messageInfo.chat_title || "Untitled Chat"}
        </h2>
        <p className="text-muted-foreground">
          No workflow found for this message.
        </p>
      </div>
    );
  }

  const activities = await getActivities(workflow.workflow_id);

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-bold">
          {messageInfo.chat_title || "Untitled Chat"}
        </h2>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary">{messageInfo.role}</Badge>
          <span>message</span>
          <span>&middot;</span>
          <Badge variant="outline">{workflow.status}</Badge>
          <span>{activities.length} activities</span>
          <span>&middot;</span>
          <span>Press Esc to go back</span>
        </div>
      </div>
      <ActivitySteps activities={activities} chatId={id} />
    </div>
  );
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cd /mnt/observer_app/web
npx tsc --noEmit
```

---

### Task 7: Sync Button

**Files:**
- Create: `web/app/actions.ts`
- Create: `web/components/sync-button.tsx`
- Modify: `web/app/layout.tsx`

- [ ] **Step 1: Create `web/app/actions.ts`**

```typescript
"use server";

import { exec } from "child_process";
import { revalidatePath } from "next/cache";

export async function runSync(): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    exec(
      "cd /mnt/observer_app && uv run python main.py",
      { timeout: 120000 },
      (error, stdout, stderr) => {
        if (error) {
          console.error("Sync failed:", stderr);
          resolve({ success: false, message: stderr || error.message });
        } else {
          console.log("Sync output:", stdout);
          revalidatePath("/");
          resolve({ success: true, message: stdout });
        }
      }
    );
  });
}
```

- [ ] **Step 2: Create `web/components/sync-button.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { runSync } from "@/app/actions";

export function SyncButton() {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  async function handleSync() {
    setSyncing(true);
    setResult(null);
    try {
      const res = await runSync();
      setResult(res);
    } catch {
      setResult({ success: false, message: "Sync request failed" });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleSync}
        disabled={syncing}
      >
        {syncing ? "Syncing..." : "Sync Now"}
      </Button>
      {result && (
        <span
          className={`text-xs ${
            result.success ? "text-green-600" : "text-red-600"
          }`}
        >
          {result.success ? "Synced!" : "Failed"}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Update `web/app/layout.tsx` to include sync button**

```tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SyncButton } from "@/components/sync-button";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Observer",
  description: "Explore LLM agent workflow steps",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-background text-foreground`}>
        <div className="min-h-screen">
          <header className="border-b px-6 py-3 flex items-center justify-between">
            <h1 className="text-lg font-semibold">Observer</h1>
            <SyncButton />
          </header>
          <main className="p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Verify it compiles**

```bash
cd /mnt/observer_app/web
npx tsc --noEmit
```

---

### Task 8: Smoke Test

- [ ] **Step 1: Ensure databases are running**

```bash
docker compose up -d
cd /mnt/cellbyte && docker compose up -d db
cd /mnt/observer_app
```

Observer Postgres on 5436, cellbyte DB on 5432.

- [ ] **Step 2: Run a sync to ensure data is fresh**

```bash
cd /mnt/observer_app
uv run python main.py
```

- [ ] **Step 3: Start the dev server**

```bash
cd /mnt/observer_app/web
npm run dev
```

- [ ] **Step 4: Manual verification checklist**

Open `http://localhost:3001` in browser and verify:

1. **Chat list page:** Table shows chats with user name, title, message count, last message time. Sorted newest first.
2. **Arrow keys:** Up/Down highlights rows.
3. **Enter:** Navigates to the message list for the selected chat.
4. **Search:** Type a user name or keyword — table filters. Clear search — full list returns.
5. **Message list page:** Shows messages chronologically. Role badges (USER/ASSISTANT). Content preview.
6. **Escape:** Returns to chat list.
7. **Enter on assistant message with workflow badge:** Navigates to activity steps.
8. **Activity steps page:** Lists activities. Default filter hides plumbing activities.
9. **F key:** Opens/closes filter popover.
10. **Space:** Expands selected activity to show input (left) / output (right) JSON.
11. **Space again:** Collapses it.
12. **Escape:** Returns to message list.
13. **Sync button:** Click "Sync Now" in header — shows "Syncing..." then "Synced!".
