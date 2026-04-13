import { getAllModelPricing, type ModelPricing } from "@/lib/queries/activities";
import { getSyncStatus, getEntityCounts } from "@/lib/queries/settings";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { saveModelPricing, removeModelPricing } from "./actions";
import { EscapeToHome } from "./escape-to-home";

export default async function SettingsPage() {
  let models: ModelPricing[];
  try {
    models = await getAllModelPricing();
  } catch {
    models = [];
  }

  let syncStatus, entityCounts;
  try {
    [syncStatus, entityCounts] = await Promise.all([
      getSyncStatus(),
      getEntityCounts(),
    ]);
  } catch {
    syncStatus = null;
    entityCounts = null;
  }

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  return (
    <div className="max-w-4xl">
      <EscapeToHome />
      <div className="mb-6">
        <h2 className="text-2xl font-bold">Settings</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Database status, sync history, and model pricing.
        </p>
      </div>

      {/* Database Status */}
      {entityCounts && (
        <div className="rounded-lg border p-6 mb-8">
          <h3 className="text-lg font-semibold mb-4">Database Status</h3>
          <div className="grid grid-cols-3 gap-4 mb-6">
            {[
              { label: "Users", count: entityCounts.users },
              { label: "Chats", count: entityCounts.chats },
              { label: "Messages", count: entityCounts.messages },
              { label: "Message Parts", count: entityCounts.message_parts },
              { label: "Workflows", count: entityCounts.workflows },
              { label: "Activities", count: entityCounts.activities },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">{item.label}</p>
                <p className="text-2xl font-bold font-mono mt-1">{item.count.toLocaleString()}</p>
              </div>
            ))}
          </div>

          {syncStatus && syncStatus.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2">Last Sync</h4>
              <div className="grid grid-cols-2 gap-2">
                {syncStatus.map((s) => (
                  <div key={s.entity} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                    <span className="font-medium capitalize">{s.entity.replace("_", " ")}</span>
                    <span className="text-muted-foreground" suppressHydrationWarning>
                      {timeAgo(s.last_sync_at)}
                      <span className="text-xs ml-1.5" suppressHydrationWarning>
                        ({new Date(s.last_sync_at).toLocaleString()})
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Model Pricing */}
      <h3 className="text-lg font-semibold mb-4">Model Pricing</h3>
      <p className="text-sm text-muted-foreground mb-4">Prices are per 1M tokens.</p>

      <div className="rounded-lg border overflow-hidden mb-8">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="font-semibold text-xs uppercase tracking-wider">Model ID</TableHead>
              <TableHead className="font-semibold text-xs uppercase tracking-wider text-right">Input $/1M</TableHead>
              <TableHead className="font-semibold text-xs uppercase tracking-wider text-right">Output $/1M</TableHead>
              <TableHead className="font-semibold text-xs uppercase tracking-wider text-right">Cache Read $/1M</TableHead>
              <TableHead className="font-semibold text-xs uppercase tracking-wider text-right">Reasoning $/1M</TableHead>
              <TableHead className="w-[80px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No model pricing configured
                </TableCell>
              </TableRow>
            ) : (
              models.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-mono text-sm font-medium">{m.model_id}</TableCell>
                  <TableCell className="text-right tabular-nums">${m.input_price}</TableCell>
                  <TableCell className="text-right tabular-nums">${m.output_price}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.cache_read_price ? `$${m.cache_read_price}` : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.reasoning_price ? `$${m.reasoning_price}` : "—"}</TableCell>
                  <TableCell>
                    <form action={removeModelPricing}>
                      <input type="hidden" name="id" value={m.id} />
                      <button
                        type="submit"
                        className="text-xs text-destructive hover:underline"
                      >
                        Delete
                      </button>
                    </form>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="rounded-lg border p-6">
        <h3 className="text-lg font-semibold mb-4">Add / Update Model Pricing</h3>
        <form action={saveModelPricing} className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="text-sm font-medium mb-1 block">Model ID</label>
            <input
              name="model_id"
              required
              placeholder="e.g. vertex:gemini-3.1-pro-preview"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Input Price (per 1M tokens)</label>
            <input
              name="input_price"
              type="number"
              step="0.01"
              required
              placeholder="2.00"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Output Price (per 1M tokens)</label>
            <input
              name="output_price"
              type="number"
              step="0.01"
              required
              placeholder="12.00"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Cache Read Price (optional)</label>
            <input
              name="cache_read_price"
              type="number"
              step="0.001"
              placeholder="0.50"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Reasoning Price (optional)</label>
            <input
              name="reasoning_price"
              type="number"
              step="0.01"
              placeholder="12.00"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="col-span-2">
            <button
              type="submit"
              className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
