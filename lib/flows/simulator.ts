import type { FlowDefinition, FlowNode, FlowConditionRule, FlowInputData, FlowButton } from "./definition";
import { compareFlowValue, parseFlowAnswer, renderFlowText } from "./runtime-values";
import { formatDelayDuration } from "./duration";

const ACTION_NAMES: Record<string, string> = { add_tag: "Etiqueta agregada", remove_tag: "Etiqueta quitada", set_field: "Campo guardado", clear_field: "Campo vaciado", increment_field: "Campo incrementado", goal: "Objetivo registrado", pause: "Automatización pausada", handoff: "Conversación derivada a una persona" };

export type SimulationEvent = { id: number; kind: "bot" | "user" | "action" | "warning"; text: string; nodeId?: string; media?: { type: string; url: string; name?: string }; buttons?: FlowButton[] };
export interface SimulationState {
  events: SimulationEvent[]; fields: Record<string, string>; tags: string[]; nodeId: string | null;
  waiting: "message" | "input" | "delay" | null; finished: boolean; hasSentOpening: boolean;
  windowMinutesRemaining: number | null; attempts: number; steps: number;
}
export function simulationRuleMatches(rule: FlowConditionRule, fields: Record<string, string>, tags: string[]): boolean {
  const actual = rule.field === "tag" ? tags.some((tag) => tag.toLowerCase() === rule.value?.toLowerCase()) ? rule.value : undefined : fields[rule.field];
  return compareFlowValue(actual, rule.operator, rule.value);
}
export function validSimulationInput(data: FlowInputData, text: string): boolean {
  return parseFlowAnswer(data.inputType, text, data.options?.map((label) => ({ label })) || []).ok;
}
function add(state: SimulationState, kind: SimulationEvent["kind"], text: string, nodeId?: string, media?: SimulationEvent["media"]) {
  state.events.push({ id: state.events.length + 1, kind, text, nodeId, media });
}
function next(definition: FlowDefinition, state: SimulationState, node: FlowNode, handle: string) {
  state.nodeId = definition.edges.find((edge) => edge.source === node.id && edge.sourceHandle === handle)?.target ?? null;
  if (!state.nodeId) { add(state, "warning", `La salida «${handle}» no tiene conexión.`, node.id); state.finished = true; }
}
function personalize(text: string, fields: Record<string, string>) { return renderFlowText(text, fields); }

export function advanceSimulation(definition: FlowDefinition, previous: SimulationState, random: () => number = Math.random): SimulationState {
  const state = structuredClone(previous);
  for (let turn = 0; turn < 50 && state.nodeId && !state.waiting && !state.finished; turn++) {
    state.steps++;
    const node = definition.nodes.find((item) => item.id === state.nodeId);
    if (!node) { add(state, "warning", "El paso de destino no existe."); state.finished = true; break; }
    switch (node.type) {
      case "start": next(definition, state, node, "next"); break;
      case "end": add(state, "action", "Recorrido finalizado.", node.id); state.finished = true; break;
      case "message": {
        if (state.hasSentOpening && (state.windowMinutesRemaining === null || state.windowMinutesRemaining <= 0)) { add(state, "warning", "La ventana de 24 horas está cerrada. Este mensaje no se enviaría.", node.id); state.finished = true; break; }
        for (const block of node.data.blocks) add(state, "bot", block.type === "text" ? personalize(block.text, state.fields) : block.name || block.type, node.id, block.type === "text" ? undefined : block);
        if (state.events.at(-1)) state.events.at(-1)!.buttons = [...node.data.buttons, ...(node.data.quickReplies || [])];
        if (!state.hasSentOpening) { state.hasSentOpening = true; state.waiting = "message"; add(state, "action", "Esperando una respuesta para habilitar la conversación.", node.id); }
        else if ([...node.data.buttons, ...(node.data.quickReplies || [])].some((button) => button.kind === "continue")) state.waiting = "message";
        else next(definition, state, node, "next");
        break;
      }
      case "input": add(state, "bot", personalize(node.data.prompt, state.fields), node.id); state.waiting = "input"; state.attempts = 0; break;
      case "delay": add(state, "action", node.data.until ? `Espera hasta ${node.data.until}.` : `Espera de ${formatDelayDuration(node.data)}.`, node.id); state.waiting = "delay"; break;
      case "condition": { const values = { ...state.fields, window_open: String(state.windowMinutesRemaining !== null && state.windowMinutesRemaining > 0) }; const results = node.data.rules.map((rule) => simulationRuleMatches(rule, values, state.tags)); const matches = node.data.match === "all" ? results.every(Boolean) : results.some(Boolean); add(state, "action", `Condición: ${matches ? "sí" : "no"}.`, node.id); next(definition, state, node, matches ? "yes" : "no"); break; }
      case "randomizer": { const value = random() * 100; let sum = 0; const branch = node.data.branches.find((item) => { sum += item.weight; return value < sum; }) || node.data.branches.at(-1); if (!branch) { state.finished = true; break; } add(state, "action", `Variante: ${branch.label}.`, node.id); next(definition, state, node, `branch.${branch.id}`); break; }
      case "action": {
        const data = node.data;
        if (data.action === "add_tag" && data.tag && !state.tags.includes(data.tag)) state.tags.push(data.tag);
        if (data.action === "remove_tag") state.tags = state.tags.filter((tag) => tag !== data.tag);
        if (data.action === "set_field" && data.fieldKey) state.fields[data.fieldKey] = personalize(data.value || "", state.fields);
        if (data.action === "clear_field" && data.fieldKey) state.fields[data.fieldKey] = "";
        if (data.action === "increment_field" && data.fieldKey) state.fields[data.fieldKey] = String(Number(state.fields[data.fieldKey] || 0) + Number(personalize(data.value || "1", state.fields)));
        add(state, "action", data.action === "webhook" ? `Simulación de solicitud a ${data.url}.` : data.action === "start_flow" ? `Derivación al flujo ${data.automationId} (se prueba por separado).` : `${ACTION_NAMES[data.action] || data.action}${data.tag ? `: ${data.tag}` : data.fieldKey ? `: ${data.fieldKey}` : data.note ? `: ${data.note}` : ""}`, node.id);
        if (["pause", "handoff"].includes(data.action)) state.finished = true;
        else next(definition, state, node, "next");
        break;
      }
    }
    if (turn === 49 && !state.waiting && !state.finished) { add(state, "warning", "El recorrido repite demasiados pasos sin una pausa. Revisá las conexiones."); state.finished = true; }
  }
  return state;
}

