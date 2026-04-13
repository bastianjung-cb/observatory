import { exec } from "child_process";
import { resolve as resolvePath } from "path";
import { getSetting, setSetting, getLastSyncRun } from "@/lib/queries/settings";

let intervalId: ReturnType<typeof setInterval> | null = null;
let enabled = false;
let lastResult: "success" | "error" | null = null;
let initialized = false;

const PROJECT_ROOT = resolvePath(process.cwd(), "..");
const SYNC_COMMAND = `cd "${PROJECT_ROOT}" && uv run python main.py --skip-migrations`;
const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

function runSync() {
  console.log("[auto-sync] Starting sync...");
  exec(SYNC_COMMAND, { timeout: 120000 }, (error, stdout, stderr) => {
    if (error) {
      console.error("[auto-sync] Failed:", stderr);
      lastResult = "error";
    } else {
      console.log("[auto-sync] Success:", stdout.split("\n").filter(Boolean).slice(-3).join("; "));
      lastResult = "success";
    }
  });
}

function startTimer() {
  if (intervalId) return;
  enabled = true;
  runSync();
  intervalId = setInterval(() => {
    runSync();
  }, INTERVAL_MS);
  console.log("[auto-sync] Enabled (every 15 min)");
}

function stopTimer() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  enabled = false;
  console.log("[auto-sync] Disabled");
}

export async function initAutoSync() {
  if (initialized) return;
  initialized = true;
  const value = await getSetting("auto_sync_enabled");
  if (value === "true") {
    startTimer();
  }
}

export async function startAutoSync() {
  startTimer();
  await setSetting("auto_sync_enabled", "true");
}

export async function stopAutoSync() {
  stopTimer();
  await setSetting("auto_sync_enabled", "false");
}

export async function getAutoSyncStatus() {
  const lastRun = await getLastSyncRun();
  const nextRun = enabled && lastRun
    ? new Date(new Date(lastRun).getTime() + INTERVAL_MS).toISOString()
    : null;
  return {
    enabled,
    lastRun,
    lastResult,
    nextRun,
  };
}
