import { describe, expect, it } from "vitest";
import { createDefaultFlow, type FlowDefinition, type FlowNode } from "@/lib/flows/definition";
import { createTemplate } from "@/components/flows/model";
import {
  filterMessageVariables,
  getMessageVariables,
  getSlashQuery,
  insertMessageVariable,
} from "@/lib/flows/message-variables";
import { renderFlowText } from "@/lib/flows/runtime-values";
import { respondSimulation, startSimulation } from "@/lib/flows/simulator";

function flowWithCollectedFields(): FlowDefinition {
  const flow = createDefaultFlow();
  const position = { x: 0, y: 0 };
  const nodes: FlowNode[] = [
    { id: "name", label: "Pedir nombre", type: "input", position, data: { prompt: "¿Cómo te llamás?", inputType: "text", fieldKey: "nombre", retryMessage: "Probá otra vez.", maxAttempts: 3, timeoutMinutes: 30 } },
    { id: "interest", label: "Guardar interés", type: "action", position, data: { action: "set_field", fieldKey: "interes", value: "Guía" } },
    { id: "points", label: "Sumar puntos", type: "action", position, data: { action: "increment_field", fieldKey: "puntos", value: "1" } },
    { id: "clear", label: "Borrar campo", type: "action", position, data: { action: "clear_field", fieldKey: "campo_borrado" } },
  ];
  return { ...flow, nodes: [...flow.nodes, ...nodes] };
}

describe("available message variables", () => {
  it("provides the recipient and comment values with their actual sources", () => {
    const variables = getMessageVariables(createDefaultFlow());
    expect(variables).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "username", source: "instagram" }),
      expect.objectContaining({ key: "comment", source: "instagram" }),
      expect.objectContaining({ key: "email", source: "contact" }),
      expect.objectContaining({ key: "phone", source: "contact" }),
    ]));
    expect(variables.every((variable) => variable.label.trim() && variable.description.trim())).toBe(true);
    expect(new Set(variables.map((variable) => variable.key)).size).toBe(variables.length);
  });

  it("combines workspace fields and data collected or assigned by the flow without duplicates", () => {
    const flow = flowWithCollectedFields();
    const fields = [{ key: "nombre", label: "Nombre completo" }, { key: "username", label: "Duplicado" }, { key: "empresa", label: "Empresa" }];
    const originalFlow = structuredClone(flow);
    const originalFields = structuredClone(fields);
    const variables = getMessageVariables(flow, fields);

    expect(variables).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "nombre", label: "Nombre completo", source: "contact" }),
      expect.objectContaining({ key: "empresa", label: "Empresa", source: "contact" }),
      expect.objectContaining({ key: "interes", source: "flow" }),
      expect.objectContaining({ key: "puntos", source: "flow" }),
    ]));
    expect(variables.filter((variable) => variable.key === "nombre")).toHaveLength(1);
    expect(variables.filter((variable) => variable.key === "username")).toEqual([
      expect.objectContaining({ source: "instagram" }),
    ]);
    expect(variables.some((variable) => variable.key === "campo_borrado")).toBe(false);
    expect(flow).toEqual(originalFlow);
    expect(fields).toEqual(originalFields);
  });

  it("excludes unsafe and prototype keys from both workspace and flow suggestions", () => {
    const unsafeKeys = ["", "nombre completo", "nombre}}", "nombre\n", "🎉", "constructor", "prototype", "__proto__"];
    const flow = flowWithCollectedFields();
    const input = flow.nodes.find((node) => node.type === "input")!;
    const action = flow.nodes.find((node) => node.type === "action" && node.data.action === "set_field")!;
    if (input.type !== "input" || action.type !== "action") throw new Error("Missing field fixtures");
    input.data.fieldKey = "constructor";
    action.data.fieldKey = "injected}}";
    const variables = getMessageVariables(flow, unsafeKeys.map((key) => ({ key, label: key || "Vacío" })));

    expect(variables.every((variable) => /^[a-zA-Z0-9_.:-]+$/.test(variable.key))).toBe(true);
    expect(variables.some((variable) => [...unsafeKeys, "injected}}"].includes(variable.key))).toBe(false);
  });

  it("keeps safe keys supported by the runtime, including dots, colons and hyphens", () => {
    const keys = ["pedido.total", "crm:segmento", "grupo-nombre", "group_name"];
    const variables = getMessageVariables(createDefaultFlow(), keys.map((key) => ({ key, label: key })));
    expect(variables.map((variable) => variable.key)).toEqual(expect.arrayContaining(keys));
  });
});

