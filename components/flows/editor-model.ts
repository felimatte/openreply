import type { FlowDefinition } from "@/lib/flows/definition";
import { createNode, ports, uid, type BuilderNode, type NodeKind } from "./model";

export type InsertionPoint = { source: string; handle: string };

export function findOpeningNodes(definition: FlowDefinition): Set<string> {
  const result = new Set<string>(), visited = new Set<string>(), pending = [definition.entryNodeId];
  while (pending.length) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = definition.nodes.find((item) => item.id === id);
    if (!node) continue;
    if (node.type === "message") { result.add(id); continue; }
    if (node.type === "input") continue;
    pending.push(...definition.edges.filter((edge) => edge.source === id).map((edge) => edge.target));
  }
  return result;
}

export function primaryPort(node: BuilderNode) {
  const outputs = ports(node);
  return outputs.find((port) => port.id === "next" || port.id === "answered") || outputs[0];
}

// Follow the main continuation first, then list the other branches. Never
// assume array order is execution order; imports can contain cycles or islands.
export function orderedNodes(flow: FlowDefinition) {
  const ordered: BuilderNode[] = [];
  const seen = new Set<string>();
  const byId = new Map(flow.nodes.map((node) => [node.id, node]));
  function visit(id: string) {
    const node = byId.get(id);
    if (!node || seen.has(id)) return;
    seen.add(id); ordered.push(node);
    const primary = primaryPort(node)?.id;
    const edges = flow.edges.filter((edge) => edge.source === id);
    edges.sort((a, b) => Number(b.sourceHandle === primary) - Number(a.sourceHandle === primary));
    for (const edge of edges) visit(edge.target);
  }
  visit(flow.entryNodeId);
  const connected = new Set(seen);
  for (const node of flow.nodes) visit(node.id);
  return { nodes: ordered, connected };
}

export function insertNode(flow: FlowDefinition, type: NodeKind, at?: InsertionPoint, position?: { x: number; y: number }) {
  const source = flow.nodes.find((node) => node.id === at?.source);
  const validPoint = source && at && ports(source).some((port) => port.id === at.handle) ? at : undefined;
  const existing = validPoint && flow.edges.find((edge) => edge.source === validPoint.source && edge.sourceHandle === validPoint.handle);
  const node = createNode(type, position || { x: (source?.position.x ?? 80) + 340, y: source?.position.y ?? 120 });
  // A newly added message works as written text, including when it is the opening DM.
  if (node.type === "message") node.data = { blocks: [{ type: "text", text: "¡Hola, {{username}}! ¿En qué puedo ayudarte?" }], buttons: [] };
  const edges = flow.edges.filter((edge) => !existing || edge.id !== existing.id);
  if (validPoint) edges.push({ id: uid("edge"), source: validPoint.source, sourceHandle: validPoint.handle, target: node.id });
  // Only the main continuation inherits the old destination. Additional branches
  // remain explicit decisions for the author, never silently rerouted.
  const continuation = primaryPort(node);
  if (existing && continuation) edges.push({ id: uid("edge"), source: node.id, sourceHandle: continuation.id, target: existing.target });
  const nodes = flow.nodes.map((current) => !position && source && current.position.x > source.position.x && Math.abs(current.position.y - source.position.y) < 230 ? { ...current, position: { ...current.position, x: current.position.x + 340 } } : current);
  return { definition: { ...flow, nodes: [...nodes, node], edges }, node };
}

export function flowContent(flow: FlowDefinition) {
  // Moving the viewport is navigation, not an unsaved edit.
  return JSON.stringify({ schemaVersion: flow.schemaVersion, entryNodeId: flow.entryNodeId, nodes: flow.nodes, edges: flow.edges });
}
