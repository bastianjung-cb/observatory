import { getAllModelPricing, type ModelPricing } from "@/lib/queries/activities";
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

  return (
    <div className="max-w-4xl">
      <EscapeToHome />
      <div className="mb-6">
        <h2 className="text-2xl font-bold">Settings</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Manage model pricing for cost calculations. Prices are per 1M tokens.
        </p>
      </div>

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
