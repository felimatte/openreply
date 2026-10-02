import type { FlowDefinition, FlowNode } from "./definition";

type LegacyLink = { destinationUrl?: string; url?: string; label?: string | null };

/** The saved campaign settings, without database or server dependencies. */
export interface FlowCampaignSource {
  dmMessage?: string | null;
  openingDmEnabled?: boolean | null;
  openingDmMessage?: string | null;
  linkButtonLabel?: string | null;
  trackedLinks?: LegacyLink[];
  links?: LegacyLink[];
  requireFollow?: boolean | null;
  followPromptMessage?: string | null;
  followPromptButtonLabel?: string | null;
  askEnabled?: boolean | null;
  askType?: "EMAIL" | "PHONE" | "TEXT" | null;
  askFieldKey?: string | null;
  askMessage?: string | null;
  askRetryMessage?: string | null;
  askAfterLink?: boolean | null;
  askThanksMessage?: string | null;
  followUpEnabled?: boolean | null;
  followUpMessage?: string | null;
  followUpDelayMinutes?: number | null;
  contactTags?: string[];
}

type MessageNode = Extract<FlowNode, { type: "message" }>;
type Sequence = { first: string; last: string };
const encoder = new TextEncoder();
const RESPONSE_INSTRUCTION = "Respondé SI para continuar.";

/** Keep Unicode characters and ordinary template variables together. */
function units(text: string): string[] {
  return text.match(/\{\{[^{}]*\}\}|\{[^{}]*\}|[\s\S]/gu) ?? [];
}

