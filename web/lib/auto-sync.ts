import { exec } from "child_process";
import { resolve as resolvePath } from "path";
import { getSetting, setSetting, getLastSyncRun } from "@/lib/queries/settings";

let intervalId: ReturnType<typeof setInterval> | null = null;
let enabled = false;
let lastResult: "success" | "error" | null = null;
let lastRunStartedAt: string | null = null;
let lastRunFinishedAt: string | null = null;
let running = false;
let initialized = false;
let timerStartedAt: number | null = null;

const PROJECT_ROOT = resolvePath(process.cwd(), "..");
const SYNC_COMMAND = `cd "${PROJECT_ROOT}" && uv run python main.py --skip-migrations`;
const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

function runSync() {
  console.log("[auto-sync] Starting sync...");
  running = true;
  lastRunStartedAt = new Date().toISOString();
  exec(SYNC_COMMAND, { timeout: 120000 }, (error, stdout, stderr) => {
    running = false;
    lastRunFinishedAt = new Date().toISOString();
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
  timerStartedAt = Date.now();
  intervalId = setInterval(() => {
    timerStartedAt = Date.now();
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
  timerStartedAt = null;
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
  const nextRun = enabled && timerStartedAt
    ? new Date(timerStartedAt + INTERVAL_MS).toISOString()
    : null;
  return {
    enabled,
    lastRun,
    lastResult,
    nextRun,
    running,
    lastRunStartedAt,
    lastRunFinishedAt,
  };
}
