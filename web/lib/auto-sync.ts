import { exec } from "child_process";

let intervalId: ReturnType<typeof setInterval> | null = null;
let enabled = false;
let lastRun: Date | null = null;
let lastResult: "success" | "error" | null = null;
let nextRun: Date | null = null;

const SYNC_COMMAND = "cd /mnt/observer_app && uv run python main.py --skip-migrations";
const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function runSync() {
  console.log("[auto-sync] Starting sync...");
  exec(SYNC_COMMAND, { timeout: 120000 }, (error, stdout, stderr) => {
    lastRun = new Date();
    if (error) {
      console.error("[auto-sync] Failed:", stderr);
      lastResult = "error";
    } else {
      console.log("[auto-sync] Success:", stdout.split("\n").filter(Boolean).slice(-3).join("; "));
      lastResult = "success";
    }
  });
}

export function startAutoSync() {
  if (intervalId) return;
  enabled = true;
  runSync();
  nextRun = new Date(Date.now() + INTERVAL_MS);
  intervalId = setInterval(() => {
    runSync();
    nextRun = new Date(Date.now() + INTERVAL_MS);
  }, INTERVAL_MS);
  console.log("[auto-sync] Enabled (every 60 min)");
}

export function stopAutoSync() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  enabled = false;
  nextRun = null;
  console.log("[auto-sync] Disabled");
}

export function getAutoSyncStatus() {
  return {
    enabled,
    lastRun: lastRun?.toISOString() ?? null,
    lastResult,
    nextRun: nextRun?.toISOString() ?? null,
  };
}