export function startSimulation(definition: FlowDefinition, fields: Record<string, string> = { username: "felipe", follows: "true", comment: "GUIA" }): SimulationState {
  return advanceSimulation(definition, { events: [], fields, tags: [], nodeId: definition.entryNodeId, waiting: null, finished: false, hasSentOpening: false, windowMinutesRemaining: null, attempts: 0, steps: 0 });
}
export function respondSimulation(definition: FlowDefinition, previous: SimulationState, response: { text?: string; handle?: string }): SimulationState {
  const state = structuredClone(previous), node = definition.nodes.find((item) => item.id === state.nodeId);
  if (!node || state.finished || !state.waiting) return state;
  if (state.waiting === "delay" && node.type === "delay") {
    const minutes = node.data.until ? Math.max(0, (Date.parse(node.data.until) - Date.now()) / 60000) : node.data.minutes;
    if (state.windowMinutesRemaining !== null) state.windowMinutesRemaining -= minutes;
    state.waiting = null; next(definition, state, node, "next");
  } else if (state.waiting === "input" && node.type === "input") {
    const skipped = response.handle === "skip" || ["omitir", "skip"].includes((response.text || "").trim().toLowerCase());
    if (skipped || response.handle === "timeout") { add(state, "action", skipped ? "Dato omitido." : "Tiempo de respuesta agotado.", node.id); state.waiting = null; next(definition, state, node, skipped ? "skip" : "timeout"); }
    else {
      const text = response.text || ""; add(state, "user", text, node.id); state.windowMinutesRemaining = 1440;
      const answer = parseFlowAnswer(node.data.inputType, text, node.data.options?.map((label) => ({ label })) || []);
      if (!answer.ok) { state.attempts++; if (state.attempts >= node.data.maxAttempts) { add(state, "action", "Se alcanzó el límite de intentos.", node.id); state.waiting = null; next(definition, state, node, "skip"); } else add(state, "bot", personalize(node.data.retryMessage || "Revisá el dato e intentá de nuevo.", state.fields), node.id); }
      else { state.fields[node.data.fieldKey] = answer.value; state.fields.last_input = text.trim(); state.waiting = null; next(definition, state, node, "answered"); }
    }
  } else if (state.waiting === "message" && node.type === "message") {
    const allButtons = [...node.data.buttons, ...(node.data.quickReplies || [])];
    const continues = allButtons.filter((item) => item.kind === "continue");
    const button = response.handle ? allButtons.find((item) => `button.${item.id}` === response.handle) : continues.find((item) => item.label.trim().toLowerCase() === response.text?.trim().toLowerCase());
    if (button?.kind === "url") { state.fields[`clicked:${button.id}`] = "true"; add(state, "action", `Abriría ${button.url}. Un enlace no habilita la conversación.`, node.id); return state; }
    add(state, "user", button?.label || response.text || "Continuar", node.id); state.windowMinutesRemaining = 1440; state.fields.last_input = response.text || button?.label || "";
    const handle = button ? `button.${button.id}` : definition.edges.some((edge) => edge.source === node.id && edge.sourceHandle === "next") ? "next" : continues.length === 1 ? `button.${continues[0].id}` : "";
    if (!handle) { add(state, "warning", "Elegí una de las opciones para continuar este recorrido.", node.id); return state; }
    state.waiting = null; next(definition, state, node, handle);
  }
  return advanceSimulation(definition, state);
}

export function clickSimulationLink(previous: SimulationState, nodeId: string, button: FlowButton): SimulationState {
  const state = structuredClone(previous);
  state.fields[`clicked:${button.id}`] = "true";
  add(state, "action", `Abriría ${button.url}. El enlace no renueva la ventana de mensajes.`, nodeId);
  return state;
}
