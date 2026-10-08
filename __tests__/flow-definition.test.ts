import { describe, expect, it } from "vitest";
import { createDefaultFlow, validateFlowDefinition } from "@/lib/flows/definition";

describe("published flow validation", () => {
  it("accepts a complete text opening followed by information", () => {
    expect(validateFlowDefinition(createDefaultFlow()).valid).toBe(true);
  });
  it("rejects media before the commenter has responded", () => {
    const graph = createDefaultFlow();
    const opening = graph.nodes.find((node) => node.id === "opening");
    if (opening?.type !== "message") throw new Error("Fixture");
    opening.data.blocks = [{ type: "pdf", url: "https://example.com/guide.pdf" }];
    expect(validateFlowDefinition(graph).issues.some((issue) => issue.nodeId === "opening")).toBe(true);
  });
  it("allows one opening continuation button with the same written route", () => {
    const graph = createDefaultFlow();
    const opening = graph.nodes.find((node) => node.id === "opening");
    if (opening?.type !== "message") throw new Error("Fixture");
    opening.data.buttons = [{ id: "guide", label: "Quiero la guía", kind: "continue" }];
    graph.edges.find((edge) => edge.source === "opening")!.sourceHandle = "button.guide";
    expect(validateFlowDefinition(graph).valid).toBe(true);
    opening.data.quickReplies = [{ id: "reply", label: "Otra opción", kind: "continue" }];
    expect(validateFlowDefinition(graph).valid).toBe(false);
    opening.data.quickReplies = [];
    opening.data.buttons.push({ id: "other", label: "Otro", kind: "continue" });
    expect(validateFlowDefinition(graph).valid).toBe(false);
    opening.data.buttons = [{ id: "guide", label: "Ver guía", kind: "url", url: "https://example.com" }];
    expect(validateFlowDefinition(graph).issues.some((issue) => issue.nodeId === "opening" && issue.message.includes("apertura"))).toBe(true);
  });
  it("reserves space for the initial button's written alternative", () => {
    const graph = createDefaultFlow();
    const opening = graph.nodes.find((node) => node.id === "opening");
    if (opening?.type !== "message") throw new Error("Fixture");
    opening.data.buttons = [{ id: "guide", label: "Quiero la guía", kind: "continue" }];
    graph.edges.push({ id: "button_route", source: "opening", sourceHandle: "button.guide", target: "resource" });
    opening.data.blocks = [{ type: "text", text: "á".repeat(490) }];
    expect(validateFlowDefinition(graph).issues.some((issue) => issue.nodeId === "opening" && issue.message.includes("alternativa"))).toBe(true);
  });
  it("allows PDFs and multiple media blocks after the opening", () => {
    const graph = createDefaultFlow();
    const resource = graph.nodes.find((node) => node.id === "resource");
    if (resource?.type !== "message") throw new Error("Fixture");
    resource.data.blocks.push({ type: "pdf", url: "https://example.com/guide.pdf" }, { type: "video", url: "https://example.com/demo.mp4" });
    expect(validateFlowDefinition(graph).valid).toBe(true);
  });
  it("does not allow two targets for the same answer", () => {
    const graph = createDefaultFlow();
    graph.edges.push({ id: "duplicate_answer", source: "opening", target: "end", sourceHandle: "next" });
    expect(validateFlowDefinition(graph).valid).toBe(false);
  });
  it("requires explicit unanswered and skip paths for collection", () => {
    const graph = createDefaultFlow();
    graph.nodes.push({ id: "email", type: "input", label: "Email", position: { x: 1, y: 1 }, data: { prompt: "Tu email", inputType: "email", fieldKey: "email", maxAttempts: 3, timeoutMinutes: 60, retryMessage: "Probá otra vez" } });
    graph.edges.find((edge) => edge.source === "resource")!.target = "email";
    graph.edges.push({ id: "email_end", source: "email", target: "end", sourceHandle: "answered" });
    expect(validateFlowDefinition(graph).issues.some((issue) => issue.nodeId === "email" && issue.message.includes("sin respuesta"))).toBe(true);
  });
  it("rejects credentials in URLs and counts UTF8 bytes", () => {
    const graph = createDefaultFlow();
    const message = graph.nodes.find((node) => node.id === "resource");
    if (message?.type !== "message") throw new Error("Fixture");
    message.data.blocks = [{ type: "text", text: "🚀".repeat(260) }];
    expect(validateFlowDefinition(graph).valid).toBe(false);
    message.data.blocks = [{ type: "pdf", url: "https://user:password@example.com/guide.pdf" }];
    expect(validateFlowDefinition(graph).valid).toBe(false);
  });
  it("rejects unreachable steps and absent condition branches", () => {
    const graph = createDefaultFlow();
    graph.nodes.push({ id: "decision", type: "condition", label: "Decisión", position: { x: 1, y: 1 }, data: { match: "all", rules: [{ field: "email", operator: "exists" }] } });
    const issues = validateFlowDefinition(graph).issues;
    expect(issues.some((issue) => issue.nodeId === "decision" && issue.message.includes("inicio"))).toBe(true);
    expect(issues.some((issue) => issue.nodeId === "decision" && issue.message.includes("sí y no"))).toBe(true);
  });
  it("rejects quick replies on media or several texts so no invisible choices are published", () => {
    const graph = createDefaultFlow();
    const message = graph.nodes.find((node) => node.id === "resource");
    if (message?.type !== "message") throw new Error("Fixture");
    message.data.quickReplies = [{ id: "yes", label: "Sí", kind: "continue" }];
    graph.edges.push({ id: "yes_end", source: "resource", target: "end", sourceHandle: "button.yes" });
    message.data.blocks = [{ type: "image", url: "https://example.com/photo.jpg" }];
    expect(validateFlowDefinition(graph).valid).toBe(false);
    message.data.blocks = [{ type: "text", text: "Una" }, { type: "text", text: "Otra" }];
    expect(validateFlowDefinition(graph).valid).toBe(false);
    message.data.blocks = [{ type: "text", text: "Elegí" }];
    expect(validateFlowDefinition(graph).valid).toBe(true);
  });
  it("rejects oversized question text and highlights invalid data on its node", () => {
    const graph = createDefaultFlow();
    graph.nodes.push({ id: "email", type: "input", label: "Email", position: { x: 1, y: 1 }, data: { prompt: "🚀".repeat(260), inputType: "email", fieldKey: "email", maxAttempts: 3, timeoutMinutes: 60, retryMessage: "Probá otra vez" } });
    expect(validateFlowDefinition(graph).issues.some((issue) => issue.nodeId === "email" && issue.message.includes("bytes"))).toBe(true);
    const resource = graph.nodes.find((node) => node.id === "resource");
    if (resource?.type !== "message") throw new Error("Fixture");
    resource.data.blocks = [{ type: "video", url: "invalid" }];
    expect(validateFlowDefinition(graph).issues.some((issue) => issue.nodeId === "resource")).toBe(true);
  });
});
