import { describe, expect, it } from "vitest";
import { createDefaultFlow, validateFlowDefinition, type FlowDefinition } from "@/lib/flows/definition";
import { advanceSimulation, respondSimulation, simulationRuleMatches, startSimulation } from "@/lib/flows/simulator";
import { createTemplate } from "@/components/flows/model";

function definitionWithFollowGate(): FlowDefinition {
  const definition = createDefaultFlow();
  const opening = definition.nodes.find((node) => node.id === "opening");
  const resource = definition.nodes.find((node) => node.id === "resource");
  if (opening?.type !== "message" || resource?.type !== "message") throw new Error("Missing message fixtures");
  opening.data = { blocks: [{ type: "text", text: "Como va? Ahi te mando" }], buttons: [] };
  resource.data = { blocks: [{ type: "text", text: "Acá está tu recurso." }, { type: "image", url: "https://example.com/resource.jpg" }, { type: "pdf", url: "https://example.com/guide.pdf", name: "Guía" }], buttons: [] };
  definition.nodes.push(
    { id: "follow_check", label: "¿Sigue la cuenta?", type: "condition", position: { x: 1, y: 1 }, data: { match: "all", rules: [{ field: "follows", operator: "equals", value: "true" }] } },
    { id: "follow_request", label: "Pedir seguimiento", type: "message", position: { x: 1, y: 2 }, data: { blocks: [{ type: "text", text: "Seguí la cuenta para recibir el recurso." }], buttons: [{ id: "followed", label: "Ya te seguí", kind: "continue" }] } },
  );
  definition.edges = [
    { id: "start_opening", source: "start", sourceHandle: "next", target: "opening" },
    { id: "opening_check", source: "opening", sourceHandle: "next", target: "follow_check" },
    { id: "follow_yes", source: "follow_check", sourceHandle: "yes", target: "resource" },
    { id: "follow_no", source: "follow_check", sourceHandle: "no", target: "follow_request" },
    { id: "resource_end", source: "resource", sourceHandle: "next", target: "end" },
    { id: "follow_recheck", source: "follow_request", sourceHandle: "button.followed", target: "follow_check" },
  ];
  return definition;
}

