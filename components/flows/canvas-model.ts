import type { FlowDefinition } from "@/lib/flows/definition";
import { ports } from "./model";

export function canConnectPort(flow: FlowDefinition, sourceId: string, handle: string, targetId: string): boolean {
  const source = flow.nodes.find((node) => node.id === sourceId);
  const target = flow.nodes.find((node) => node.id === targetId);
  return !!source && !!target && sourceId !== targetId && target.type !== "start" && ports(source).some((port) => port.id === handle);
}

export function connectPort(flow: FlowDefinition, sourceId: string, handle: string, targetId: string, edgeId: string): FlowDefinition {
  if (!canConnectPort(flow, sourceId, handle, targetId)) return flow;
  const existing = flow.edges.filter((edge) => edge.source === sourceId && edge.sourceHandle === handle);
  if (existing.length === 1 && existing[0].target === targetId) return flow;
  const edge = { id: existing[0]?.id || edgeId, source: sourceId, sourceHandle: handle, target: targetId };
  return { ...flow, edges: [...flow.edges.filter((item) => item.source !== sourceId || item.sourceHandle !== handle), edge] };
}

export function disconnectPort(flow: FlowDefinition, sourceId: string, handle: string): FlowDefinition {
  const edges = flow.edges.filter((edge) => edge.source !== sourceId || edge.sourceHandle !== handle);
  return edges.length === flow.edges.length ? flow : { ...flow, edges };
}
