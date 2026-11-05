import type { Automation, FlowVersion } from "@/app/generated/prisma/client";
import { flowDefinitionSchema, validateFlowDefinition, type FlowDefinition } from "@/lib/flows/definition";

export type MusaFlowSource = FlowVersion & { automation: Automation };
export const MAX_MUSA_FLOW_DEPTH = 5;
export const MAX_MUSA_FLOW_BUNDLE = 25;
export function sourceGraph(source: MusaFlowSource): FlowDefinition | null {
  const parsed = flowDefinitionSchema.safeParse(source.definition);
  return parsed.success && validateFlowDefinition(parsed.data).valid ? parsed.data : null;
}
export function subflowIds(graph: FlowDefinition): string[] {
  return [...new Set(graph.nodes.flatMap(node => node.type === "action" && node.data.action === "start_flow" && node.data.automationId
    ? [node.data.automationId] : []))];
}

/** Shared dependencies are copied once; every path still obeys the engine's depth. */
export function resolveMusaFlowBundle(root: MusaFlowSource, available: ReadonlyMap<string, MusaFlowSource>) {
  const bundle = new Map<string, MusaFlowSource>();
  const heights = new Map<string, number>();
  const visiting = new Set<string>();
  let reason: string | null = null;
  function height(source: MusaFlowSource): number {
    if (reason) return 0;
    const id = source.automation.id;
    if (visiting.has(id)) { reason = "FLOW_CHAIN_CYCLE"; return 0; }
    if (heights.has(id)) return heights.get(id)!;
    if (source.automation.flowPublishedVersionId !== source.id) { reason = "FLOW_VERSION_CHANGED"; return 0; }
    const graph = sourceGraph(source);
    if (!graph) { reason = "FLOW_INVALID"; return 0; }
    bundle.set(id, source);
    if (bundle.size > MAX_MUSA_FLOW_BUNDLE) { reason = "FLOW_CHAIN_SIZE_LIMIT"; return 0; }
    visiting.add(id);
    let longest = 0;
    for (const targetId of subflowIds(graph)) {
      const target = available.get(targetId);
      if (!target) { reason = "FLOW_DEPENDENCY_CHANGED"; return 0; }
      longest = Math.max(longest, 1 + height(target));
    }
    visiting.delete(id); heights.set(id, longest);
    return longest;
  }
  if (!root.automation.matchAnyWord && !root.automation.keywords.some(keyword => keyword.trim())) reason = "FLOW_TRIGGER_REQUIRED";
  if (height(root) > MAX_MUSA_FLOW_DEPTH && !reason) reason = "FLOW_CHAIN_DEPTH_LIMIT";
  return { sources: [...bundle.values()], reason };
}
