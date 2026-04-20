export function buildTemporalWorkflowUrl(
  workflowId: string | null | undefined,
  runId: string | null | undefined,
): string | null {
  const base = process.env.TEMPORAL_UI_URL;
  if (!base || !workflowId) return null;
  const ns = process.env.TEMPORAL_NAMESPACE || "default";
  const runSegment = runId ? `/${runId}` : "";
  return `${base}/namespaces/${ns}/workflows/${workflowId}${runSegment}/timeline`;
}

export function openTemporalWorkflow(
  workflowId: string | null | undefined,
  runId: string | null | undefined,
): boolean {
  const url = buildTemporalWorkflowUrl(workflowId, runId);
  if (!url) return false;
  window.open(url, "_blank");
  return true;
}
