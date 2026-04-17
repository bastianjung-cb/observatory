"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { useKeyboardNav } from "@/components/use-keyboard-nav";

function timeAgo(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

interface Chat {
  id: string;
  title: string | null;
  user_name: string;
  user_email: string | null;
  message_count: number;
  last_message_at: string | null;
  total_cost_usd: number | null;
}

function formatCost(cost: number | string | null): string {
  const n = Number(cost);
  if (!n || isNaN(n) || n === 0) return "—";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

type SortKey = "user" | "title" | "messages" | "cost" | "cost_per_msg" | "last_message";
type SortDir = "asc" | "desc";

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span className={`ml-1 inline-block ${active ? "text-foreground" : "text-muted-foreground/40"}`}>
      {!active ? "↕" : dir === "asc" ? "↑" : "↓"}
    </span>
  );
}

const COL_GRID = "grid grid-cols-[200px_1fr_80px_80px_80px_160px] gap-2 items-center";

export function ChatTable({
  chats,
  search,
  userFilter,
  titleFilter,
  minMessages,
  total,
  page,
  pageSize,
  sortKey: currentSortKey,
  sortDir: currentSortDir,
}: {
  chats: Chat[];
  search: string;
  userFilter: string;
  titleFilter: string;
  minMessages: number | null;
  total: number;
  page: number;
  pageSize: number;
  sortKey: SortKey;
  sortDir: SortDir;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filterDebounceRefs = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({});

  function toggleSort(key: SortKey) {
    const params = new URLSearchParams(searchParams.toString());
    if (currentSortKey === key) {
      params.set("dir", currentSortDir === "asc" ? "desc" : "asc");
    } else {
      params.set("sort", key);
      params.set("dir", key === "messages" || key === "cost" || key === "cost_per_msg" ? "desc" : "asc");
    }
    params.delete("page");
    router.push(`/chats?${params.toString()}`);
  }

  const { selectedIndex } = useKeyboardNav({
    itemCount: chats.length,
    storageKey: "chats",
    onEnter: (index) => {
      if (chats[index]) {
        router.push(`/chats/${chats[index].id}`);
      }
    },
  });

  const selectedRowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = selectedRowRef.current?.closest("[class*='overflow-auto']");
    if (selectedIndex === 0) {
      container?.scrollTo(0, 0);
    } else if (selectedIndex === chats.length - 1) {
      container?.scrollTo(0, container.scrollHeight);
    } else {
      selectedRowRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, chats.length]);

  // Reads window.location.search so concurrent filter debounces see the
  // latest URL and don't clobber each other's params.
  function pushParam(field: string, value: string) {
    const current = typeof window !== "undefined" ? window.location.search : `?${searchParams.toString()}`;
    const params = new URLSearchParams(current);
    if (value) params.set(field, value);
    else params.delete(field);
    params.delete("page");
    router.push(`/chats?${params.toString()}`);
  }

  function handleSearch(value: string) {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => pushParam("q", value), 300);
  }

  function handleFilter(field: string, value: string) {
    const existing = filterDebounceRefs.current[field];
    if (existing) clearTimeout(existing);
    filterDebounceRefs.current[field] = setTimeout(() => pushParam(field, value), 300);
  }

  const totalPages = Math.ceil(total / pageSize);
  const hasAnyFilter = !!(search || userFilter || titleFilter || minMessages);

  return (
    <div className="flex flex-col -mx-6 -mt-6 -mb-6" style={{ height: "calc(100vh - 90px)" }}>
      {/* Fixed top: search + headers + filters */}
      <div className="shrink-0 bg-background border-b px-6">
        {/* Search */}
        <div className="flex items-center gap-4 py-3">
          <Input
            placeholder="Search by user or message content..."
            defaultValue={search}
            key={`q-${search}`}
            onChange={(e) => handleSearch(e.target.value)}
            className="max-w-sm"
          />
          <span className="text-sm text-muted-foreground">
            {total} chat{total !== 1 ? "s" : ""}
            {hasAnyFilter ? " (filtered)" : ""}
          </span>
        </div>

        {/* Column headers */}
        <div className={`${COL_GRID} px-3 py-2 border-t bg-muted/50`}>
          <button className="flex items-center gap-1 font-semibold text-xs uppercase tracking-wider hover:text-foreground transition-colors" onClick={() => toggleSort("user")}>
            User <SortIcon active={currentSortKey === "user"} dir={currentSortDir} />
          </button>
          <button className="flex items-center gap-1 font-semibold text-xs uppercase tracking-wider hover:text-foreground transition-colors" onClick={() => toggleSort("title")}>
            Chat <SortIcon active={currentSortKey === "title"} dir={currentSortDir} />
          </button>
          <button className="flex items-center gap-1 font-semibold text-xs uppercase tracking-wider hover:text-foreground transition-colors justify-end" onClick={() => toggleSort("messages")}>
            Msgs <SortIcon active={currentSortKey === "messages"} dir={currentSortDir} />
          </button>
          <button className="flex items-center gap-1 font-semibold text-xs uppercase tracking-wider hover:text-foreground transition-colors justify-end" onClick={() => toggleSort("cost")}>
            Cost <SortIcon active={currentSortKey === "cost"} dir={currentSortDir} />
          </button>
          <button className="flex items-center gap-1 font-semibold text-xs uppercase tracking-wider hover:text-foreground transition-colors justify-end" onClick={() => toggleSort("cost_per_msg")}>
            $/msg <SortIcon active={currentSortKey === "cost_per_msg"} dir={currentSortDir} />
          </button>
          <button className="flex items-center gap-1 font-semibold text-xs uppercase tracking-wider hover:text-foreground transition-colors" onClick={() => toggleSort("last_message")}>
            Last Message <SortIcon active={currentSortKey === "last_message"} dir={currentSortDir} />
          </button>
        </div>

        {/* Column filters (server-side; keyed so they reset with URL) */}
        <div className={`${COL_GRID} px-3 py-1.5 border-t bg-muted/30`}>
          <Input
            placeholder="Filter user..."
            defaultValue={userFilter}
            key={`fu-${userFilter}`}
            onChange={(e) => handleFilter("fu", e.target.value)}
            className="h-7 text-xs"
          />
          <Input
            placeholder="Filter title..."
            defaultValue={titleFilter}
            key={`ft-${titleFilter}`}
            onChange={(e) => handleFilter("ft", e.target.value)}
            className="h-7 text-xs"
          />
          <Input
            placeholder="Min"
            defaultValue={minMessages ?? ""}
            key={`fm-${minMessages ?? ""}`}
            onChange={(e) => handleFilter("fm", e.target.value)}
            className="h-7 text-xs text-right"
          />
          <div />
          <div />
          <div />
        </div>
      </div>

      {/* Scrollable rows */}
      <div className="flex-1 overflow-auto px-6">
        {chats.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            {hasAnyFilter ? "No chats match filters" : "No chats found"}
          </div>
        ) : (
          <div className="py-1">
            {chats.map((chat, index) => (
              <div
                key={chat.id}
                ref={index === selectedIndex ? selectedRowRef : undefined}
                className={`${COL_GRID} px-3 py-2.5 rounded-md cursor-pointer transition-all duration-150 ${
                  index === selectedIndex ? "row-glow" : "hover:bg-accent/50"
                }`}
                onClick={() => router.push(`/chats/${chat.id}`)}
              >
                <div>
                  <div className="font-medium truncate">{chat.user_name}</div>
                  {chat.user_email && (
                    <div className="text-xs text-muted-foreground truncate">{chat.user_email}</div>
                  )}
                </div>
                <div className="font-bold truncate">{chat.title || "Untitled"}</div>
                <div className="text-right tabular-nums">{chat.message_count}</div>
                <div className="text-right tabular-nums text-sm">{formatCost(chat.total_cost_usd)}</div>
                <div className="text-right tabular-nums text-sm">
                  {chat.message_count > 0 ? formatCost(Number(chat.total_cost_usd || 0) / chat.message_count) : "—"}
                </div>
                <div suppressHydrationWarning>
                  {chat.last_message_at ? (() => {
                    const d = new Date(chat.last_message_at!);
                    return (
                      <div>
                        <div className="text-sm" suppressHydrationWarning>{timeAgo(d)}</div>
                        <div className="text-xs text-muted-foreground" suppressHydrationWarning>{d.toLocaleString()}</div>
                      </div>
                    );
                  })() : "—"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Fixed bottom: pagination */}
      {totalPages > 1 && (
        <div className="shrink-0 bg-background border-t px-6 py-2 flex items-center justify-center gap-2 text-sm">
          <button
            className="px-3 py-1 rounded border disabled:opacity-50 hover:bg-accent transition-colors"
            disabled={page <= 1}
            onClick={() => {
              const params = new URLSearchParams(searchParams.toString());
              params.set("page", String(page - 1));
              router.push(`/chats?${params.toString()}`);
            }}
          >
            Previous
          </button>
          <span className="text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <button
            className="px-3 py-1 rounded border disabled:opacity-50 hover:bg-accent transition-colors"
            disabled={page >= totalPages}
            onClick={() => {
              const params = new URLSearchParams(searchParams.toString());
              params.set("page", String(page + 1));
              router.push(`/chats?${params.toString()}`);
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
