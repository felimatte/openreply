import type { FlowDefinition } from "@/lib/flows/definition";

export type BuilderNode = FlowDefinition["nodes"][number];
export type NodeKind = BuilderNode["type"];
export type FlowButton = { id: string; label: string; kind: "continue" | "url"; url?: string };
export type MessageBlock = { type: "text"; text: string } | { type: "image" | "video" | "audio" | "pdf"; url: string; name?: string };
export type MessageData = { blocks: MessageBlock[]; buttons: FlowButton[]; quickReplies?: FlowButton[] };
export type InputData = { prompt: string; inputType: "email" | "phone" | "text" | "number" | "choice"; fieldKey: string; retryMessage: string; maxAttempts: number; timeoutMinutes: number; options?: string[] };
export type Rule = { field: string; operator: "equals" | "not_equals" | "contains" | "exists" | "not_exists" | "greater_than" | "less_than"; value?: string };
export type ConditionData = { rules: Rule[]; match: "all" | "any" };
export type ActionData = { action: "add_tag" | "remove_tag" | "set_field" | "clear_field" | "increment_field" | "webhook" | "goal" | "pause" | "handoff" | "start_flow"; tag?: string; fieldKey?: string; value?: string; url?: string; automationId?: string; note?: string };
export type RandomizerData = { branches: { id: string; label: string; weight: number }[] };

export const NODE_CATALOG: { type: NodeKind; title: string; description: string; icon: string; color: string }[] = [
  { type: "start", title: "Comentario de Reel", description: "Entrada desde tu campaña", icon: "↳", color: "#ff7a4a" },
  { type: "message", title: "Mensaje", description: "Texto, archivos y botones", icon: "☏", color: "#9a75ff" },
  { type: "input", title: "Pedir un dato", description: "Email, teléfono o respuesta", icon: "?", color: "#ff3e92" },
  { type: "condition", title: "Condición", description: "Elegir un camino según datos", icon: "◇", color: "#ffd166" },
  { type: "delay", title: "Espera", description: "Continuar después de un tiempo", icon: "◷", color: "#66d3dd" },
  { type: "action", title: "Acción", description: "Etiquetas, campos e integraciones", icon: "⚡", color: "#a2e79a" },
  { type: "randomizer", title: "Repartir caminos", description: "Distribuir contactos por porcentaje", icon: "⑂", color: "#ff9869" },
  { type: "end", title: "Finalizar", description: "Terminar este recorrido", icon: "■", color: "#b6a5b2" },
];

export const ACTION_LABELS: Record<ActionData["action"], string> = {
  add_tag: "Agregar etiqueta", remove_tag: "Quitar etiqueta", set_field: "Guardar campo", clear_field: "Vaciar campo", increment_field: "Incrementar campo", webhook: "Enviar solicitud a una URL", goal: "Registrar objetivo", pause: "Pausar automatización", handoff: "Derivar a una persona", start_flow: "Iniciar otro flujo",
};

export function uid(prefix = "node") { return `${prefix}_${crypto.randomUUID().slice(0, 12)}`; }
export function cloneFlow(flow: FlowDefinition): FlowDefinition { return structuredClone(flow); }

export function createNode(type: NodeKind, position = { x: 180, y: 120 }): BuilderNode {
  const defaults: Record<NodeKind, unknown> = {
    start: {}, end: {}, message: { blocks: [{ type: "text", text: "¡Hola! Tocá el botón para recibir el recurso." }], buttons: [{ id: uid("button"), label: "Quiero recibirlo", kind: "continue" }] },
    input: { prompt: "¿Cuál es tu email?", inputType: "email", fieldKey: "email", retryMessage: "Revisá el dato e intentá de nuevo.", maxAttempts: 3, timeoutMinutes: 30 },
    condition: { rules: [{ field: "follows", operator: "equals", value: "true" }], match: "all" },
    delay: { minutes: 10 }, action: { action: "add_tag", tag: "Interesado" }, randomizer: { branches: [{ id: "a", label: "Camino A", weight: 50 }, { id: "b", label: "Camino B", weight: 50 }] },
  };
  return { id: uid(), type, label: NODE_CATALOG.find((item) => item.type === type)!.title, position, data: defaults[type] } as BuilderNode;
}

