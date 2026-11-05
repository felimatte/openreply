import type { Automation, Prisma } from "@/app/generated/prisma/client";
import { createDefaultFlow } from "@/lib/flows/definition";
import type { MusaFlowSource } from "@/lib/integrations/musa/flow-bundle";

export function flowSource(id: string, targets: string[] = [], changes: Partial<Automation> = {}): MusaFlowSource {
  const graph = createDefaultFlow();
  if (targets.length) {
    const end = graph.nodes.find(node => node.type === "end")!;
    graph.edges.find(edge => edge.target === end.id)!.target = "call_0";
    targets.forEach((target, index) => {
      const nodeId = `call_${index}`;
      graph.nodes.push({ id: nodeId, type: "action", label: "Iniciar flujo", position: { x: 400 + index * 100, y: 100 },
        data: { action: "start_flow", automationId: target } });
      graph.edges.push({ id: `${nodeId}_next`, source: nodeId, sourceHandle: "next", target: index === targets.length - 1 ? end.id : `call_${index + 1}` });
      graph.edges.push({ id: `${nodeId}_error`, source: nodeId, sourceHandle: "error", target: end.id });
    });
  }
  return { id: `version-${id}`, automationId: id, workspaceId: "workspace-a", version: 1,
    definition: graph as unknown as Prisma.JsonValue, createdAt: new Date(0), publishedAt: new Date(0),
    automation: { id, workspaceId: "workspace-a", instagramAccountId: "account-a", name: id, keywords: ["GUIA"],
      flowPublishedVersionId: `version-${id}`, isActive: false, flowEnabled: false, ...changes } as Automation };
}
