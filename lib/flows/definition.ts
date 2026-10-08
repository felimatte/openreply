import { z } from "zod";
import { createFlowFromCampaign, type FlowCampaignSource } from "./from-campaign";
import { MAX_DELAY_MINUTES, type DurationUnit } from "./duration";

export type FlowNodeType = "start" | "message" | "input" | "condition" | "delay" | "action" | "randomizer" | "end";
export type FlowMediaType = "image" | "video" | "audio" | "pdf";
export type FlowMessageBlock = { type: "text"; text: string } | { type: FlowMediaType; url: string; name?: string };
export interface FlowButton { id: string; label: string; kind: "continue" | "url"; url?: string }
export interface FlowMessageData { blocks: FlowMessageBlock[]; buttons: FlowButton[]; quickReplies?: FlowButton[] }
export interface FlowInputData {
  prompt: string; inputType: "email" | "phone" | "text" | "number" | "choice";
  fieldKey: string; retryMessage: string; maxAttempts: number; timeoutMinutes: number; options?: string[];
}
export type FlowOperator = "equals" | "not_equals" | "contains" | "exists" | "not_exists" | "greater_than" | "less_than";
export interface FlowConditionRule { field: string; operator: FlowOperator; value?: string }
export interface FlowConditionData { rules: FlowConditionRule[]; match: "all" | "any" }
export interface FlowDelayData { minutes: number; unit?: DurationUnit; until?: string }
export type FlowActionType = "add_tag" | "remove_tag" | "set_field" | "clear_field" | "increment_field" | "webhook" | "goal" | "pause" | "handoff" | "start_flow";
export interface FlowActionData {
  action: FlowActionType; tag?: string; fieldKey?: string; value?: string; url?: string; automationId?: string; note?: string;
}
export interface FlowRandomizerData { branches: { id: string; label: string; weight: number }[] }
type Node<T extends FlowNodeType, D> = { id: string; type: T; label: string; position: { x: number; y: number }; data: D };
export type FlowNode = Node<"start", Record<string, never>> | Node<"message", FlowMessageData> | Node<"input", FlowInputData> |
  Node<"condition", FlowConditionData> | Node<"delay", FlowDelayData> | Node<"action", FlowActionData> |
  Node<"randomizer", FlowRandomizerData> | Node<"end", Record<string, never>>;
export interface FlowEdge { id: string; source: string; target: string; sourceHandle: string }
export interface FlowDefinition {
  schemaVersion: 1; entryNodeId: string; nodes: FlowNode[]; edges: FlowEdge[];
  viewport?: { x: number; y: number; zoom: number };
}
export interface FlowIssue { nodeId?: string; message: string }
export interface FlowValidationResult { valid: boolean; issues: FlowIssue[] }

