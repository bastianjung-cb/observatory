import { notFound } from "next/navigation";
import { getColumnCreation, getColumnCreationCostSummary } from "@/lib/queries/column-creations";
import { getWorkflow, getActivities, getChildWorkflows, getChildWorkflowsWithDetails, getWorkflowBreadcrumbs } from "@/lib/queries/activities";
import { ActivitySteps } from "@/components/activity-steps";
import { Badge } from "@/components/ui/badge";
import { KeyboardHints } from "@/components/keyboard-hints";

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export default async function ColumnCreationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>;
  searchParams: Promise<{ wf?: string }>;
}) {
  const { batchId } = await params;
  const sp = await searchParams;
  const detail = await getColumnCreation(batchId);

  if (!detail) {
    notFound();
  }

  const metadata = detail.metadata as Record<string, unknown> | null;

  let workflow;
  if (sp.wf) {
    workflow = await getWorkflow(sp.wf);
  } else {
    workflow = await getWorkflow(detail.workflow_id);
  }

  if (!workflow) {
    return (
      <div>
        <h2 className="text-2xl font-bold mb-2">{(metadata?.columnName as string) || "Column Creation"}</h2>
        <p className="text-muted-foreground">No workflow found for this batch.</p>
      </div>
    );
  }

  const activities = await getActivities(workflow.workflow_id);
  const childWorkflows = await getChildWorkflowsWithDetails(workflow.workflow_id);
  const breadcrumbs = await getWorkflowBreadcrumbs(workflow.workflow_id);
  const costSummary = await getColumnCreationCostSummary(detail.workflow_id);

  return (
    <div className="flex flex-col -mx-6 -mt-6 -mb-6" style={{ height: "calc(100vh - 90px)" }}>
      {/* Fixed header */}
      <div className="shrink-0 bg-background border-b px-6 py-3">
        <h2 className="text-lg font-bold">
          {(metadata?.columnName as string) || "Unnamed Column"}
        </h2>
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{(metadata?.variant as string) || "text"}</Badge>
            <span>{(metadata?.completedRows as number) || 0}/{(metadata?.totalRows as number) || 0} rows</span>
            <span>&middot;</span>
            <Badge variant="outline">{workflow.status}</Badge>
            <span>{activities.length} activities</span>
            {childWorkflows.length > 0 && (
              <>
                <span>&middot;</span>
                <span>{childWorkflows.length} child workflow{childWorkflows.length !== 1 ? "s" : ""}</span>
              </>
            )}
          </div>
          {(costSummary.total_input_tokens > 0 || costSummary.total_output_tokens > 0) && (
            <div className="text-right">
              <div className="text-lg font-mono font-semibold text-foreground">
                ${Number(costSummary.total_cost_usd).toFixed(4)}
              </div>
              <div className="text-xs font-mono text-muted-foreground">
                {formatTokens(costSummary.total_input_tokens)} ↑ / {formatTokens(costSummary.total_output_tokens)} ↓
              </div>
            </div>
          )}
        </div>

        {/* Breadcrumbs */}
        {breadcrumbs.length > 1 && (
          <nav className="flex items-center gap-1 mt-2 text-xs">
            {breadcrumbs.map((crumb, i) => {
              const isLast = i === breadcrumbs.length - 1;
              const href = i === 0
                ? `/column-creations/${batchId}`
                : `/column-creations/${batchId}?wf=${crumb.workflow_id}`;
              return (
                <span key={crumb.workflow_id} className="flex items-center gap-1">
                  {i > 0 && <span className="text-muted-foreground/50">›</span>}
                  {isLast ? (
                    <span className="font-medium text-foreground">{crumb.label}</span>
                  ) : (
                    <a href={href} className="text-blue-600 hover:underline">
                      {crumb.label}
                    </a>
                  )}
                </span>
              );
            })}
          </nav>
        )}

        <KeyboardHints shortcuts={[
          { key: "↑↓", action: "Navigate" },
          { key: "→", action: "JSON view / Child workflow" },
          { key: "←", action: "Back" },
          { key: "Space", action: "Prompt view (invokeModel) / JSON" },
          { key: "F", action: "Edit filter" },
          { key: "T", action: "Bypass filter" },
          { key: "I", action: "invokeModel only" },
          { key: "R", action: "Reverse order" },
          { key: "W", action: "Temporal UI" },
        ]} />
      </div>

      {/* Scrollable activities */}
      <div className="flex-1 overflow-auto px-6 py-3">
        <ActivitySteps
          activities={activities}
          childWorkflows={childWorkflows}
          basePath={`/column-creations/${batchId}`}
          backPath="/column-creations"
          parentWorkflowId={workflow.parent_workflow_id ?? undefined}
          currentWorkflowId={workflow.workflow_id}
          currentRunId={workflow.run_id}
        />
      </div>
    </div>
  );
}
