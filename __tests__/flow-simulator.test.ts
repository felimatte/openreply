import { describe, expect, it } from "vitest";
import { createDefaultFlow, validateFlowDefinition, type FlowDefinition } from "@/lib/flows/definition";
import { advanceSimulation, respondSimulation, simulationRuleMatches, startSimulation } from "@/lib/flows/simulator";
import { createTemplate } from "@/components/flows/model";

describe("flow simulator", () => {
  it("waits for user interaction before sending a second message from a comment", () => {
    const definition = createDefaultFlow();
    const state = startSimulation(definition);
    expect(state.waiting).toBe("message");
    expect(state.windowMinutesRemaining).toBeNull();
    expect(state.events.filter((event) => event.kind === "bot")).toHaveLength(1);
    const answered = respondSimulation(definition, state, { text: "SI" });
    expect(answered.events.filter((event) => event.kind === "bot")).toHaveLength(2);
    expect(answered.windowMinutesRemaining).toBe(1440);
    expect(answered.finished).toBe(true);
  });

  it("ships connected templates with a supported plain text opening", () => {
    for (const name of ["resource", "lead", "qualification"] as const) {
      const definition = createTemplate(name);
      expect(validateFlowDefinition(definition)).toEqual({ valid: true, issues: [] });
      const state = startSimulation(definition);
      expect(state.waiting).toBe("message");
      expect(state.events.find((event) => event.kind === "bot")?.buttons).toEqual([]);
    }
  });

  it("does not open the messaging window after clicking a website button", () => {
    const definition = createDefaultFlow();
    const opening = definition.nodes.find((node) => node.id === "opening")!;
    if (opening.type !== "message") throw new Error("Missing opening");
    opening.data.buttons = [{ id: "link", label: "Abrir", kind: "url", url: "https://example.com" }];
    const state = respondSimulation(definition, startSimulation(definition), { handle: "button.link" });
    expect(state.windowMinutesRemaining).toBeNull();
    expect(state.waiting).toBe("message");
    expect(state.events.filter((event) => event.kind === "bot")).toHaveLength(1);
  });

  it("validates email and saves only a valid answer", () => {
    const definition = createTemplate("lead");
    let state = respondSimulation(definition, startSimulation(definition), { text: "SI" });
    state = respondSimulation(definition, state, { text: "incorrecto" });
    expect(state.waiting).toBe("input");
    expect(state.fields.email).toBeUndefined();
    expect(state.attempts).toBe(1);
    state = respondSimulation(definition, state, { text: "felipe@example.com" });
    expect(state.fields.email).toBe("felipe@example.com");
    expect(state.tags).toContain("Lead de Reel");
    expect(state.finished).toBe(true);
  });

  it("uses the same normalized email parser as a real flow", () => {
    const definition = createTemplate("lead");
    const opening = respondSimulation(definition, startSimulation(definition), { text: "SI" });
    const answered = respondSimulation(definition, opening, { text: "Mi email es FELIPE@example.com" });
    expect(answered.fields.email).toBe("felipe@example.com");
    expect(answered.finished).toBe(true);
  });

  it("takes the skip path after input retries are exhausted", () => {
    const definition = createTemplate("lead");
    let state = respondSimulation(definition, startSimulation(definition), { text: "SI" });
    for (let attempt = 0; attempt < 3; attempt++) state = respondSimulation(definition, state, { text: "mal" });
    expect(state.fields.email).toBeUndefined();
    expect(state.finished).toBe(true);
    expect(state.events.filter((event) => event.kind === "bot").at(-1)?.text).toContain("recurso");
  });

  it("blocks a message after a delay expires the messaging window", () => {
    const definition = createDefaultFlow();
    definition.nodes.push({ id: "wait", type: "delay", label: "Esperar", position: { x: 600, y: 120 }, data: { minutes: 1441 } });
    const connection = definition.edges.find((edge) => edge.source === "opening")!;
    connection.target = "wait";
    definition.edges.push({ id: "wait_resource", source: "wait", target: "resource", sourceHandle: "next" });
    let state = respondSimulation(definition, startSimulation(definition), { text: "SI" });
    expect(state.waiting).toBe("delay");
    state = respondSimulation(definition, state, {});
    expect(state.finished).toBe(true);
    expect(state.events.filter((event) => event.kind === "bot")).toHaveLength(1);
    expect(state.events.some((event) => event.text.includes("24 horas está cerrada"))).toBe(true);
  });

  it("compares tags as full labels and protects empty numeric fields", () => {
    expect(simulationRuleMatches({ field: "tag", operator: "contains", value: "VIP" }, {}, ["VIP potencial"])).toBe(false);
    expect(simulationRuleMatches({ field: "tag", operator: "contains", value: "VIP" }, {}, ["VIP"])).toBe(true);
    expect(simulationRuleMatches({ field: "edad", operator: "less_than", value: "18" }, {}, [])).toBe(false);
  });

  it("chooses a branch when the user types a button label", () => {
    const definition = createDefaultFlow();
    const opening = definition.nodes.find((node) => node.id === "opening")!;
    if (opening.type !== "message") throw new Error("Missing opening");
    opening.data.buttons = [{ id: "yes", label: "Quiero", kind: "continue" }, { id: "no", label: "No gracias", kind: "continue" }];
    definition.edges = definition.edges.filter((edge) => edge.source !== "opening");
    definition.edges.push({ id: "yes_resource", source: "opening", target: "resource", sourceHandle: "button.yes" }, { id: "no_end", source: "opening", target: "end", sourceHandle: "button.no" });
    const started = startSimulation(definition);
    const unexpected = respondSimulation(definition, started, { text: "Otra respuesta" });
    expect(unexpected.waiting).toBe("message");
    expect(unexpected.finished).toBe(false);
    const answer = respondSimulation(definition, unexpected, { text: "QUIERO" });
    expect(answer.events.filter((event) => event.kind === "bot")).toHaveLength(2);
    expect(answer.finished).toBe(true);
  });

  it("stops a cycle without an interaction instead of hanging the preview", () => {
    const definition: FlowDefinition = { schemaVersion: 1, entryNodeId: "start", nodes: [{ id: "start", type: "start", label: "Inicio", position: { x: 0, y: 0 }, data: {} }, { id: "loop", type: "action", label: "Etiqueta", position: { x: 100, y: 0 }, data: { action: "add_tag", tag: "Interesado" } }], edges: [{ id: "first", source: "start", target: "loop", sourceHandle: "next" }, { id: "cycle", source: "loop", target: "loop", sourceHandle: "next" }] };
    const state = startSimulation(definition);
    expect(state.finished).toBe(true);
    expect(state.events.at(-1)?.kind).toBe("warning");
    expect(advanceSimulation(definition, state)).toEqual(state);
  });
});