describe("slash queries", () => {
  it.each([
    ["/", 0, ""],
    ["/nom", 0, "nom"],
    ["Hola /nom", 5, "nom"],
    ["Hola\n/nom", 5, "nom"],
    ["Hola\t/tel", 5, "tel"],
    ["Hola (/nom", 6, "nom"],
  ] as const)("recognizes %j immediately before the caret", (value, start, query) => {
    expect(getSlashQuery(value, value.length)).toEqual({ start, end: value.length, query });
  });

  it("uses the caret instead of the end of the message, including UTF-16 offsets", () => {
    const value = "😀 Hola /nom, gracias por responder.";
    const start = value.indexOf("/nom");
    const end = start + "/nom".length;
    expect(getSlashQuery(value, end)).toEqual({ start, end, query: "nom" });
    expect(getSlashQuery(value, start)).toBeNull();
  });

  it.each([
    "https://example.com/recurso",
    "http://example.com",
    "https://",
    "Nos vemos el 1/2",
    "Guía/recursos",
    "Hola /nom gracias",
    "Hola (/nom)",
    "Sin ninguna variable",
  ])("leaves ordinary text %j alone", (value) => {
    expect(getSlashQuery(value, value.length)).toBeNull();
  });

  it("does not replace text while a selection is active", () => {
    expect(getSlashQuery("Hola /nom", 5, 9)).toBeNull();
  });
});

describe("Spanish variable search", () => {
  const variables = [
    { key: "phone", label: "Teléfono", description: "Número de contacto", source: "contact" as const },
    { key: "nombre", label: "Nombre", description: "Respuesta de la persona", source: "flow" as const },
    { key: "comment", label: "Comentario", description: "Texto del Reel", source: "instagram" as const },
  ];

  it.each(["telefono", "TELÉFONO", "teléfono"])("matches the accented label with %j", (query) => {
    expect(filterMessageVariables(variables, query)).toEqual([variables[0]]);
  });

  it("searches keys and descriptions as well as labels", () => {
    expect(filterMessageVariables(variables, "phone")).toEqual([variables[0]]);
    expect(filterMessageVariables(variables, "numero")).toEqual([variables[0]]);
    expect(filterMessageVariables(variables, "persona")).toEqual([variables[1]]);
    expect(filterMessageVariables(variables, "Reel")).toEqual([variables[2]]);
    expect(filterMessageVariables(variables, "inexistente")).toEqual([]);
    expect(filterMessageVariables(variables, "")).toEqual(variables);
  });

  it("ranks the comment match before a descriptive mention of a full name", () => {
    const matches = filterMessageVariables(getMessageVariables(createDefaultFlow()), "com");
    expect(matches[0]?.key).toBe("comment");
    expect(matches.some((variable) => variable.key === "username")).toBe(true);
  });
});

describe("variable insertion and rendering", () => {
  it("replaces only the active query in the middle of a message", () => {
    const value = "Hola /nom, gracias por responder. /co";
    const query = { start: 5, end: 9, query: "nom" };
    expect(insertMessageVariable(value, query, "nombre")).toEqual({
      value: "Hola {{nombre}}, gracias por responder. /co",
      caret: "Hola {{nombre}}".length,
    });
    expect(query).toEqual({ start: 5, end: 9, query: "nom" });
  });

  it("preserves surrounding Unicode, line breaks and existing variables", () => {
    const value = "🎉 {{username}}\n/nom\n¡Bienvenida!";
    const start = value.indexOf("/nom");
    expect(insertMessageVariable(value, { start, end: start + 4, query: "nom" }, "nombre")).toEqual({
      value: "🎉 {{username}}\n{{nombre}}\n¡Bienvenida!",
      caret: start + "{{nombre}}".length,
    });
  });

  it("inserts an empty slash query without appending unwanted spaces", () => {
    expect(insertMessageVariable("/", { start: 0, end: 1, query: "" }, "comment")).toEqual({
      value: "{{comment}}", caret: "{{comment}}".length,
    });
  });

  it("renders inserted built-in and collected values with the existing runtime and fallback syntax", () => {
    const variables = getMessageVariables(flowWithCollectedFields());
    expect(variables.some((variable) => variable.key === "nombre")).toBe(true);
    let message = "Hola /us. Comentaste /co. Tu nombre: /no. Email: {{email|pendiente}}.";
    for (const [search, key] of [["/us", "username"], ["/co", "comment"], ["/no", "nombre"]]) {
      const start = message.indexOf(search);
      const query = getSlashQuery(message, start + search.length)!;
      message = insertMessageVariable(message, query, key).value;
    }
    expect(renderFlowText(message, { username: "camila", comment: "QUIERO LA GUÍA", nombre: "Cami", email: "" })).toBe(
      "Hola camila. Comentaste QUIERO LA GUÍA. Tu nombre: Cami. Email: pendiente.",
    );
  });

  it("personalizes the simulator retry using saved fields without accepting an invalid answer", () => {
    const flow = createTemplate("lead");
    const input = flow.nodes.find((node) => node.type === "input")!;
    if (input.type !== "input") throw new Error("Missing input fixture");
    input.data.retryMessage = "{{nombre}}, revisá tu email. Usuario: {{username}}. Email: {{email|pendiente}}.";
    const question = respondSimulation(flow, startSimulation(flow, { username: "camila", nombre: "Cami" }), { text: "SI" });
    const retried = respondSimulation(flow, question, { text: "no es un email" });

    expect(retried.events.filter((event) => event.kind === "bot").at(-1)?.text).toBe(
      "Cami, revisá tu email. Usuario: camila. Email: pendiente.",
    );
    expect(retried.waiting).toBe("input");
    expect(retried.attempts).toBe(1);
    expect(retried.fields.email).toBeUndefined();
  });
});