export function ports(node: BuilderNode): { id: string; label: string }[] {
  if (node.type === "end") return [];
  if (node.type === "condition") return [{ id: "yes", label: "Sí" }, { id: "no", label: "No" }];
  if (node.type === "input") return [{ id: "answered", label: "Dato recibido" }, { id: "skip", label: "Omitir" }, { id: "timeout", label: "Sin respuesta" }];
  if (node.type === "randomizer") return (node.data as RandomizerData).branches.map((branch) => ({ id: `branch.${branch.id}`, label: `${branch.label} · ${branch.weight}%` }));
  if (node.type === "message") {
    const data = node.data as MessageData;
    return [...[...(data.buttons ?? []), ...(data.quickReplies ?? [])].filter((button) => button.kind === "continue").map((button) => ({ id: `button.${button.id}`, label: button.label || "Botón" })), { id: "next", label: "Continuar / respuesta escrita" }];
  }
  return node.type === "action" ? [{ id: "next", label: "Continuar" }, { id: "error", label: "Si ocurre un error" }] : [{ id: "next", label: "Continuar" }];
}

export function nodeSummary(node: BuilderNode): string {
  if (node.type === "message") return (node.data as MessageData).blocks.map((block) => block.type === "text" ? block.text : `${block.type}: ${block.name || block.url}`).join("\n").slice(0, 110);
  if (node.type === "input") return (node.data as InputData).prompt;
  if (node.type === "condition") return `${(node.data as ConditionData).rules.length} condición(es)`;
  if (node.type === "delay") return `${(node.data as { minutes: number }).minutes} minutos`;
  if (node.type === "action") { const data = node.data as ActionData; return `${ACTION_LABELS[data.action]}${data.tag ? `: ${data.tag}` : data.fieldKey ? `: ${data.fieldKey}` : ""}`; }
  if (node.type === "start") return "Usa el Reel y las palabras de esta campaña";
  if (node.type === "end") return "El recorrido termina acá";
  return "Distribución por porcentaje";
}

export function createTemplate(kind: "resource" | "lead" | "qualification"): FlowDefinition {
  const start = createNode("start", { x: 80, y: 170 });
  const opening = createNode("message", { x: 380, y: 170 });
  opening.data = { blocks: [{ type: "text", text: "¡Hola! Respondé SI y te envío el recurso." }], buttons: [] };
  const end = createNode("end", { x: 1580, y: 170 });
  const reveal = createNode("message", { x: 1280, y: 170 });
  reveal.label = "Entregar recurso";
  reveal.data = { blocks: [{ type: "text", text: "Acá está tu recurso. ¡Espero que te sirva!" }], buttons: [{ id: uid("button"), label: "Abrir recurso", kind: "url", url: "https://example.com/recurso" }] };
  const nodes = [start, opening];
  const edges: FlowDefinition["edges"] = [{ id: uid("edge"), source: start.id, target: opening.id, sourceHandle: "next" }];
  let previous = opening;
  let handle = "next";
  if (kind !== "resource") {
    const input = createNode("input", { x: 680, y: 170 });
    nodes.push(input);
    edges.push({ id: uid("edge"), source: previous.id, target: input.id, sourceHandle: handle });
    previous = input; handle = "answered";
    edges.push({ id: uid("edge"), source: input.id, target: end.id, sourceHandle: "timeout" }, { id: uid("edge"), source: input.id, target: reveal.id, sourceHandle: "skip" });
  }
  const tag = createNode("action", { x: kind === "resource" ? 680 : 980, y: 170 });
  tag.data = { action: "add_tag", tag: kind === "resource" ? "Recurso solicitado" : "Lead de Reel" };
  nodes.push(tag, reveal, end);
  edges.push({ id: uid("edge"), source: previous.id, target: tag.id, sourceHandle: handle }, { id: uid("edge"), source: tag.id, target: reveal.id, sourceHandle: "next" }, { id: uid("edge"), source: reveal.id, target: end.id, sourceHandle: "next" });
  if (kind === "qualification") {
    const condition = createNode("condition", { x: 1280, y: 420 });
    condition.label = "¿Ya es cliente?"; condition.data = { rules: [{ field: "tag", operator: "contains", value: "Cliente" }], match: "all" };
    const human = createNode("action", { x: 1580, y: 420 }); human.data = { action: "handoff", note: "Contacto interesado desde Reel" };
    const targetEdge = edges.find((edge) => edge.source === tag.id)!; targetEdge.target = condition.id;
    edges.push({ id: uid("edge"), source: condition.id, target: human.id, sourceHandle: "yes" }, { id: uid("edge"), source: condition.id, target: reveal.id, sourceHandle: "no" });
    nodes.push(condition, human);
  }
  return { schemaVersion: 1, entryNodeId: start.id, nodes, edges, viewport: { x: 20, y: 50, zoom: 0.65 } };
}
