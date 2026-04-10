"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { runSync } from "@/app/actions";

export function SyncButton() {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  async function handleSync() {
    setSyncing(true);
    setResult(null);
    if (timerRef.current) clearTimeout(timerRef.current);
    try {
      const res = await runSync();
      setResult(res);
      timerRef.current = setTimeout(() => setResult(null), 3000);
    } catch {
      setResult({ success: false, message: "Sync request failed" });
      timerRef.current = setTimeout(() => setResult(null), 5000);
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
