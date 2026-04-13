"use client";

import { useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import { toggleAutoSync, fetchAutoSyncStatus } from "./actions";

export function AutoSyncToggle() {
  const [enabled, setEnabled] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [nextRun, setNextRun] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAutoSyncStatus().then((s) => {
      setEnabled(s.enabled);
      setLastRun(s.lastRun);
      setLastResult(s.lastResult);
      setNextRun(s.nextRun);
      setLoading(false);
    });
  }, []);

  async function handleToggle() {
    setLoading(true);
    const status = await toggleAutoSync();
    setEnabled(status.enabled);
    setLastRun(status.lastRun);
    setLastResult(status.lastResult);
    setNextRun(status.nextRun);
    setLoading(false);
  }

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
    if (diff <= 0) return "now";
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `in ${mins}m`;
    const hours = Math.floor(mins / 60);
    const remainMins = mins % 60;
    return `in ${hours}h ${remainMins}m`;
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">Auto Sync</p>
          <p className="text-sm text-muted-foreground">
            {enabled ? "Running every 15 min" : "Disabled"}
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={loading}
        />
      </div>
      {(lastRun || nextRun) && (
        <div className="mt-3 pt-3 border-t grid grid-cols-2 gap-3 text-sm">
          {lastRun && (
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Last Run</p>
              <p className="font-mono mt-0.5" suppressHydrationWarning>
                {timeAgo(lastRun)}
                <span className="ml-1.5">
                  {lastResult === "success" ? "✓" : lastResult === "error" ? "✗" : ""}
                </span>
              </p>
              <p className="text-xs text-muted-foreground" suppressHydrationWarning>
                {new Date(lastRun).toLocaleString()}
              </p>
            </div>
          )}
          {nextRun && enabled && (
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Next Run</p>
              <p className="font-mono mt-0.5" suppressHydrationWarning>{timeUntil(nextRun)}</p>
              <p className="text-xs text-muted-foreground" suppressHydrationWarning>
                {new Date(nextRun).toLocaleString()}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