function splitText(text: string, byteLimit = 1000, characterLimit = 1000): string[] {
  const chunks: string[] = [];
  let chunk = "", bytes = 0;
  for (const unit of units(text)) {
    const parts = encoder.encode(unit).length > byteLimit || unit.length > characterLimit ? Array.from(unit) : [unit];
    for (const part of parts) {
      const size = encoder.encode(part).length;
      if (chunk && (bytes + size > byteLimit || chunk.length + part.length > characterLimit)) {
        chunks.push(chunk); chunk = ""; bytes = 0;
      }
      chunk += part; bytes += size;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

/** A button message has a smaller character limit than the preceding texts. */
function messageChunks(text: string, withButtons: boolean): string[] {
  if (!withButtons) return splitText(text);
  const parts = units(text);
  let tail = "", bytes = 0;
  while (parts.length) {
    const part = parts.at(-1)!;
    const size = encoder.encode(part).length;
    if (tail && (bytes + size > 1000 || tail.length + part.length > 640)) break;
    if (size > 1000 || part.length > 640) {
      const shorter = Array.from(part);
      parts.pop(); parts.push(...shorter); continue;
    }
    parts.pop(); tail = part + tail; bytes += size;
  }
  return [...splitText(parts.join("")), ...(tail ? [tail] : [])];
}

function legacyText(text: string): string {
  // Classic campaigns put {link} in the text and render the destination in a
  // separate button. The visual engine does not have a contact field "link".
  return text.replace(/\{username\}/gi, "{username}").replace(/\s*\{link\}\s*/gi, " ").trim();
}

function webButtonUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return value.length <= 2048 && url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}

/**
 * Prepare a reviewable draft from the simple editor. Publishing is a separate
 * action. Existing entry settings and contact tags remain on the campaign;
 * the worker applies those tags when the contact enters either kind of flow.
 */
export function createFlowFromCampaign(campaign?: FlowCampaignSource): FlowDefinition {
  const definition: FlowDefinition = { schemaVersion: 1, entryNodeId: "start", nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 0.8 } };
  let column = 0;
  const position = () => ({ x: 80 + column++ * 310, y: 120 });
  const connect = (source: string, target: string, sourceHandle = "next") => {
    definition.edges.push({ id: `${source}_${sourceHandle.replace(/[^a-zA-Z0-9_-]/g, "_")}_${target}`, source, target, sourceHandle });
  };
  const messages = (baseId: string, label: string, text: string, buttons: MessageNode["data"]["buttons"] = [], branchY?: number): Sequence => {
    const chunks = messageChunks(text || "Continuemos.", !!buttons.length);
    const ids = chunks.map((_, index) => index === chunks.length - 1 ? baseId : `${baseId}_part_${index + 1}`);
    chunks.forEach((chunk, index) => {
      const point = position();
      definition.nodes.push({ id: ids[index], type: "message", label: chunks.length > 1 ? `${label} (${index + 1}/${chunks.length})` : label, position: branchY === undefined ? point : { ...point, y: branchY }, data: { blocks: [{ type: "text", text: chunk }], buttons: index === chunks.length - 1 ? buttons : [] } });
      if (index) connect(ids[index - 1], ids[index]);
    });
    return { first: ids[0], last: ids.at(-1)! };
  };

  definition.nodes.push({ id: "start", type: "start", label: "Comentario en Reel", position: position(), data: {} });
  const savedOpening = campaign?.openingDmEnabled !== false ? campaign?.openingDmMessage?.trim().replace(/\{username\}/gi, "{username}") : "";
  const openingBody = savedOpening || "¡Hola! Te envío la información que pediste.";
  const hasInstruction = /respond\S*\s+["'«]?s[ií]\b/i.test(openingBody);
  const instruction = `\n\n${RESPONSE_INSTRUCTION}`;
  const openingChunks = splitText(openingBody, 1000 - encoder.encode(instruction).length);
  const opening = messages("opening", "Abrir conversación", openingChunks[0] + (hasInstruction && openingChunks.length === 1 ? "" : instruction));
  connect("start", opening.first);
  let previous = opening.last;
  if (openingChunks.length > 1) {
    const remainder = messages("opening_details", "Completar apertura", openingChunks.slice(1).join(""));
    connect(previous, remainder.first); previous = remainder.last;
  }

  let gateId: string | undefined;
  if (campaign?.requireFollow) {
    gateId = "follow_check";
    definition.nodes.push({ id: gateId, type: "condition", label: "¿Falta que nos siga?", position: position(), data: { match: "all", rules: [{ field: "follows", operator: "equals", value: "false" }] } });
    connect(previous, gateId);
    const label = splitText(campaign.followPromptButtonLabel?.trim() || "Ya te sigo", 1000, 20)[0];
    const prompt = messages("follow_prompt", "Pedir que nos siga", legacyText(campaign.followPromptMessage || "Seguinos y tocá «Ya te sigo» para continuar."), [{ id: "followed", label, kind: "continue" }], 420);
    connect(gateId, prompt.first, "yes");
    connect(prompt.last, gateId, "button.followed");
    connect(prompt.last, gateId); // Typed replies also recheck; they never bypass the gate.
    previous = gateId;
  }
  let previousHandle = gateId ? "no" : "next";

  const askType = campaign?.askType;
  const askText = legacyText(campaign?.askMessage || "");
  const canAsk = campaign?.askEnabled && askType && askText && (askType !== "TEXT" || !!campaign.askFieldKey);
  const afterLink = !!campaign?.askAfterLink;
  let question: Sequence | undefined;
  const addQuestion = (): Sequence => {
    const chunks = splitText(askText);
    let lead: Sequence | undefined;
    if (chunks.length > 1) lead = messages("question_details", "Presentar pregunta", chunks.slice(0, -1).join(""));
    definition.nodes.push({ id: "question", type: "input", label: askType === "EMAIL" ? "Pedir email" : askType === "PHONE" ? "Pedir teléfono" : "Pedir un dato", position: position(), data: {
      prompt: chunks.at(-1)!, inputType: askType === "EMAIL" ? "email" : askType === "PHONE" ? "phone" : "text",
      fieldKey: askType === "EMAIL" ? "email" : askType === "PHONE" ? "phone" : campaign!.askFieldKey!,
      retryMessage: splitText(legacyText(campaign?.askRetryMessage || askText))[0] || "Revisá el dato e intentá de nuevo.",
      maxAttempts: 3, timeoutMinutes: !afterLink && askType !== "TEXT" ? 10080 : 1440,
    } });
    if (lead) connect(lead.last, "question");
    return { first: lead?.first || "question", last: "question" };
  };
  if (canAsk && !afterLink) {
    question = addQuestion(); connect(previous, question.first, previousHandle);
    previous = question.last; previousHandle = "answered";
  }

  const links = campaign?.trackedLinks ?? campaign?.links ?? [];
  const buttons: MessageNode["data"]["buttons"] = [];
  const inlineLinks: string[] = [];
  links.forEach((link, index) => {
    const destination = link.destinationUrl || link.url;
    if (!destination) return;
    const title = link.label?.trim() || campaign?.linkButtonLabel?.trim() || "Abrir enlace";
    if (buttons.length < 3 && webButtonUrl(destination)) buttons.push({ id: `link_${index}`, label: splitText(title, 1000, 20)[0], kind: "url", url: destination });
    else inlineLinks.push(`${title}: ${destination}`);
  });
  const resourceText = legacyText(campaign?.dmMessage || "") || "Acá tenés la información que pediste.";
  const resource = messages("resource", "Enviar información", [resourceText, ...inlineLinks].join("\n\n"), buttons);
  connect(previous, resource.first, previousHandle);
  if (question && !afterLink) connect(question.last, resource.first, "skip");
  previous = resource.last; previousHandle = "next";

  let thanks: Sequence | undefined;
  if (canAsk && afterLink) {
    question = addQuestion(); connect(previous, question.first);
    previous = question.last; previousHandle = "answered";
    const thanksText = legacyText(campaign?.askThanksMessage || "");
    if (thanksText) {
      thanks = messages("thanks", "Agradecer respuesta", thanksText);
      connect(previous, thanks.first, previousHandle); previous = thanks.last; previousHandle = "next";
    }
  }

  let afterQuestionTarget: string | undefined;
  const followUpText = legacyText(campaign?.followUpMessage || "");
  if (campaign?.followUpEnabled && followUpText) {
    const minutes = campaign.followUpDelayMinutes ?? 0;
    definition.nodes.push({ id: "follow_up_delay", type: "delay", label: "Esperar para el seguimiento", position: position(), data: { minutes: Number.isFinite(minutes) ? Math.max(0, Math.min(10080, minutes)) : 0 } });
    connect(previous, "follow_up_delay", previousHandle);
    afterQuestionTarget = "follow_up_delay";
    const followUp = messages("follow_up", "Mensaje de seguimiento", followUpText);
    connect("follow_up_delay", followUp.first); previous = followUp.last; previousHandle = "next";
  }

  definition.nodes.push({ id: "end", type: "end", label: "Finalizar", position: position(), data: {} });
  connect(previous, "end", previousHandle);
  if (question) {
    connect(question.last, "end", "timeout");
    if (afterLink) connect(question.last, afterQuestionTarget || "end", "skip");
  }
  return definition;
}
