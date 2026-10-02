import { describe, expect, it } from "vitest";
import { createFlowFromCampaign, type FlowCampaignSource } from "@/lib/flows/from-campaign";
import { validateFlowDefinition, type FlowDefinition } from "@/lib/flows/definition";
import { respondSimulation, startSimulation } from "@/lib/flows/simulator";

const legacy: FlowCampaignSource = {
  dmMessage: "Hola {username}, acá está la guía: {link}",
  trackedLinks: [{ destinationUrl: "https://example.com/guia", label: "Descargar guía" }],
  openingDmEnabled: true, openingDmMessage: "Te paso la guía.",
  askEnabled: true, askType: "EMAIL", askMessage: "¿A qué email te escribimos?",
  askRetryMessage: "Revisá el email.", askAfterLink: false,
  askThanksMessage: "¡Gracias por compartir tu email!",
  followUpEnabled: true, followUpMessage: "¿Te sirvió la guía?", followUpDelayMinutes: 15,
};
const botNodes = (state: ReturnType<typeof startSimulation>) => state.events.filter((event) => event.kind === "bot").map((event) => event.nodeId);
const target = (definition: FlowDefinition, source: string, port: string) => definition.edges.find((edge) => edge.source === source && edge.sourceHandle === port)?.target;

describe("campaign to visual flow", () => {
  it("preserves an enabled opening with an explicit text interaction and no buttons", () => {
    const definition = createFlowFromCampaign(legacy);
    expect(validateFlowDefinition(definition)).toEqual({ valid: true, issues: [] });
    const opening = definition.nodes.find((node) => node.id === "opening");
    expect(opening).toMatchObject({ type: "message", data: { blocks: [{ type: "text", text: "Te paso la guía.\n\nRespondé SI para continuar." }], buttons: [] } });
    expect(startSimulation(definition).waiting).toBe("message");
    const resource = definition.nodes.find((node) => node.id === "resource");
    expect(resource).toMatchObject({ data: { blocks: [{ type: "text", text: "Hola {username}, acá está la guía:" }], buttons: [{ id: "link_0", label: "Descargar guía", kind: "url", url: "https://example.com/guia" }] } });
  });

  it("asks before the resource and continues after a valid answer or exhausted retries", () => {
    const definition = createFlowFromCampaign(legacy);
    let state = respondSimulation(definition, startSimulation(definition), { text: "SI" });
    expect(botNodes(state)).toEqual(["opening", "question"]);
    state = respondSimulation(definition, state, { text: "MI EMAIL es FELIPE@example.com" });
    expect(state.fields.email).toBe("felipe@example.com");
    expect(botNodes(state)).toEqual(["opening", "question", "resource"]);
    expect(state.waiting).toBe("delay");
    expect(definition.nodes.some((node) => node.id === "thanks")).toBe(false);
    let skipped = respondSimulation(definition, startSimulation(definition), { text: "SI" });
    for (let attempt = 0; attempt < 3; attempt++) skipped = respondSimulation(definition, skipped, { text: "inválido" });
    expect(skipped.fields.email).toBeUndefined();
    expect(botNodes(skipped).at(-1)).toBe("resource");
    expect(target(definition, "question", "timeout")).toBe("end");
    expect(definition.nodes.find((node) => node.id === "question")).toMatchObject({ data: { maxAttempts: 3, timeoutMinutes: 10080, retryMessage: "Revisá el email." } });
  });

  it("asks after the resource, thanks only a valid answer and then waits for follow-up", () => {
    const definition = createFlowFromCampaign({ ...legacy, askAfterLink: true });
    expect(validateFlowDefinition(definition).valid).toBe(true);
    let state = respondSimulation(definition, startSimulation(definition), { text: "SI" });
    expect(botNodes(state)).toEqual(["opening", "resource", "question"]);
    state = respondSimulation(definition, state, { text: "felipe@example.com" });
    expect(botNodes(state)).toEqual(["opening", "resource", "question", "thanks"]);
    expect(state.waiting).toBe("delay");
    state = respondSimulation(definition, state, {});
    expect(botNodes(state)).toEqual(["opening", "resource", "question", "thanks", "follow_up"]);
    expect(state.finished).toBe(true);
    const skipped = respondSimulation(definition, respondSimulation(definition, startSimulation(definition), { text: "SI" }), { text: "omitir" });
    expect(botNodes(skipped)).not.toContain("thanks");
    expect(skipped.waiting).toBe("delay");
    expect(definition.nodes.find((node) => node.id === "question")).toMatchObject({ data: { timeoutMinutes: 1440 } });
  });

  it("loops confirmed non-followers and lets true or unknown follow status proceed", () => {
    const definition = createFlowFromCampaign({ ...legacy, askEnabled: false, requireFollow: true, followPromptMessage: "Seguime para recibirlo.", followPromptButtonLabel: "Ya te sigo" });
    expect(validateFlowDefinition(definition)).toEqual({ valid: true, issues: [] });
    let state = respondSimulation(definition, startSimulation(definition, { follows: "false" }), { text: "SI" });
    expect(botNodes(state)).toEqual(["opening", "follow_prompt"]);
    state = respondSimulation(definition, state, { handle: "button.followed" });
    expect(botNodes(state)).toEqual(["opening", "follow_prompt", "follow_prompt"]);
    expect(botNodes(state)).not.toContain("resource");
    state.fields.follows = "true";
    state = respondSimulation(definition, state, { text: "Ya te sigo" });
    expect(botNodes(state).at(-1)).toBe("resource");
    for (const follows of ["true", "unknown"]) {
      const passed = respondSimulation(definition, startSimulation(definition, { follows }), { text: "SI" });
      expect(botNodes(passed)).toEqual(["opening", "resource"]);
    }
  });

  it("preserves the follow-up delay including immediate delivery", () => {
    for (const minutes of [0, 15, 1440]) {
      const definition = createFlowFromCampaign({ ...legacy, askEnabled: false, followUpDelayMinutes: minutes });
      expect(validateFlowDefinition(definition).valid).toBe(true);
      expect(definition.nodes.find((node) => node.id === "follow_up_delay")).toMatchObject({ type: "delay", data: { minutes } });
      expect(target(definition, "resource", "next")).toBe("follow_up_delay");
      expect(target(definition, "follow_up_delay", "next")).toBe("follow_up");
    }
  });

  it("keeps a custom free-text field and phone capture separate", () => {
    const text = createFlowFromCampaign({ ...legacy, askType: "TEXT", askFieldKey: "objetivo", askMessage: "¿Cuál es tu objetivo?" });
    expect(validateFlowDefinition(text).valid).toBe(true);
    expect(text.nodes.find((node) => node.id === "question")).toMatchObject({ data: { inputType: "text", fieldKey: "objetivo", timeoutMinutes: 1440 } });
    const phone = createFlowFromCampaign({ ...legacy, askType: "PHONE" });
    const state = respondSimulation(phone, respondSimulation(phone, startSimulation(phone), { text: "SI" }), { text: "+54 11 5555 8888" });
    expect(state.fields.phone).toBe("+541155558888");
  });

  it("splits long Unicode messages while keeping their full content and button limits", () => {
    const openingText = "¡Hola! ".repeat(220);
    const message = "Información 😀 {username}. ".repeat(130);
    const definition = createFlowFromCampaign({ ...legacy, openingDmMessage: openingText, dmMessage: message, askEnabled: false });
    expect(validateFlowDefinition(definition)).toEqual({ valid: true, issues: [] });
    const state = respondSimulation(definition, startSimulation(definition, { username: "felipe" }), { text: "SI" });
    const openingMessages = state.events.filter((event) => event.kind === "bot" && event.nodeId?.startsWith("opening"));
    expect(openingMessages.map((event) => event.text).join("").replace("\n\nRespondé SI para continuar.", "")).toBe(openingText.trim());
    const resourceMessages = state.events.filter((event) => event.kind === "bot" && event.nodeId?.startsWith("resource"));
    expect(resourceMessages.map((event) => event.text).join("")).toBe(message.trim().replaceAll("{username}", "felipe"));
    expect(resourceMessages.at(-1)?.buttons).toHaveLength(1);
    expect(resourceMessages.slice(0, -1).every((event) => !event.buttons?.length)).toBe(true);
    for (const node of definition.nodes) {
      if (node.type !== "message") continue;
      for (const block of node.data.blocks) if (block.type === "text") {
        expect(new TextEncoder().encode(block.text).length).toBeLessThanOrEqual(1000);
        if (node.data.buttons.length) expect(block.text.length).toBeLessThanOrEqual(640);
      }
    }
  });

  it("keeps HTTP destinations as inline text and supports the legacy links alias", () => {
    const definition = createFlowFromCampaign({ dmMessage: "Tu recurso", links: [{ url: "http://example.com/legacy", label: "Recurso anterior" }] });
    expect(validateFlowDefinition(definition).valid).toBe(true);
    expect(definition.nodes.find((node) => node.id === "resource")).toMatchObject({ data: { blocks: [{ type: "text", text: "Tu recurso\n\nRecurso anterior: http://example.com/legacy" }], buttons: [] } });
  });

  it("does not revive disabled legacy steps and produces stable non-mutating drafts", () => {
    const campaign = { ...legacy, openingDmEnabled: false, requireFollow: false, askEnabled: false, followUpEnabled: false, contactTags: ["Interesado"] };
    const original = structuredClone(campaign);
    const definition = createFlowFromCampaign(campaign);
    expect(definition).toEqual(createFlowFromCampaign(campaign));
    expect(campaign).toEqual(original);
    expect(validateFlowDefinition(definition).valid).toBe(true);
    expect(definition.nodes.map((node) => node.id)).toEqual(["start", "opening", "resource", "end"]);
    expect(definition.nodes.find((node) => node.id === "opening")).not.toMatchObject({ data: { blocks: [{ text: "Te paso la guía." }] } });
  });
});
