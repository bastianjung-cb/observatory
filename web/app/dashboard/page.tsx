import { getDailyCosts, getUserCosts, getCostSummary } from "@/lib/queries/dashboard";
import { DashboardCharts } from "./charts";
import { KeyboardHints } from "@/components/keyboard-hints";

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatCost(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

export default async function DashboardPage() {
  let dailyCosts, userCosts, summary;
  try {
    [dailyCosts, userCosts, summary] = await Promise.all([
      getDailyCosts(56),
      getUserCosts(4, 20),
      getCostSummary(4),
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

  return (
    <div className="flex flex-col -mx-6 -mt-6 -mb-6" style={{ height: "calc(100vh - 90px)" }}>
      <div className="shrink-0 bg-background border-b px-6 py-3">
        <h2 className="text-lg font-bold">Usage Dashboard</h2>
        <p className="text-sm text-muted-foreground">Cost and token usage overview</p>
        <KeyboardHints shortcuts={[{ key: "←", action: "Back to chats" }]} />
      </div>

      <div className="flex-1 overflow-auto px-6 py-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          <div className="rounded-xl border bg-card p-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Total Cost (4 weeks)</p>
            <p className="text-3xl font-bold font-mono text-[#6B2C91] dark:text-white">{formatCost(summary.total_cost_4w)}</p>
          </div>
          <div className="rounded-xl border bg-card p-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Total Tokens (4 weeks)</p>
            <p className="text-3xl font-bold font-mono">{formatTokens(summary.total_tokens_4w)}</p>
          </div>
          <div className="rounded-xl border bg-card p-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">LLM Calls (4 weeks)</p>
            <p className="text-3xl font-bold font-mono">{summary.total_llm_calls_4w.toLocaleString()}</p>
          </div>
          <div className="rounded-xl border bg-card p-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Chats (4 weeks)</p>
            <p className="text-3xl font-bold font-mono">{summary.total_chats.toLocaleString()}</p>
          </div>
        </div>

        {/* Charts - client component */}
        <DashboardCharts dailyCosts={dailyCosts} userCosts={userCosts} />
      </div>
    </div>
  );
}