function withOpeningButton(definition: FlowDefinition): FlowDefinition {
  const opening = definition.nodes.find((node) => node.id === "opening");
  if (opening?.type !== "message") throw new Error("Missing opening fixture");
  opening.data.buttons = [{ id: "continue", label: "Quiero la guía", kind: "continue" }];
  const continuation = definition.edges.find((edge) => edge.source === opening.id && edge.sourceHandle === "next");
  if (!continuation) throw new Error("Missing opening continuation");
  continuation.sourceHandle = "button.continue";
  return definition;
}

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

  it("waits for a follower's response before checking the condition and delivering all three resource blocks", () => {
    const definition = definitionWithFollowGate();
    expect(validateFlowDefinition(definition)).toEqual({ valid: true, issues: [] });
    const opening = startSimulation(definition, { username: "ana", follows: "true", comment: "GUIA" });
    expect(opening.nodeId).toBe("opening");
    expect(opening.waiting).toBe("message");
    expect(opening.windowMinutesRemaining).toBeNull();
    expect(opening.events.some((event) => event.nodeId === "follow_check")).toBe(false);
    expect(opening.events.filter((event) => event.kind === "bot").map((event) => event.text)).toEqual(["Como va? Ahi te mando"]);

    const answered = respondSimulation(definition, opening, { text: "SI" });
    expect(answered.finished).toBe(true);
    expect(answered.events.filter((event) => event.kind === "bot" && event.nodeId === "resource")).toEqual([
      expect.objectContaining({ text: "Acá está tu recurso." }),
      expect.objectContaining({ media: { type: "image", url: "https://example.com/resource.jpg" } }),
      expect.objectContaining({ media: { type: "pdf", url: "https://example.com/guide.pdf", name: "Guía" } }),
    ]);
  });

  it("lets a confirmed follower tap the opening button before delivering all three resource blocks", () => {
    const definition = withOpeningButton(definitionWithFollowGate());
    const opening = startSimulation(definition, { username: "ana", follows: "true" });
    expect(opening.windowMinutesRemaining).toBeNull();
    expect(opening.waiting).toBe("message");
    expect(opening.events.filter((event) => event.kind === "bot")).toEqual([
      expect.objectContaining({ text: "Como va? Ahi te mando", buttons: [{ id: "continue", label: "Quiero la guía", kind: "continue" }] }),
    ]);
    expect(opening.events.some((event) => event.text.includes("clic o una respuesta"))).toBe(true);
    expect(opening.events.some((event) => event.nodeId === "resource")).toBe(false);

    const answered = respondSimulation(definition, opening, { handle: "button.continue" });
    expect(answered.windowMinutesRemaining).toBe(1440);
    expect(answered.finished).toBe(true);
    expect(answered.events.filter((event) => event.kind === "bot" && event.nodeId === "resource")).toEqual([
      expect.objectContaining({ text: "Acá está tu recurso." }),
      expect.objectContaining({ media: { type: "image", url: "https://example.com/resource.jpg" } }),
      expect.objectContaining({ media: { type: "pdf", url: "https://example.com/guide.pdf", name: "Guía" } }),
    ]);
  });

  it.each(["false", "unknown", undefined])("uses text instead of an opening button for %s follow status and preserves its route", (follows) => {
    const definition = withOpeningButton(createDefaultFlow());
    const fields: Record<string, string> = { username: "ana" };
    if (follows !== undefined) fields.follows = follows;
    const opening = startSimulation(definition, fields);
    const firstMessage = opening.events.find((event) => event.kind === "bot");
    expect(firstMessage?.buttons).toEqual([]);
    expect(firstMessage?.text).toContain("Quiero la guía");
    expect(opening.windowMinutesRemaining).toBeNull();
    expect(opening.waiting).toBe("message");
    expect(opening.finished).toBe(false);
    expect(opening.events.some((event) => event.kind === "warning")).toBe(false);
    expect(opening.events.some((event) => event.kind === "action" && event.text.includes("respuesta escrita"))).toBe(true);
    expect(opening.events.some((event) => event.nodeId === "resource")).toBe(false);

    const answered = respondSimulation(definition, opening, { text: "QUIERO LA GUÍA" });
    expect(answered.windowMinutesRemaining).toBe(1440);
    expect(answered.finished).toBe(true);
    expect(answered.events.filter((event) => event.kind === "bot" && event.nodeId === "resource")).toHaveLength(1);
  });

  it("keeps the sole opening button's path for an unmatched written reply when no default route exists", () => {
    const definition = withOpeningButton(createDefaultFlow());
    const opening = startSimulation(definition, { follows: "unknown" });
    const answered = respondSimulation(definition, opening, { text: "Sí, por favor" });
    expect(answered.finished).toBe(true);
    expect(answered.windowMinutesRemaining).toBe(1440);
    expect(answered.events.filter((event) => event.kind === "bot" && event.nodeId === "resource")).toHaveLength(1);
  });

  it.each(["false", "unknown"])("keeps the gated resource hidden for %s follow status after replying and tapping the follow button", (follows) => {
    const definition = definitionWithFollowGate();
    const question = respondSimulation(definition, startSimulation(definition, { follows }), { text: "SI" });
    expect(question.waiting).toBe("message");
    expect(question.nodeId).toBe("follow_request");
    expect(question.finished).toBe(false);
    expect(question.events.some((event) => event.nodeId === "resource")).toBe(false);

    const rechecked = respondSimulation(definition, question, { handle: "button.followed" });
    expect(rechecked.waiting).toBe("message");
    expect(rechecked.nodeId).toBe("follow_request");
    expect(rechecked.finished).toBe(false);
    expect(rechecked.events.some((event) => event.nodeId === "resource")).toBe(false);
    expect(rechecked.events.filter((event) => event.nodeId === "follow_check")).toHaveLength(2);
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
