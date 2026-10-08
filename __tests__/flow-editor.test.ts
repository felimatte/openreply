import { describe, expect, it } from "vitest";
import { createNode, createTemplate } from "@/components/flows/model";
import { findOpeningNodes, flowContent, insertNode, orderedNodes } from "@/components/flows/editor-model";
import { validateFlowDefinition } from "@/lib/flows/definition";
import { respondSimulation, startSimulation } from "@/lib/flows/simulator";

describe("guided flow editing", () => {
  it("only marks messages before the first answer as the opening", () => {
    const flow = createTemplate("lead");
    const opening = flow.nodes.find((node) => node.type === "message")!;
    const delivery = flow.nodes.find((node) => node.type === "message" && node.id !== opening.id)!;
    expect(findOpeningNodes(flow)).toEqual(new Set([opening.id]));
    const input = flow.nodes.find((node) => node.type === "input")!;
    flow.edges = flow.edges.filter((edge) => edge.source !== flow.entryNodeId);
    flow.edges.push({ id: "direct_question", source: flow.entryNodeId, sourceHandle: "next", target: input.id });
    expect(findOpeningNodes(flow).has(delivery.id)).toBe(false);
  });

  it("inserts a message without losing the existing destination or changing the original graph", () => {
    const flow = createTemplate("lead");
    const before = structuredClone(flow);
    const opening = flow.nodes.find((node) => node.type === "message")!;
    const oldDestination = flow.edges.find((edge) => edge.source === opening.id)!.target;
    const result = insertNode(flow, "message", { source: opening.id, handle: "next" });
    expect(flow).toEqual(before);
    expect(result.definition.edges.find((edge) => edge.source === opening.id)?.target).toBe(result.node.id);
    expect(result.definition.edges.find((edge) => edge.source === result.node.id)?.target).toBe(oldDestination);
    expect(validateFlowDefinition(result.definition).valid).toBe(true);
    const simulation = respondSimulation(result.definition, startSimulation(result.definition), { text: "SI" });
    expect(simulation.waiting).toBe("input");
    expect(simulation.events.some((event) => event.nodeId === result.node.id)).toBe(true);
  });

  it("inserts on one branch while preserving the other input routes", () => {
    const flow = createTemplate("lead");
    const input = flow.nodes.find((node) => node.type === "input")!;
    const unchanged = flow.edges.filter((edge) => edge.source === input.id && edge.sourceHandle !== "skip");
    const result = insertNode(flow, "delay", { source: input.id, handle: "skip" });
    expect(result.definition.edges.filter((edge) => edge.source === input.id && edge.sourceHandle !== "skip")).toEqual(unchanged);
    expect(result.definition.edges.find((edge) => edge.source === input.id && edge.sourceHandle === "skip")?.target).toBe(result.node.id);
  });

  it("leaves newly created decision branches for the author to configure", () => {
    const flow = createTemplate("resource");
    const result = insertNode(flow, "condition", { source: flow.entryNodeId, handle: "next" });
    expect(result.definition.edges.filter((edge) => edge.source === result.node.id).map((edge) => edge.sourceHandle)).toEqual(["yes"]);
    expect(validateFlowDefinition(result.definition).issues.some((issue) => issue.nodeId === result.node.id)).toBe(true);
  });

  it("orders imports from the entry point and remains safe for cycles and disconnected steps", () => {
    const flow = createTemplate("lead");
    const island = createNode("delay");
    flow.nodes = [island, ...flow.nodes.reverse()];
    const action = flow.nodes.find((node) => node.type === "action")!;
    flow.edges.push({ id: "cycle", source: action.id, sourceHandle: "error", target: action.id });
    const result = orderedNodes(flow);
    expect(result.nodes[0].id).toBe(flow.entryNodeId);
    expect(result.nodes[1].type).toBe("message");
    expect(new Set(result.nodes.map((node) => node.id)).size).toBe(flow.nodes.length);
    expect(result.connected.has(island.id)).toBe(false);
    expect(result.nodes.at(-1)?.id).toBe(island.id);
  });

  it("does not mark viewport navigation as a content edit", () => {
    const flow = createTemplate("resource");
    expect(flowContent({ ...flow, viewport: { x: 500, y: -100, zoom: 1.2 } })).toBe(flowContent(flow));
    const changed = structuredClone(flow);
    changed.nodes[0].label = "Nuevo nombre";
    expect(flowContent(changed)).not.toBe(flowContent(flow));
  });

  it("ignores an invalid insertion port instead of removing existing connections", () => {
    const flow = createTemplate("resource");
    const result = insertNode(flow, "message", { source: flow.entryNodeId, handle: "invalid" });
    expect(result.definition.edges).toEqual(flow.edges);
    expect(result.definition.nodes).toHaveLength(flow.nodes.length + 1);
  });
});
