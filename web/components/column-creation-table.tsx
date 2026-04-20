"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { useKeyboardNav } from "@/components/use-keyboard-nav";
import { openTemporalWorkflow } from "@/lib/temporal-url";

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

function formatCost(cost: number | string | null): string {
  const n = Number(cost);
  if (!n || isNaN(n) || n === 0) return "\u2014";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

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

type SortKey = "column_name" | "variant" | "rows" | "status" | "cost" | "user" | "date";
type SortDir = "asc" | "desc";

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span className={`ml-1 inline-block ${active ? "text-foreground" : "text-muted-foreground/40"}`}>
      {!active ? "\u2195" : dir === "asc" ? "\u2191" : "\u2193"}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colorClass =
    status === "COMPLETED"
      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
      : status === "FAILED"
      ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
      : status === "RUNNING"
      ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
      : "bg-muted text-muted-foreground";

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}>
      {status}
    </span>
  );
}

const COL_GRID = "grid grid-cols-[160px_240px_1fr_80px_100px_90px_80px_80px_120px] gap-2 items-center";

export function ColumnCreationTable({
  rows,
  search,
  columnFilter,
  userFilter,
  statusFilter,
  total,
  page,
  pageSize,
  sortKey: currentSortKey,
  sortDir: currentSortDir,
}: {
  rows: ColumnCreation[];
  search: string;
  columnFilter: string;
  userFilter: string;
  statusFilter: string;
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
      params.set("dir", key === "rows" || key === "cost" ? "desc" : "asc");
    }
    params.delete("page");
    router.push(`/column-creations?${params.toString()}`);
  }

  const { selectedIndex } = useKeyboardNav({
    itemCount: rows.length,
    storageKey: "column-creations",
    onEnter: (index) => {
      if (rows[index]) {
        router.push(`/column-creations/${rows[index].batch_id}`);
      }
    },
  });

  const selectedRowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = selectedRowRef.current?.closest("[class*='overflow-auto']");
    if (selectedIndex === 0) {
      container?.scrollTo(0, 0);
    } else if (selectedIndex === rows.length - 1) {
      container?.scrollTo(0, container.scrollHeight);
    } else {
      selectedRowRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, rows.length]);

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

  function pushParam(field: string, value: string) {
    const current = typeof window !== "undefined" ? window.location.search : `?${searchParams.toString()}`;
    const params = new URLSearchParams(current);
    if (value) params.set(field, value);
    else params.delete(field);
    params.delete("page");
    router.push(`/column-creations?${params.toString()}`);
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
  const hasAnyFilter = !!(search || columnFilter || userFilter || statusFilter);

  return (
    <div className="flex flex-col -mx-6 -mt-6 -mb-6" style={{ height: "calc(100vh - 90px)" }}>
      {/* Fixed top: search + headers + filters */}
      <div className="shrink-0 bg-background border-b px-6">
        {/* Search */}
        <div className="flex items-center gap-4 py-3">
          <Input
            placeholder="Search by column name, prompt, or user..."
            defaultValue={search}
            key={`q-${search}`}
            onChange={(e) => handleSearch(e.target.value)}
            className="max-w-sm"
          />
          <span className="text-sm text-muted-foreground">
            {total} column creation{total !== 1 ? "s" : ""}
            {hasAnyFilter ? " (filtered)" : ""}
          </span>
        </div>

        {/* Column headers */}
        <div className={`${COL_GRID} px-3 py-2 border-t bg-muted/50`}>
          <button className="flex items-center gap-1 font-semibold text-xs uppercase tracking-wider hover:text-foreground transition-colors" onClick={() => toggleSort("user")}>
            User <SortIcon active={currentSortKey === "user"} dir={currentSortDir} />
          </button>
          <button className="flex items-center gap-1 font-semibold text-xs uppercase tracking-wider hover:text-foreground transition-colors" onClick={() => toggleSort("column_name")}>
            Column <SortIcon active={currentSortKey === "column_name"} dir={currentSortDir} />
          </button>
          <div className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">
            Prompt
          </div>
          <button className="flex items-center gap-1 font-semibold text-xs uppercase tracking-wider hover:text-foreground transition-colors" onClick={() => toggleSort("variant")}>
            Variant <SortIcon active={currentSortKey === "variant"} dir={currentSortDir} />
          </button>
          <button className="flex items-center gap-1 font-semibold text-xs uppercase tracking-wider hover:text-foreground transition-colors justify-end" onClick={() => toggleSort("rows")}>
            Rows <SortIcon active={currentSortKey === "rows"} dir={currentSortDir} />
          </button>
          <button className="flex items-center gap-1 font-semibold text-xs uppercase tracking-wider hover:text-foreground transition-colors" onClick={() => toggleSort("status")}>
            Status <SortIcon active={currentSortKey === "status"} dir={currentSortDir} />
          </button>
          <button className="flex items-center gap-1 font-semibold text-xs uppercase tracking-wider hover:text-foreground transition-colors justify-end" onClick={() => toggleSort("cost")}>
            Cost <SortIcon active={currentSortKey === "cost"} dir={currentSortDir} />
          </button>
          <div className="font-semibold text-xs uppercase tracking-wider text-muted-foreground text-right">$/row</div>
          <button className="flex items-center gap-1 font-semibold text-xs uppercase tracking-wider hover:text-foreground transition-colors" onClick={() => toggleSort("date")}>
            Date <SortIcon active={currentSortKey === "date"} dir={currentSortDir} />
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
            placeholder="Filter column..."
            defaultValue={columnFilter}
            key={`fc-${columnFilter}`}
            onChange={(e) => handleFilter("fc", e.target.value)}
            className="h-7 text-xs"
          />
          <div />
          <div />
          <div />
          <Input
            placeholder="Filter..."
            defaultValue={statusFilter}
            key={`fs-${statusFilter}`}
            onChange={(e) => handleFilter("fs", e.target.value)}
            className="h-7 text-xs"
          />
          <div />
          <div />
          <div />
        </div>
      </div>

      {/* Scrollable rows */}
      <div className="flex-1 overflow-auto px-6">
        {rows.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            {hasAnyFilter ? "No column creations match filters" : "No column creations found"}
          </div>
        ) : (
          <div className="py-1">
            {rows.map((row, index) => (
              <div
                key={row.batch_id}
                ref={index === selectedIndex ? selectedRowRef : undefined}
                className={`${COL_GRID} px-3 py-2.5 rounded-md cursor-pointer transition-all duration-150 ${
                  index === selectedIndex ? "row-glow" : "hover:bg-accent/50"
                }`}
                onClick={() => router.push(`/column-creations/${row.batch_id}`)}
              >
                <div>
                  <div className="font-medium truncate">{row.user_name || "\u2014"}</div>
                  {row.user_email && (
                    <div className="text-xs text-muted-foreground truncate">{row.user_email}</div>
                  )}
                </div>
                <div className="font-bold truncate">{row.column_name || "Unnamed"}</div>
                <div className="text-muted-foreground truncate text-sm">{row.prompt || "\u2014"}</div>
                <div>
                  <span className="bg-muted px-2 py-0.5 text-xs font-medium rounded-full">
                    {row.variant || "\u2014"}
                  </span>
                </div>
                <div className="text-right tabular-nums font-mono text-sm">
                  {row.completed_rows}/{row.total_rows}
                  {row.failed_rows > 0 && (
                    <span className="text-red-500 ml-1 text-xs">({row.failed_rows} failed)</span>
                  )}
                </div>
                <div>
                  <StatusBadge status={row.status} />
                </div>
                <div className="text-right tabular-nums font-mono text-sm">{formatCost(row.total_cost_usd)}</div>
                <div className="text-right tabular-nums font-mono text-sm">
                  {row.total_rows > 0 ? formatCost(row.total_cost_usd / row.total_rows) : "\u2014"}
                </div>
                <div suppressHydrationWarning>
                  {row.created_at ? (() => {
                    const d = new Date(row.created_at);
                    return (
                      <div>
                        <div className="text-sm" suppressHydrationWarning>{timeAgo(d)}</div>
                        <div className="text-xs text-muted-foreground" suppressHydrationWarning>{d.toLocaleString()}</div>
                      </div>
                    );
                  })() : "\u2014"}
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
              router.push(`/column-creations?${params.toString()}`);
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
              router.push(`/column-creations?${params.toString()}`);
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
