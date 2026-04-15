import { getDailyCosts, getUserCosts, getCostSummary, getColGenSummary, getDailyColumnCreationVolume, getDailyColumnCreationCosts, getUserColumnCreationStats } from "@/lib/queries/dashboard";
import { DashboardCharts } from "./charts";
import { DateRangePicker } from "./date-range-picker";
import { KeyboardHints } from "@/components/keyboard-hints";

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatCost(n: number): string {
  if (!n || n === 0) return "$0";
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 56);
  return toLocalDateStr(d);
}

function defaultTo(): string {
  return toLocalDateStr(new Date());
}

function formatRangeLabel(from: string, to: string): string {
  const f = parseLocalDate(from);
  const t = parseLocalDate(to);
  return `${f.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${t.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const from = params.from || defaultFrom();
  const to = params.to || defaultTo();

  let dailyCosts, userCosts, summary, colGenSummary, colVolume, colCosts, colUserStats;
  try {
    [dailyCosts, userCosts, summary, colGenSummary, colVolume, colCosts, colUserStats] = await Promise.all([
      getDailyCosts(from, to),
      getUserCosts(from, to, 20),
      getCostSummary(from, to),
      getColGenSummary(from, to),
      getDailyColumnCreationVolume(from, to),
      getDailyColumnCreationCosts(from, to),
      getUserColumnCreationStats(from, to, 20),
    ]);
  } catch {
    return (
      <div className="flex flex-col -mx-6 -mt-6 -mb-6" style={{ height: "calc(100vh - 90px)" }}>
        <div className="shrink-0 bg-background border-b px-6 py-3">
          <h2 className="text-lg font-bold">Usage Dashboard</h2>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-lg font-medium mb-2">No data available</p>
            <p className="text-sm text-muted-foreground">Run a sync first to populate the database.</p>
          </div>
        </div>
      </div>
    );
  }

  const rangeLabel = formatRangeLabel(from, to);

  return (
    <div className="flex flex-col -mx-6 -mt-6 -mb-6" style={{ height: "calc(100vh - 90px)" }}>
      <div className="shrink-0 bg-background border-b px-6 py-3">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-lg font-bold">Usage Dashboard</h2>
            <p className="text-xs text-muted-foreground">{rangeLabel}</p>
          </div>
          <DateRangePicker from={from} to={to} />
        </div>
        <KeyboardHints shortcuts={[{ key: "←", action: "Back to chats" }]} />
      </div>

      <div className="flex-1 overflow-auto px-6 py-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-7 gap-4 mb-8">
          
          
          <div className="rounded-xl border bg-card p-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">LLM Calls</p>
            <p className="text-3xl font-bold font-mono">{(summary.total_llm_calls + colGenSummary.total_llm_calls).toLocaleString()}</p>
          </div>
          <div className="rounded-xl border bg-card p-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Chats</p>
            <p className="text-3xl font-bold font-mono">{summary.total_chats.toLocaleString()}</p>
          </div>

          <div className="rounded-xl border bg-card p-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Total Cost</p>
            <p className="text-3xl font-bold font-mono text-[#6B2C91] dark:text-white">{formatCost(summary.total_cost + colGenSummary.total_cost)}</p>
          </div>
          <div className="rounded-xl border bg-card p-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Chat Cost</p>
            <p className="text-3xl font-bold font-mono">{formatCost(summary.total_cost)}</p>
          </div>
          <div className="rounded-xl border bg-card p-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Col Creation Cost</p>
            <p className="text-3xl font-bold font-mono">{formatCost(colGenSummary.total_cost)}</p>
            </div>
          <div className="rounded-xl border bg-card p-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Columns Generated</p>
            <p className="text-3xl font-bold font-mono">{colGenSummary.total_columns.toLocaleString()}</p>
          </div>
          <div className="rounded-xl border bg-card p-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Cells Generated</p>
            <p className="text-3xl font-bold font-mono">{colGenSummary.total_cells.toLocaleString()}</p>
          </div>
        </div>

        {/* Charts */}
        <DashboardCharts
          dailyCosts={dailyCosts}
          userCosts={userCosts}
          columnCreationVolume={colVolume}
          columnCreationCosts={colCosts}
          columnCreationUserStats={colUserStats}
        />
      </div>
    </div>
  );
}
