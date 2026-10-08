import { describe, expect, it } from "vitest";
import { connectPort, disconnectPort } from "@/components/flows/canvas-model";
import { insertNode } from "@/components/flows/editor-model";
import { createTemplate } from "@/components/flows/model";
import { parseFlowDefinition } from "@/lib/flows/definition";

describe("free canvas connections", () => {
  it("reconnects one input branch without changing other branches or positions", () => {
    const flow = createTemplate("lead"), before = structuredClone(flow);
    const input = flow.nodes.find((node) => node.type === "input")!;
    const end = flow.nodes.find((node) => node.type === "end")!;
    const previous = flow.edges.find((edge) => edge.source === input.id && edge.sourceHandle === "skip")!;
    const result = connectPort(flow, input.id, "skip", end.id, "new_edge");
    expect(flow).toEqual(before);
    expect(result.nodes).toBe(flow.nodes);
    expect(result.edges.find((edge) => edge.id === previous.id)?.target).toBe(end.id);
    expect(result.edges.filter((edge) => edge.id !== previous.id)).toEqual(flow.edges.filter((edge) => edge.id !== previous.id));
    expect(parseFlowDefinition(result)).toEqual(result);
  });

  it("ignores invalid ports, missing nodes, self connections and connections to the start", () => {
    const flow = createTemplate("lead");
    const input = flow.nodes.find((node) => node.type === "input")!, end = flow.nodes.find((node) => node.type === "end")!;
    for (const [source, port, target] of [[input.id, "missing", end.id], [input.id, "skip", "missing"], ["missing", "next", end.id], [input.id, "skip", input.id], [input.id, "skip", flow.entryNodeId]]) expect(connectPort(flow, source, port, target, "edge")).toBe(flow);
  });

  it("deduplicates a reconnected output and avoids history entries for unchanged connections", () => {
    const flow = createTemplate("lead"), edge = flow.edges[0];
    expect(connectPort(flow, edge.source, edge.sourceHandle, edge.target, "unused")).toBe(flow);
    flow.edges.push({ ...edge, id: "duplicate" });
    const result = connectPort(flow, edge.source, edge.sourceHandle, edge.target, "unused");
    expect(result.edges.filter((item) => item.source === edge.source && item.sourceHandle === edge.sourceHandle)).toEqual([edge]);
  });

  it("deletes only the selected connection and preserves its boxes", () => {
    const flow = createTemplate("lead"), edge = flow.edges[2];
    const result = disconnectPort(flow, edge.source, edge.sourceHandle);
    expect(result.nodes).toBe(flow.nodes);
    expect(result.edges).toEqual(flow.edges.filter((item) => item.id !== edge.id));
    expect(disconnectPort(result, edge.source, edge.sourceHandle)).toBe(result);
  });

  it("inserts a dragged box at its drop position without moving existing boxes", () => {
    const flow = createTemplate("lead"), source = flow.nodes.find((node) => node.type === "input")!;
    const oldTarget = flow.edges.find((edge) => edge.source === source.id && edge.sourceHandle === "skip")!.target;
    const result = insertNode(flow, "delay", { source: source.id, handle: "skip" }, { x: -80, y: 510 });
    expect(result.definition.nodes.slice(0, -1)).toEqual(flow.nodes);
    expect(result.node.position).toEqual({ x: -80, y: 510 });
    expect(result.definition.edges.find((edge) => edge.source === result.node.id)?.target).toBe(oldTarget);
    expect(parseFlowDefinition(result.definition)).toEqual(result.definition);
  });
});
