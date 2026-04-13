"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { runSync } from "@/app/actions";

export function SyncButton() {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<"success" | "error" | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (!syncing) handleSync();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  async function handleSync() {
    setSyncing(true);
    setResult(null);
    if (timerRef.current) clearTimeout(timerRef.current);
    try {
      const res = await runSync();
      setResult(res.success ? "success" : "error");
      timerRef.current = setTimeout(() => setResult(null), 3000);
    } catch {
      setResult("error");
      timerRef.current = setTimeout(() => setResult(null), 5000);
    } finally {
      setSyncing(false);
    }
  }

  const label = syncing
    ? "Syncing..."
    : result === "success"
    ? "✓ Synced"
    : result === "error"
    ? "✗ Failed"
    : "Sync Now";

  const variant = result === "success"
    ? "default"
    : result === "error"
    ? "destructive"
    : "outline";

  return (
    <Button
      variant={variant as "default" | "destructive" | "outline"}
      size="sm"
      onClick={handleSync}
      disabled={syncing}
      className={result === "success" ? "bg-green-600 hover:bg-green-600 text-white" : ""}
    >
      {label}
    </Button>
  );
}
