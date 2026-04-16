"use client";

import { useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import { toggleAutoSync, fetchAutoSyncStatus } from "./actions";

interface SyncStatus {
  enabled: boolean;
  lastRun: string | null;
  lastResult: string | null;
  nextRun: string | null;
  running: boolean;
  lastRunStartedAt: string | null;
  lastRunFinishedAt: string | null;
}

export function AutoSyncToggle() {
  const [status, setStatus] = useState<SyncStatus>({
    enabled: false, lastRun: null, lastResult: null, nextRun: null,
    running: false, lastRunStartedAt: null, lastRunFinishedAt: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const s = await fetchAutoSyncStatus();
      if (cancelled) return;
      setStatus(s);
      setLoading(false);
    }

    poll();
    const id = setInterval(poll, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  async function handleToggle() {
    setLoading(true);
    const s = await toggleAutoSync();
    setStatus(s);
    setLoading(false);
  }

  const { enabled, lastRun, lastResult, nextRun, running, lastRunStartedAt, lastRunFinishedAt } = status;

  function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    return `${hours}h ago`;
  }

  function timeUntil(iso: string): string {
    const diff = new Date(iso).getTime() - Date.now();
    if (diff <= 0) return "any moment";
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `in ${mins}m`;
    const hours = Math.floor(mins / 60);
    const remainMins = mins % 60;
    return `in ${hours}h ${remainMins}m`;
  }

  function statusBadge() {
    if (running) return <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/15 text-blue-500 px-2 py-0.5 text-xs font-medium"><span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />Syncing</span>;
    if (lastResult === "success") return <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 text-emerald-500 px-2 py-0.5 text-xs font-medium"><span className="h-1.5 w-1.5 rounded-full bg-current" />OK</span>;
    if (lastResult === "error") return <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 text-red-500 px-2 py-0.5 text-xs font-medium"><span className="h-1.5 w-1.5 rounded-full bg-current" />Failed</span>;
    return null;
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <p className="font-medium">Auto Sync</p>
            <p className="text-sm text-muted-foreground">
              {enabled ? "Running every 15 min" : "Disabled"}
            </p>
          </div>
          {enabled && statusBadge()}
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={loading}
        />
      </div>
      {enabled && (lastRun || nextRun || lastRunStartedAt) && (
        <div className="mt-3 pt-3 border-t grid grid-cols-3 gap-3 text-sm">
          {lastRun && (
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Last Sync (DB)</p>
              <p className="font-mono mt-0.5" suppressHydrationWarning>
                {timeAgo(lastRun)}
              </p>
              <p className="text-xs text-muted-foreground" suppressHydrationWarning>
                {new Date(lastRun).toLocaleString()}
              </p>
            </div>
          )}
          {lastRunFinishedAt && (
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Last Execution</p>
              <p className="font-mono mt-0.5" suppressHydrationWarning>
                {timeAgo(lastRunFinishedAt)}
                {lastResult === "success" ? " — success" : lastResult === "error" ? " — failed" : ""}
              </p>
              <p className="text-xs text-muted-foreground" suppressHydrationWarning>
                {new Date(lastRunFinishedAt).toLocaleString()}
              </p>
            </div>
          )}
          {!lastRunFinishedAt && running && lastRunStartedAt && (
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Current Run</p>
              <p className="font-mono mt-0.5" suppressHydrationWarning>
                started {timeAgo(lastRunStartedAt)}
              </p>
              <p className="text-xs text-muted-foreground" suppressHydrationWarning>
                {new Date(lastRunStartedAt).toLocaleString()}
              </p>
            </div>
          )}
          {nextRun && (
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Next Run</p>
              <p className="font-mono mt-0.5" suppressHydrationWarning>{running ? "after current" : timeUntil(nextRun)}</p>
              {!running && (
                <p className="text-xs text-muted-foreground" suppressHydrationWarning>
                  {new Date(nextRun).toLocaleString()}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