const id = z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/, "El identificador contiene caracteres no permitidos.");
const fieldKey = z.string().min(1).max(80).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "Usá letras, números y guiones bajos para el campo.");
const url = z.string().max(2048).url().refine((value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch { return false; }
}, "La dirección debe ser HTTPS y no contener credenciales.");
const button = z.object({ id, label: z.string().min(1).max(20), kind: z.enum(["continue", "url"]), url: url.optional() });
const base = { id, label: z.string().min(1).max(100), position: z.object({ x: z.number().finite(), y: z.number().finite() }) };
const block = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().min(1).max(1000) }),
  ...(["image", "video", "audio", "pdf"] as const).map((type) => z.object({ type: z.literal(type), url, name: z.string().max(200).optional() })),
]);
const nodeSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("start"), data: z.object({}) }),
  z.object({ ...base, type: z.literal("message"), data: z.object({ blocks: z.array(block).min(1).max(10), buttons: z.array(button).max(3), quickReplies: z.array(button).max(11).optional() }) }),
  z.object({ ...base, type: z.literal("input"), data: z.object({ prompt: z.string().min(1).max(1000), inputType: z.enum(["email", "phone", "text", "number", "choice"]), fieldKey, retryMessage: z.string().max(1000), maxAttempts: z.number().int().min(1).max(5), timeoutMinutes: z.number().int().min(1).max(10080), options: z.array(z.string().min(1).max(20)).max(10).optional() }) }),
  z.object({ ...base, type: z.literal("condition"), data: z.object({ rules: z.array(z.object({ field: z.string().min(1).max(100), operator: z.enum(["equals", "not_equals", "contains", "exists", "not_exists", "greater_than", "less_than"]), value: z.string().max(1000).optional() })).min(1).max(20), match: z.enum(["all", "any"]) }) }),
  z.object({ ...base, type: z.literal("delay"), data: z.object({ minutes: z.number().min(0).max(MAX_DELAY_MINUTES), unit: z.enum(["seconds", "minutes", "hours"]).optional(), until: z.string().datetime({ offset: true }).optional() }) }),
  z.object({ ...base, type: z.literal("action"), data: z.object({ action: z.enum(["add_tag", "remove_tag", "set_field", "clear_field", "increment_field", "webhook", "goal", "pause", "handoff", "start_flow"]), tag: z.string().max(80).optional(), fieldKey: fieldKey.optional(), value: z.string().max(2000).optional(), url: url.optional(), automationId: z.string().max(100).optional(), note: z.string().max(2000).optional() }) }),
  z.object({ ...base, type: z.literal("randomizer"), data: z.object({ branches: z.array(z.object({ id, label: z.string().min(1).max(100), weight: z.number().min(0).max(100) })).min(2).max(10) }) }),
  z.object({ ...base, type: z.literal("end"), data: z.object({}) }),
]);
export const flowDefinitionSchema = z.object({
  schemaVersion: z.literal(1), entryNodeId: id, nodes: z.array(nodeSchema).min(2).max(120),
  edges: z.array(z.object({ id, source: id, target: id, sourceHandle: z.string().min(1).max(100) })).max(400),
  viewport: z.object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().min(0.2).max(2) }).optional(),
});

export function parseFlowDefinition(value: unknown): FlowDefinition {
  return flowDefinitionSchema.parse(value) as FlowDefinition;
}

export function getNodePorts(node: FlowNode): { id: string; label: string }[] {
  switch (node.type) {
    case "end": return [];
    case "message": return [
      { id: "next", label: "Continuar / respuesta" },
      ...[...node.data.buttons, ...(node.data.quickReplies ?? [])].filter((b) => b.kind === "continue").map((b) => ({ id: `button.${b.id}`, label: b.label })),
    ];
    case "input": return [{ id: "answered", label: "Respuesta válida" }, { id: "skip", label: "Omitir / límite de intentos" }, { id: "timeout", label: "Sin respuesta" }];
    case "condition": return [{ id: "yes", label: "Sí" }, { id: "no", label: "No" }];
    case "randomizer": return node.data.branches.map((b) => ({ id: `branch.${b.id}`, label: `${b.label} (${b.weight}%)` }));
    case "action": return [{ id: "next", label: "Continuar" }, { id: "error", label: "Error" }];
    default: return [{ id: "next", label: "Continuar" }];
  }
}

