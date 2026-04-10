"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useEffect, useMemo, useState } from "react";
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
  if (!n || isNaN(n)) return "—";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

type SortKey = "user" | "title" | "messages" | "cost" | "last_message";
type SortDir = "asc" | "desc";

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span className={`ml-1 inline-block ${active ? "text-foreground" : "text-muted-foreground/40"}`}>
      {!active ? "↕" : dir === "asc" ? "↑" : "↓"}
    </span>
  );
}

const COL_GRID = "grid grid-cols-[200px_1fr_80px_80px_160px] gap-2 items-center";

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

  const [sortKey, setSortKey] = useState<SortKey>("last_message");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [userFilter, setUserFilter] = useState("");
  const [titleFilter, setTitleFilter] = useState("");
  const [msgFilter, setMsgFilter] = useState("");

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "messages" || key === "cost" ? "desc" : "asc");
    }
  }

  const filteredAndSorted = useMemo(() => {
    let result = chats;

    if (userFilter) {
      const f = userFilter.toLowerCase();
      result = result.filter(
        (c) =>
          c.user_name.toLowerCase().includes(f) ||
          (c.user_email?.toLowerCase().includes(f) ?? false)
      );
    }
    if (titleFilter) {
      const f = titleFilter.toLowerCase();
      result = result.filter((c) =>
        (c.title || "Untitled").toLowerCase().includes(f)
      );
    }
    if (msgFilter) {
      const n = parseInt(msgFilter, 10);
      if (!isNaN(n)) {
        result = result.filter((c) => c.message_count >= n);
      }
    }

    const sorted = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "user":
          cmp = a.user_name.localeCompare(b.user_name);
          break;
        case "title":
          cmp = (a.title || "").localeCompare(b.title || "");
          break;
        case "messages":
          cmp = a.message_count - b.message_count;
          break;
        case "cost":
          cmp = (Number(a.total_cost_usd) || 0) - (Number(b.total_cost_usd) || 0);
          break;
        case "last_message": {
          const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
          const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
          cmp = aTime - bTime;
          break;
        }
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [chats, userFilter, titleFilter, msgFilter, sortKey, sortDir]);

  const { selectedIndex } = useKeyboardNav({
    itemCount: filteredAndSorted.length,
    storageKey: "chats",
    onEnter: (index) => {
      if (filteredAndSorted[index]) {
        router.push(`/chats/${filteredAndSorted[index].id}`);
      }
    },
  });

  const selectedRowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = selectedRowRef.current?.closest("[class*='overflow-auto']");
    if (selectedIndex === 0) {
      container?.scrollTo(0, 0);
    } else if (selectedIndex === filteredAndSorted.length - 1) {
      container?.scrollTo(0, container.scrollHeight);
    } else {
      selectedRowRef.current?.scrollIntoView({ block: "nearest" });
    }
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
  const hasColumnFilters = !!(userFilter || titleFilter || msgFilter);

  return (
    <div className="flex flex-col -mx-6 -mt-6 -mb-6" style={{ height: "calc(100vh - 90px)" }}>
      {/* Fixed top: search + headers + filters */}
      <div className="shrink-0 bg-background border-b px-6">
        {/* Search */}
        <div className="flex items-center gap-4 py-3">
          <Input
            placeholder="Search by user or message content..."
            defaultValue={search}
            onChange={(e) => {
              const timeout = setTimeout(() => handleSearch(e.target.value), 300);
              return () => clearTimeout(timeout);
            }}
            className="max-w-sm"
          />
          <span className="text-sm text-muted-foreground">
            {hasColumnFilters
              ? `${filteredAndSorted.length} of ${total} chats`
              : `${total} chat${total !== 1 ? "s" : ""}`}
          </span>
        </div>

        {/* Column headers */}
        <div className={`${COL_GRID} px-3 py-2 border-t bg-muted/50`}>
          <button className="flex items-center gap-1 font-semibold text-xs uppercase tracking-wider hover:text-foreground transition-colors" onClick={() => toggleSort("user")}>
            User <SortIcon active={sortKey === "user"} dir={sortDir} />
          </button>
          <button className="flex items-center gap-1 font-semibold text-xs uppercase tracking-wider hover:text-foreground transition-colors" onClick={() => toggleSort("title")}>
            Chat <SortIcon active={sortKey === "title"} dir={sortDir} />
          </button>
          <button className="flex items-center gap-1 font-semibold text-xs uppercase tracking-wider hover:text-foreground transition-colors justify-end" onClick={() => toggleSort("messages")}>
            Msgs <SortIcon active={sortKey === "messages"} dir={sortDir} />
          </button>
          <button className="flex items-center gap-1 font-semibold text-xs uppercase tracking-wider hover:text-foreground transition-colors justify-end" onClick={() => toggleSort("cost")}>
            Cost <SortIcon active={sortKey === "cost"} dir={sortDir} />
          </button>
          <button className="flex items-center gap-1 font-semibold text-xs uppercase tracking-wider hover:text-foreground transition-colors" onClick={() => toggleSort("last_message")}>
            Last Message <SortIcon active={sortKey === "last_message"} dir={sortDir} />
          </button>
        </div>

        {/* Column filters */}
        <div className={`${COL_GRID} px-3 py-1.5 border-t bg-muted/30`}>
          <Input placeholder="Filter user..." value={userFilter} onChange={(e) => setUserFilter(e.target.value)} className="h-7 text-xs" />
          <Input placeholder="Filter title..." value={titleFilter} onChange={(e) => setTitleFilter(e.target.value)} className="h-7 text-xs" />
          <Input placeholder="Min" value={msgFilter} onChange={(e) => setMsgFilter(e.target.value)} className="h-7 text-xs text-right" />
          <div />
          <div />
        </div>
      </div>

      {/* Scrollable rows */}
      <div className="flex-1 overflow-auto px-6">
        {filteredAndSorted.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            {search
              ? `No chats found for "${search}"`
              : hasColumnFilters
              ? "No chats match filters"
              : "No chats found"}
          </div>
        ) : (
          <div className="py-1">
            {filteredAndSorted.map((chat, index) => (
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
              router.push(`/?${params.toString()}`);
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