export function validateFlowDefinition(value: unknown): FlowValidationResult {
  const parsed = flowDefinitionSchema.safeParse(value);
  if (!parsed.success) return { valid: false, issues: parsed.error.issues.map((issue) => {
    const input = value as { nodes?: { id?: unknown }[] } | null;
    const nodeId = issue.path[0] === "nodes" && typeof issue.path[1] === "number" ? input?.nodes?.[issue.path[1]]?.id : undefined;
    const names: Record<string, string> = { text: "Mensaje", url: "Dirección", label: "Nombre", fieldKey: "Campo", prompt: "Pregunta", retryMessage: "Texto de reintento", options: "Opciones", nodes: "Pasos", edges: "Conexiones", maxAttempts: "Intentos", timeoutMinutes: "Tiempo de espera", weight: "Porcentaje", minutes: "Duración", until: "Fecha", buttons: "Botones", quickReplies: "Respuestas rápidas" };
    const field = [...issue.path].reverse().find((part) => typeof part === "string");
    const name = names[String(field)] ?? "Este paso";
    const message = issue.code === "custom" ? issue.message
      : issue.code === "too_big" ? `${name}: el máximo permitido es ${String(issue.maximum)}.`
      : issue.code === "too_small" ? `${name}: completá un valor válido; el mínimo es ${String(issue.minimum)}.`
      : `${name}: revisá el formato del valor ingresado.`;
    return { ...(typeof nodeId === "string" ? { nodeId } : {}), message };
  }) };
  const definition = parsed.data as FlowDefinition;
  const issues: FlowIssue[] = [];
  const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
  const add = (message: string, nodeId?: string) => issues.push({ message, ...(nodeId ? { nodeId } : {}) });
  if (nodes.size !== definition.nodes.length) add("Hay pasos con el mismo identificador.");
  if (new Set(definition.edges.map((edge) => edge.id)).size !== definition.edges.length) add("Hay conexiones con el mismo identificador.");
  if (nodes.get(definition.entryNodeId)?.type !== "start") add("El flujo debe comenzar en un bloque de inicio.");
  if (definition.nodes.filter((node) => node.type === "start").length !== 1) add("Debe haber un solo inicio.");
  const handles = new Set<string>();
  for (const edge of definition.edges) {
    const source = nodes.get(edge.source);
    if (!source || !nodes.has(edge.target)) { add("Una conexión apunta a un paso inexistente.", edge.source); continue; }
    if (nodes.get(edge.target)?.type === "start") add("Una conexión no puede volver al inicio.", edge.source);
    if (!getNodePorts(source).some((port) => port.id === edge.sourceHandle)) add("La salida de esta conexión no existe.", edge.source);
    const key = `${edge.source}/${edge.sourceHandle}`;
    if (handles.has(key)) add("Cada salida puede tener una sola conexión.", edge.source);
    handles.add(key);
  }
  for (const node of definition.nodes) {
    const connected = (port: string) => definition.edges.some((edge) => edge.source === node.id && edge.sourceHandle === port);
    if (node.type === "end") continue;
    if (node.type === "message") {
      const buttons = [...node.data.buttons, ...(node.data.quickReplies ?? [])];
      if (node.data.buttons.length && node.data.quickReplies?.length) add("Elegí botones o respuestas rápidas en el mensaje.", node.id);
      if (new Set(buttons.map((b) => b.id)).size !== buttons.length) add("Los botones deben tener identificadores diferentes.", node.id);
      if (buttons.some((b) => b.kind === "url" && !b.url)) add("Completá el enlace de cada botón web.", node.id);
      if (node.data.quickReplies?.some((b) => b.kind === "url")) add("Una respuesta rápida continúa el flujo; no abre una web.", node.id);
      if (buttons.length && (node.data.blocks.length !== 1 || node.data.blocks[0].type !== "text")) add("Los botones y respuestas rápidas deben estar en un mensaje con un solo bloque de texto.", node.id);
      if (buttons.length && node.data.blocks[0]?.type === "text" && node.data.blocks[0].text.length > 640) add("El texto con botones admite hasta 640 caracteres.", node.id);
      for (const item of node.data.blocks) if (item.type === "text" && new TextEncoder().encode(item.text).length > 1000) add("El mensaje supera el límite de 1000 bytes de Instagram; dividilo en varios bloques.", node.id);
      const continues = buttons.filter((b) => b.kind === "continue");
      for (const b of continues) if (!connected(`button.${b.id}`)) add(`Conectá el botón «${b.label}».`, node.id);
      if (!connected("next") && !continues.length) add("Conectá la continuación del mensaje.", node.id);
    } else if (node.type === "condition") {
      if (!connected("yes") || !connected("no")) add("Conectá los caminos sí y no.", node.id);
    } else if (node.type === "input") {
      if (["username", "comment"].includes(node.data.fieldKey)) add("Ese nombre está reservado. Elegí otro campo para guardar la respuesta.", node.id);
      if ([node.data.prompt, node.data.retryMessage].some((text) => new TextEncoder().encode(text).length > 1000)) add("La pregunta y su mensaje de reintento admiten hasta 1000 bytes; acortá el texto.", node.id);
      if (!connected("answered") || !connected("skip") || !connected("timeout")) add("Conectá respuesta válida, omitir y sin respuesta.", node.id);
      if (node.data.inputType === "choice" && !node.data.options?.length) add("Agregá las opciones de respuesta.", node.id);
    } else if (node.type === "randomizer") {
      if (Math.abs(node.data.branches.reduce((sum, b) => sum + b.weight, 0) - 100) > 0.01) add("Los porcentajes deben sumar 100.", node.id);
      if (new Set(node.data.branches.map((b) => b.id)).size !== node.data.branches.length) add("Las variantes deben tener identificadores diferentes.", node.id);
      for (const b of node.data.branches) if (!connected(`branch.${b.id}`)) add(`Conectá la variante «${b.label}».`, node.id);
    } else if (!connected("next") && !(node.type === "action" && ["pause", "handoff"].includes(node.data.action))) add("Conectá el siguiente paso.", node.id);
    if (node.type === "action") {
      const data = node.data;
      if (["add_tag", "remove_tag"].includes(data.action) && !data.tag?.trim()) add("Ingresá una etiqueta.", node.id);
      if (["set_field", "clear_field", "increment_field"].includes(data.action) && !data.fieldKey) add("Elegí un campo de destino.", node.id);
      if (data.action === "increment_field" && !Number.isFinite(Number(data.value))) add("El incremento debe ser numérico.", node.id);
      if (data.action === "increment_field" && ["email", "phone"].includes(data.fieldKey ?? "")) add("El incremento necesita un campo numérico, como cantidad o puntos.", node.id);
      if (["set_field", "clear_field", "increment_field"].includes(data.action) && ["username", "comment"].includes(data.fieldKey ?? "")) add("Ese nombre está reservado. Elegí otro campo.", node.id);
      if (data.action === "webhook" && !data.url) add("Ingresá la dirección del webhook.", node.id);
      if (["webhook", "start_flow"].includes(data.action) && !connected("error")) add("Conectá el camino de error para poder resolver una integración que falle.", node.id);
      if (data.action === "start_flow" && !data.automationId) add("Elegí la campaña del flujo que querés iniciar.", node.id);
    }
  }
  const reached = new Set<string>();
  const pending = [definition.entryNodeId];
  while (pending.length) {
    const id = pending.pop()!;
    if (reached.has(id)) continue;
    reached.add(id);
    pending.push(...definition.edges.filter((edge) => edge.source === id).map((edge) => edge.target));
  }
  for (const node of definition.nodes) if (!reached.has(node.id)) add("Este paso no está conectado con el inicio.", node.id);
  if (!definition.nodes.some((node) => node.type === "end" && reached.has(node.id))) add("Agregá un bloque finalizar conectado al flujo.");
  // An initial private reply has a narrower format than an open conversation.
  const beforeReply = [definition.entryNodeId];
  const visited = new Set<string>();
  while (beforeReply.length) {
    const id = beforeReply.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = nodes.get(id);
    if (!node) continue;
    if (node.type === "message") {
      if (node.data.blocks.length !== 1 || node.data.blocks[0].type !== "text") add("La apertura del comentario debe tener un bloque de texto. Los demás contenidos se envían después de una respuesta.", id);
      if (node.data.buttons.length || node.data.quickReplies?.length) add("La apertura debe pedir una respuesta por texto. Agregá botones después de esa respuesta.", id);
      continue;
    }
    if (node.type === "input") { add("Agregá un mensaje de apertura antes de pedir datos.", id); continue; }
    beforeReply.push(...definition.edges.filter((edge) => edge.source === id).map((edge) => edge.target));
  }
  return { valid: issues.length === 0, issues };
}

export function createDefaultFlow(campaign?: FlowCampaignSource): FlowDefinition {
  return createFlowFromCampaign(campaign);
}
