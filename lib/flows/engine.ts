import { createHash, randomUUID } from "node:crypto";
import type { Prisma, FlowRun, FlowStepRun } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { getRedisConnection } from "@/lib/queue/client";
import { addContactTags } from "@/lib/contacts/store";
import { enqueueContactSync } from "@/lib/contacts/sync";
import { createInstagramContext, getUserFollowStatus, sendCommentReply, MetaApiError, RateLimitError } from "@/lib/instagram/provider";
import { ZernioApiError, ZernioDeliveryUnconfirmedError } from "@/lib/zernio/client";
import { reserveDMSlot, releaseDMSlot } from "@/lib/utils/rate-limiter";
import { reserveWorkspaceDMSend, releaseWorkspaceDMReservation } from "@/lib/billing/usage";
import { parseFlowDefinition, type FlowDefinition, type FlowNode } from "./definition";
import { sendFlowMediaMessage, sendFlowTextMessage } from "./media";
import { executeFlowHttpAction, FlowHttpActionError } from "./http-action";
import { buildFlowTrackedUrl } from "./tracking";
import { enqueueFlowRun } from "./queue";
import { openingFallbackText } from "./opening-message";
import { compareFlowValue, flowButtonPayload, incomingEventTime, messagingWindowOpen, parseFlowAnswer, parseFlowButtonPayload, PRIVATE_REPLY_WINDOW_MS, renderFlowText, weightedBranch } from "./runtime-values";

const LEASE_MS = 60_000;
const MAX_STEPS = 500;
const ACTIVE = ["RUNNING", "WAITING", "WAITING_WINDOW", "PAUSED"];
type LoadedRun = Prisma.FlowRunGetPayload<{ include: { version: true; automation: true; contact: { include: { tags: { include: { tag: true } } } }; instagramAccount: true } }>;
type RunContext = {
  commenterId: string; commenterName?: string; commentText?: string; mediaId?: string; commentTimestamp?: number;
  initialSent?: boolean; depth?: number; visits?: Record<string, number>; totalSteps?: number;
  waitStartedAt?: number; waitNodeId?: string; waitVisit?: number; waitDefaultPort?: string;
  inputAttempts?: number; retryInput?: boolean; goals?: string[];
  publicReplies?: string[];
};
type EffectResult = { status: "CLAIMED" | "SENT" | "FAILED"; result?: unknown; startedAt?: number };
type StepOutput = { effects?: Record<string, EffectResult>; port?: string; waiting?: boolean; visitCounted?: boolean; openingMode?: "button" | "text" };
const INCLUDE = { version: true, automation: true, contact: { include: { tags: { include: { tag: true } } } }, instagramAccount: true } as const;
function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
function contextOf(run: FlowRun) { return run.context as unknown as RunContext; }
function outputOf(step: FlowStepRun): StepOutput { return (step.output ?? {}) as unknown as StepOutput; }
function errorText(error: unknown) { return error instanceof Error ? error.message : "No se pudo ejecutar el paso."; }
function uniqueError(error: unknown) { return typeof error === "object" && error !== null && "code" in error && error.code === "P2002"; }
function targetFor(definition: FlowDefinition, nodeId: string, port: string) { return definition.edges.find((edge) => edge.source === nodeId && edge.sourceHandle === port)?.target ?? null; }
function contactPaused(contact: LoadedRun["contact"]) { return contact.automationPaused && (!contact.automationPausedUntil || contact.automationPausedUntil > new Date()); }
function resumedStatus(run: Pick<FlowRun, "waitType">) { return run.waitType === "WINDOW" ? "WAITING_WINDOW" : run.waitType ? "WAITING" : "RUNNING"; }
class DeferredRun extends Error { constructor(public dueAt: Date, public status = "RUNNING") { super("Continuación pendiente"); } }
class UncertainEffect extends Error {}
class CancelledRun extends Error {}

/** One executor or inbound event may change a conversation at a time. The lock
 * is renewed while network calls are pending and checked before each effect. */
async function withContactLock<T>(contactId: string, task: (assertLease: () => Promise<void>) => Promise<T>): Promise<T> {
  const redis = getRedisConnection();
  const key = `flow:contact:${contactId}`;
  const token = randomUUID();
  if (await redis.set(key, token, "PX", LEASE_MS, "NX") !== "OK") throw new Error("La conversación está siendo procesada; se reintentará.");
  let lost = false;
  const renew = async () => {
    const renewed = await redis.eval("if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE',KEYS[1],ARGV[2]) else return 0 end", 1, key, token, LEASE_MS).catch(() => 0);
    if (!renewed) lost = true;
  };
  const timer = setInterval(() => void renew(), LEASE_MS / 3);
  try {
    return await task(async () => {
      if (lost || await redis.get(key) !== token) throw new Error("Se perdió la reserva de la conversación.");
    });
  } finally {
    clearInterval(timer);
    await redis.eval("if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end", 1, key, token).catch(() => {});
  }
}

export interface StartFlowInput {
  automationId: string; versionId?: string; instagramAccountId: string; contactId: string;
  commentId: string; commentText: string; commenterId: string; commenterName?: string; mediaId?: string; timestamp?: number;
  depth?: number; conversationOpen?: boolean;
}

export async function startFlowRun(input: StartFlowInput): Promise<FlowRun | null> {
  if (!input.conversationOpen && (!input.timestamp || !Number.isFinite(input.timestamp) || input.timestamp < 0)) return null;
  const automation = await prisma.automation.findFirst({ where: { id: input.automationId, instagramAccountId: input.instagramAccountId, isActive: true, flowEnabled: true } });
  if (!automation) return null;
  const versionId = input.versionId ?? automation.flowPublishedVersionId;
  if (!versionId) return null;
  const version = await prisma.flowVersion.findFirst({ where: { id: versionId, automationId: automation.id, workspaceId: automation.workspaceId } });
  const contact = await prisma.contact.findFirst({ where: { id: input.contactId, workspaceId: automation.workspaceId } });
  if (!version || !contact || (contact.automationPaused && (!contact.automationPausedUntil || contact.automationPausedUntil > new Date()))) return null;
  const definition = parseFlowDefinition(version.definition);
  let run = await prisma.flowRun.findUnique({ where: { automationId_commentId: { automationId: automation.id, commentId: input.commentId } } });
  if (!run) {
    const existingReply = input.conversationOpen ? null : await prisma.dmLog.findFirst({ where: { instagramAccountId: input.instagramAccountId, commentId: input.commentId, OR: [{ status: "SENT" }, { dmDeliveryUnconfirmed: true }] } });
    if (existingReply) return null;
    try {
      run = await prisma.flowRun.create({ data: {
        workspaceId: automation.workspaceId, automationId: automation.id, versionId, contactId: contact.id,
        instagramAccountId: input.instagramAccountId, commentId: input.commentId, currentNodeId: definition.entryNodeId,
        context: json({ commenterId: input.commenterId, commenterName: input.commenterName, commentText: input.commentText, mediaId: input.mediaId,
          commentTimestamp: input.timestamp ? incomingEventTime(input.timestamp) : undefined, depth: input.depth ?? 0, initialSent: input.conversationOpen ?? false, visits: {}, totalSteps: 0,
          publicReplies: automation.publicReplyEnabled ? (automation.publicReplyMessages.length ? automation.publicReplyMessages : automation.publicReplyMessage ? [automation.publicReplyMessage] : []) : [] }),
      } });
    } catch (error) {
      if (!uniqueError(error)) throw error;
      run = await prisma.flowRun.findUnique({ where: { automationId_commentId: { automationId: automation.id, commentId: input.commentId } } });
    }
  }
  if (!run) return null;
  if (!input.conversationOpen) {
    try {
      await prisma.dmLog.upsert({
        where: { automationId_commentId: { automationId: automation.id, commentId: input.commentId } },
        create: { workspaceId: automation.workspaceId, automationId: automation.id, instagramAccountId: input.instagramAccountId,
          commenterId: input.commenterId, commenterName: input.commenterName, commentId: input.commentId, commentText: input.commentText, status: "PENDING" }, update: {},
      });
    } catch (error) {
      // Prisma can emulate this compound upsert as read/create. Another ingress
      // may have created the exact same log after our read; its row is valid.
      if (!uniqueError(error)) throw error;
    }
  }
  // A lost queue add is recoverable because the run is already committed.
  await enqueueFlowRun(run.id).catch((error) => console.error("[Flows] Run awaits queue recovery:", run?.id, errorText(error)));
  return run;
}

function valuesFor(run: LoadedRun) {
  const fields = run.contact.fields && typeof run.contact.fields === "object" && !Array.isArray(run.contact.fields) ? run.contact.fields : {};
  return { ...fields, username: run.contact.username ?? contextOf(run).commenterName ?? "", email: run.contact.email ?? "", phone: run.contact.phone ?? "", comment: contextOf(run).commentText ?? "" };
}

/** The effect claim is committed before dispatch. A crash between dispatch and
 * acknowledgement stops for review instead of sending the same message twice. */
async function effect(run: LoadedRun, step: FlowStepRun, key: string, send: () => Promise<unknown>, assertLease: () => Promise<void>, kind: "private" | "dm" | "public" | "http") {
  let output = outputOf(await prisma.flowStepRun.findUniqueOrThrow({ where: { id: step.id } }));
  const previous = output.effects?.[key];
  if (previous?.status === "SENT") return previous.result;
  if (previous?.status === "CLAIMED") throw new UncertainEffect("Un envío anterior no fue confirmado. Revisá la conversación antes de continuar.");
  await assertLease();
  const freshRun = await prisma.flowRun.findUniqueOrThrow({ where: { id: run.id }, include: { automation: true } });
  if (!ACTIVE.includes(freshRun.status)) throw new CancelledRun("La ejecución fue detenida.");
  if (!freshRun.automation.isActive || !freshRun.automation.flowEnabled) throw new DeferredRun(new Date(Date.now() + 30_000), "PAUSED");
  const freshContact = await prisma.contact.findUniqueOrThrow({ where: { id: run.contactId } });
  if (freshContact.automationPaused && (!freshContact.automationPausedUntil || freshContact.automationPausedUntil > new Date())) throw new DeferredRun(new Date(Date.now() + 30_000), "PAUSED");
  if ((kind === "dm") && !messagingWindowOpen(freshContact.lastInboundAt)) throw new DeferredRun(new Date(Date.now() + 24 * 60 * 60_000), "WAITING_WINDOW");
  if (kind === "private") {
    const sourceTime = contextOf(run).commentTimestamp;
    if (!sourceTime || !Number.isFinite(sourceTime)) throw new Error("El comentario no tiene fecha original; no se pudo verificar el permiso de respuesta privada.");
    if (Date.now() - sourceTime >= PRIVATE_REPLY_WINDOW_MS) throw new Error("Venció el plazo para responder en privado a este comentario.");
  }
  let slot: Awaited<ReturnType<typeof reserveDMSlot>> | undefined;
  let usage: Awaited<ReturnType<typeof reserveWorkspaceDMSend>> | undefined;
  if (kind === "private" || kind === "dm") {
    if (kind === "private") {
      slot = await reserveDMSlot(run.instagramAccount.instagramId, run.attempts);
      if (!slot.allowed) throw new DeferredRun(new Date(Date.now() + Math.max(slot.requeueDelayMs, 60_000)));
    }
    usage = await reserveWorkspaceDMSend(run.workspaceId);
    if (!usage.allowed) {
      if (slot?.reserved) await releaseDMSlot(run.instagramAccount.instagramId);
      throw new Error("No hay capacidad disponible para enviar mensajes en este espacio.");
    }
  }
  // One global private reply per comment, even if competing campaigns match.
  const privateKey = kind === "private" ? `flow-private-${run.instagramAccountId}-${run.commentId}` : null;
  if (privateKey) {
    try { await prisma.flowEventReceipt.create({ data: { id: privateKey } }); }
    catch (error) {
      if (uniqueError(error)) {
        if (slot?.reserved) await releaseDMSlot(run.instagramAccount.instagramId);
        if (usage?.reserved) await releaseWorkspaceDMReservation(run.workspaceId, usage.periodStart);
        throw new UncertainEffect("La respuesta privada de este comentario ya fue reservada. No se envió nuevamente.");
      }
      throw error;
    }
  }
  const startedAt = Date.now();
  output = { ...output, effects: { ...output.effects, [key]: { status: "CLAIMED", startedAt } } };
  await prisma.flowStepRun.update({ where: { id: step.id }, data: { status: "RUNNING", output: json(output) } });
  try {
    const result = await send();
    output.effects![key] = { status: "SENT", result, startedAt };
    await prisma.flowStepRun.update({ where: { id: step.id }, data: { output: json(output) } });
    return result;
  } catch (error) {
    if (kind === "private" && ((error instanceof ZernioApiError && error.privateReplyConsumed) ||
      (error instanceof MetaApiError && error.code === 2 && error.subcode === 1545133))) {
      throw new UncertainEffect("Instagram consumió la respuesta privada de este comentario. Revisá la conversación antes de continuar; no se enviará otro mensaje de apertura.");
    }
    const confirmed = (error instanceof MetaApiError && error.code < 500) || (error instanceof ZernioApiError && error.code < 500) ||
      (error instanceof FlowHttpActionError && ["INVALID_URL", "PRIVATE_DESTINATION", "INVALID_PAYLOAD"].includes(error.code));
    if (!confirmed || error instanceof ZernioDeliveryUnconfirmedError) throw new UncertainEffect(errorText(error));
    output.effects![key] = { status: "FAILED" };
    await prisma.flowStepRun.update({ where: { id: step.id }, data: { output: json(output), error: errorText(error) } });
    if (privateKey) await prisma.flowEventReceipt.delete({ where: { id: privateKey } });
    if (slot?.reserved) await releaseDMSlot(run.instagramAccount.instagramId);
    if (usage?.reserved) await releaseWorkspaceDMReservation(run.workspaceId, usage.periodStart);
    if (error instanceof RateLimitError) throw new DeferredRun(new Date(Date.now() + 60_000));
    throw error;
  }
}

async function stepFor(run: LoadedRun, node: FlowNode) {
  const visit = contextOf(run).visits?.[node.id] ?? 0;
  return prisma.flowStepRun.upsert({ where: { runId_nodeId_visit: { runId: run.id, nodeId: node.id, visit } },
    create: { runId: run.id, nodeId: node.id, visit, status: "RUNNING" }, update: {} });
}

async function finishStep(run: LoadedRun, step: FlowStepRun, port: string, updates: Partial<Prisma.FlowRunUpdateInput> = {}) {
  const ctx = contextOf(run);
  const output = outputOf(await prisma.flowStepRun.findUniqueOrThrow({ where: { id: step.id } }));
  const definition = parseFlowDefinition(run.version.definition);
  const next = targetFor(definition, step.nodeId, port);
  ctx.visits = { ...ctx.visits, [step.nodeId]: step.visit + 1 };
  ctx.totalSteps = (ctx.totalSteps ?? 0) + 1;
  await prisma.$transaction([
    prisma.flowStepRun.update({ where: { id: step.id }, data: { status: "COMPLETED", completedAt: new Date(), output: json({ ...output, port, visitCounted: true }) } }),
    prisma.flowRun.updateMany({ where: { id: run.id, leaseToken: run.leaseToken, status: { in: ACTIVE } }, data: { currentNodeId: next, status: next ? "RUNNING" : "COMPLETED", context: json(ctx), waitType: null, waitExpiresAt: null, resumeAt: null, error: null, ...updates } }),
  ]);
}

async function waitAt(run: LoadedRun, step: FlowStepRun, waitType: string, timeoutMinutes: number, defaultPort: string) {
  const ctx = contextOf(run);
  const sent = outputOf(await prisma.flowStepRun.findUniqueOrThrow({ where: { id: step.id } }));
  const sentTimes = Object.values(sent.effects ?? {}).filter((item) => item.status === "SENT" && item.startedAt).map((item) => item.startedAt!);
  Object.assign(ctx, { waitStartedAt: sentTimes.length ? Math.min(...sentTimes) : step.startedAt.getTime(), waitNodeId: step.nodeId, waitVisit: step.visit, waitDefaultPort: defaultPort });
  const expires = new Date(Date.now() + timeoutMinutes * 60_000);
  await prisma.flowRun.updateMany({ where: { id: run.id, leaseToken: run.leaseToken, status: { in: ACTIVE } }, data: { status: "WAITING", waitType, waitExpiresAt: expires, context: json(ctx), resumeAt: null } });
  await enqueueFlowRun(run.id, expires).catch(() => {});
}

async function sendMessageNode(run: LoadedRun, node: Extract<FlowNode, { type: "message" }>, step: FlowStepRun, assertLease: () => Promise<void>) {
  const data = node.data;
  const ctx = contextOf(run);
  const initial = !ctx.initialSent;
  if (initial && (data.blocks.length !== 1 || data.blocks[0].type !== "text")) throw new Error("La apertura del comentario necesita un único bloque de texto.");
  if (initial && (data.buttons.length > 1 || data.buttons.some((button) => button.kind !== "continue") || data.quickReplies?.length)) throw new Error("La apertura admite un único botón para continuar; los enlaces y respuestas rápidas van después de la primera respuesta.");
  if ((data.buttons.length || data.quickReplies?.length) && (data.blocks.length !== 1 || data.blocks[0].type !== "text")) throw new Error("Las opciones necesitan un único bloque de texto.");
  const openingButton = initial ? data.buttons[0] : undefined;
  let openingMode: StepOutput["openingMode"];
  let openingAlreadySent = false;
  if (openingButton) {
    const savedOutput = outputOf(await prisma.flowStepRun.findUniqueOrThrow({ where: { id: step.id } }));
    openingAlreadySent = savedOutput.effects?.["block.0"]?.status === "SENT";
    openingMode = savedOutput.openingMode;
    if (!openingMode) {
      // A saved send must never be retried or depend on another profile lookup.
      // Without a recorded variant, use the conservative text mode for recovery.
      openingMode = "text";
      if (!savedOutput.effects?.["block.0"]) {
        try {
          const follows = await getUserFollowStatus({ context: await createInstagramContext(run.instagramAccount), recipientId: ctx.commenterId });
          if (follows === true) openingMode = "button";
        } catch { /* Unverifiable followers receive the text alternative. */ }
      }
      await prisma.flowStepRun.update({ where: { id: step.id }, data: { output: json({ ...savedOutput, openingMode }) } });
    }
  }
  const values = valuesFor(run);
  const buttons = await Promise.all(data.buttons.map(async (button) => button.kind === "url"
    ? { type: "url" as const, title: button.label, url: await buildFlowTrackedUrl({ runId: run.id, nodeId: node.id, buttonId: button.id, url: renderFlowText(button.url ?? "", values) }) }
    : { type: "postback" as const, title: button.label, payload: flowButtonPayload({ runId: run.id, nodeId: node.id, visit: step.visit, buttonId: button.id }) }));
  const quickReplies = data.quickReplies?.map((button) => ({ content_type: "text" as const, title: button.label, payload: flowButtonPayload({ runId: run.id, nodeId: node.id, visit: step.visit, buttonId: button.id }) }));
  for (let i = 0; i < data.blocks.length; i++) {
    const block = data.blocks[i];
    const renderedText = block.type === "text" ? renderFlowText(block.text, values) : undefined;
    const text = openingButton && openingMode === "text" ? openingFallbackText(renderedText!, openingButton.label) : renderedText;
    const visibleButtons = !initial || openingMode === "button" ? buttons : [];
    if (openingButton && !openingAlreadySent && (!text?.trim() || Buffer.byteLength(text) > 1000 || (openingMode === "button" && text.length > 640))) {
      throw new Error("La apertura supera el límite permitido por Instagram, incluida su alternativa de respuesta escrita.");
    }
    const context = await createInstagramContext(run.instagramAccount, `flow:${step.id}:${i}`);
    await effect(run, step, `block.${i}`, () => block.type === "text"
      ? sendFlowTextMessage({ context, instagramAccountId: run.instagramAccount.instagramId, userId: ctx.commenterId, commentId: initial ? run.commentId ?? undefined : undefined,
        postId: ctx.mediaId, text: text!, buttons: visibleButtons.length ? visibleButtons : undefined, quickReplies: quickReplies?.length ? quickReplies : undefined,
        initialButtonsAllowed: initial && openingMode === "button" })
      : sendFlowMediaMessage({ context, instagramAccountId: run.instagramAccount.instagramId, userId: ctx.commenterId, type: block.type, url: renderFlowText(block.url, values), name: block.name }), assertLease, initial ? "private" : "dm");
  }
  if (initial) {
    ctx.initialSent = true;
    await prisma.flowRun.updateMany({ where: { id: run.id, leaseToken: run.leaseToken, status: { in: ACTIVE } }, data: { context: json(ctx) } });
    if (run.commentId) await prisma.dmLog.updateMany({ where: { automationId: run.automationId, commentId: run.commentId }, data: { status: "SENT", dmSentAt: new Date(), dmDeliveryUnconfirmed: false, errorMessage: null } });
  }
  const continues = [...data.buttons, ...(data.quickReplies ?? [])].filter((button) => button.kind === "continue");
  if (initial || continues.length) {
    const defaultPort = targetFor(parseFlowDefinition(run.version.definition), node.id, "next") ? "next" : continues.length === 1 ? `button.${continues[0].id}` : "";
    await waitAt(run, step, initial ? "INTERACTION" : "BUTTON", 7 * 24 * 60, defaultPort);
  } else await finishStep(run, step, "next");
}

async function sendInputNode(run: LoadedRun, node: Extract<FlowNode, { type: "input" }>, step: FlowStepRun, assertLease: () => Promise<void>) {
  if (!contextOf(run).initialSent) throw new Error("Agregá una apertura antes de pedir datos.");
  // A contact has one active question. Another flow waits instead of consuming
  // the answer to a question it did not ask.
  const otherWait = await prisma.flowRun.findFirst({ where: { contactId: run.contactId, id: { not: run.id }, status: "WAITING", waitType: "INPUT" } });
  if (otherWait) throw new DeferredRun(new Date(Date.now() + 30_000));
  const ctx = contextOf(run);
  const retry = ctx.retryInput && node.data.retryMessage ? node.data.retryMessage : node.data.prompt;
  const options = node.data.options?.map((label, index) => ({ content_type: "text" as const, title: label.slice(0, 20), payload: flowButtonPayload({ runId: run.id, nodeId: node.id, visit: step.visit, buttonId: `option_${index}` }) })) ?? [];
  const quickReplies = [...options, { content_type: "text" as const, title: "Omitir", payload: flowButtonPayload({ runId: run.id, nodeId: node.id, visit: step.visit, buttonId: "skip" }) }];
  const context = await createInstagramContext(run.instagramAccount, `flow:${step.id}:question`);
  await effect(run, step, "question", () => sendFlowTextMessage({ context, instagramAccountId: run.instagramAccount.instagramId, userId: ctx.commenterId,
    text: renderFlowText(retry, valuesFor(run)), quickReplies }), assertLease, "dm");
  ctx.retryInput = false;
  await waitAt(run, step, "INPUT", node.data.timeoutMinutes, "answered");
}

async function conditionPort(run: LoadedRun, node: Extract<FlowNode, { type: "condition" }>) {
  const results: boolean[] = [];
  let follows: boolean | null | undefined;
  for (const rule of node.data.rules) {
    let actual: unknown;
    if (rule.field === "tag") actual = run.contact.tags.some((relation) => relation.tag.name.toLowerCase() === rule.value?.toLowerCase()) ? rule.value : undefined;
    else if (rule.field === "follows") {
      if (follows === undefined) follows = await getUserFollowStatus({ context: await createInstagramContext(run.instagramAccount), recipientId: contextOf(run).commenterId });
      actual = follows === null ? "unknown" : follows ? "true" : "false";
    } else if (rule.field === "window_open") actual = String(messagingWindowOpen(run.contact.lastInboundAt));
    else if (rule.field.startsWith("clicked:")) actual = String(Boolean(await prisma.flowLink.findFirst({ where: { runId: run.id, buttonId: rule.field.slice(8), clickedAt: { not: null } }, select: { id: true } })));
    else actual = valuesFor(run)[rule.field as keyof ReturnType<typeof valuesFor>];
    results.push(compareFlowValue(actual, rule.operator, rule.value));
  }
  return (node.data.match === "all" ? results.every(Boolean) : results.some(Boolean)) ? "yes" : "no";
}

async function actionNode(run: LoadedRun, node: Extract<FlowNode, { type: "action" }>, step: FlowStepRun, assertLease: () => Promise<void>) {
  const data = node.data;
  const values = valuesFor(run);
  const value = renderFlowText(data.value ?? "", values);
  await assertLease();
  if (data.action === "webhook") {
    try {
      const result = await effect(run, step, "webhook", () => executeFlowHttpAction({ url: data.url!, idempotencyKey: `flow-${step.id}`,
        payload: { event: "flow.action", run_id: run.id, automation_id: run.automationId, contact_id: run.contactId, node_id: node.id, contact: values, value, note: data.note ?? "" } }), assertLease, "http") as { status: number };
      await finishStep(run, step, result.status >= 200 && result.status < 300 ? "next" : "error");
    } catch (error) {
      if (error instanceof UncertainEffect || error instanceof DeferredRun) throw error;
      await finishStep(run, step, "error");
    }
    return;
  }
  if (data.action === "start_flow") {
    const depth = contextOf(run).depth ?? 0;
    if (depth >= 5 || data.automationId === run.automationId) { await finishStep(run, step, "error"); return; }
    const child = await startFlowRun({ automationId: data.automationId!, instagramAccountId: run.instagramAccountId, contactId: run.contactId,
      commentId: `sub_${step.id}`, commentText: contextOf(run).commentText ?? "", commenterId: contextOf(run).commenterId,
      commenterName: contextOf(run).commenterName, depth: depth + 1, conversationOpen: true });
    await finishStep(run, step, child ? "next" : "error"); return;
  }
  if (data.action === "add_tag") await addContactTags(run.workspaceId, run.contactId, [renderFlowText(data.tag!, values)]);
  if (data.action === "remove_tag") await prisma.contactTag.deleteMany({ where: { contactId: run.contactId, tag: { workspaceId: run.workspaceId, name: renderFlowText(data.tag!, values) } } });
  if (["set_field", "clear_field", "increment_field"].includes(data.action)) {
    // Updating the contact and completing the step in one transaction makes
    // increments safe across a crash; assignments alone would be insufficient.
    const ctx = contextOf(run);
    const key = data.fieldKey!;
    if (data.action === "increment_field" && ["email", "phone", "username"].includes(key)) { await finishStep(run, step, "error"); return; }
    const existing = run.contact.fields && typeof run.contact.fields === "object" && !Array.isArray(run.contact.fields) ? { ...run.contact.fields } : {};
    if (data.action === "increment_field" && !Number.isFinite(Number(existing[key] ?? 0))) { await finishStep(run, step, "error"); return; }
    const nextValue = data.action === "clear_field" ? "" : data.action === "increment_field" ? String(Number(existing[key] ?? 0) + Number(value || 1)) : value;
    existing[key] = nextValue;
    const definition = parseFlowDefinition(run.version.definition);
    const next = targetFor(definition, node.id, "next");
    ctx.visits = { ...ctx.visits, [node.id]: step.visit + 1 }; ctx.totalSteps = (ctx.totalSteps ?? 0) + 1;
    await prisma.$transaction(async (tx) => {
      const advanced = await tx.flowRun.updateMany({ where: { id: run.id, leaseToken: run.leaseToken, status: { in: ACTIVE } }, data: { currentNodeId: next, status: next ? "RUNNING" : "COMPLETED", context: json(ctx) } });
      if (!advanced.count) return;
      await tx.contact.update({ where: { id: run.contactId }, data: key === "email" || key === "phone" ? { [key]: nextValue || null } : { fields: json(existing) } });
      await tx.flowStepRun.update({ where: { id: step.id }, data: { status: "COMPLETED", completedAt: new Date(), output: json({ port: "next", visitCounted: true }) } });
    });
    await enqueueContactSync(run.workspaceId, [run.contactId]); return;
  }
  if (data.action === "goal") contextOf(run).goals = [...new Set([...(contextOf(run).goals ?? []), value || node.label])];
  if (data.action === "pause" || data.action === "handoff") {
    const ctx = contextOf(run);
    ctx.visits = { ...ctx.visits, [node.id]: step.visit + 1 }; ctx.totalSteps = (ctx.totalSteps ?? 0) + 1;
    const next = targetFor(parseFlowDefinition(run.version.definition), node.id, "next");
    await prisma.$transaction(async (tx) => {
      // Manual notes use the same row lock. Read after acquiring it so an
      // administrator's concurrent addition is preserved in the append.
      await tx.$queryRaw`SELECT "id" FROM "Contact" WHERE "id" = ${run.contactId} FOR UPDATE`;
      const currentContact = await tx.contact.findUniqueOrThrow({ where: { id: run.contactId }, select: { notes: true } });
      const notes = Array.isArray(currentContact.notes) ? [...currentContact.notes] : [];
      if (data.note && !notes.some((note) => note && typeof note === "object" && !Array.isArray(note) && (note.effectId === step.id || note.id === step.id))) {
        notes.push({ id: step.id, effectId: step.id, text: renderFlowText(data.note, values), createdAt: new Date().toISOString(), runId: run.id });
      }
      const advanced = await tx.flowRun.updateMany({ where: { id: run.id, leaseToken: run.leaseToken, status: { in: ACTIVE } }, data: { currentNodeId: next, status: "PAUSED", context: json(ctx), waitType: null, waitExpiresAt: null } });
      if (!advanced.count) return;
      await tx.contact.update({ where: { id: run.contactId }, data: { automationPaused: true, automationPausedUntil: null, notes: json(notes.slice(-100)) } });
      await tx.flowStepRun.update({ where: { id: step.id }, data: { status: "COMPLETED", completedAt: new Date(), output: json({ port: "next", visitCounted: true }) } });
    });
    return;
  }
  if (data.action === "add_tag" || data.action === "remove_tag") await enqueueContactSync(run.workspaceId, [run.contactId]);
  await finishStep(run, step, "next");
}

async function publicReply(run: LoadedRun, assertLease: () => Promise<void>) {
  if (contextOf(run).depth || !run.commentId) return;
  const pool = contextOf(run).publicReplies ?? [];
  if (!pool.length) return;
  const step = await prisma.flowStepRun.upsert({ where: { runId_nodeId_visit: { runId: run.id, nodeId: "__public_reply", visit: 0 } }, create: { runId: run.id, nodeId: "__public_reply", visit: 0 }, update: {} });
  if (step.status === "COMPLETED" || step.status === "UNCERTAIN" || step.status === "FAILED") return;
  const variant = createHash("sha256").update(run.commentId).digest().readUInt32BE(0) % pool.length;
  const reply = renderFlowText(pool[variant], valuesFor(run));
  const context = await createInstagramContext(run.instagramAccount, `flow:${step.id}:public`);
  try {
    await effect(run, step, "public", () => sendCommentReply({ context, commentId: run.commentId!, message: reply, postId: contextOf(run).mediaId }), assertLease, "public");
  } catch (error) {
    if (error instanceof DeferredRun || error instanceof CancelledRun) throw error;
    await prisma.flowStepRun.update({ where: { id: step.id }, data: { status: error instanceof UncertainEffect ? "UNCERTAIN" : "FAILED", error: errorText(error) } });
    await prisma.dmLog.updateMany({ where: { automationId: run.automationId, commentId: run.commentId }, data: { publicReplyError: errorText(error), publicReplyDeliveryUnconfirmed: error instanceof UncertainEffect } });
    return;
  }
  await prisma.flowStepRun.update({ where: { id: step.id }, data: { status: "COMPLETED", completedAt: new Date() } });
  await prisma.dmLog.updateMany({ where: { automationId: run.automationId, commentId: run.commentId }, data: { publicReplySentAt: new Date(), publicReplyError: null } });
}

export async function executeFlowRun(runId: string): Promise<void> {
  const initial = await prisma.flowRun.findUnique({ where: { id: runId }, include: INCLUDE });
  if (!initial || !ACTIVE.includes(initial.status)) return;
  await withContactLock(initial.contactId, async (assertLease) => {
    const token = randomUUID();
    const claimed = await prisma.flowRun.updateMany({ where: { id: runId, status: { in: ACTIVE }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] }, data: { leaseToken: token, leaseUntil: new Date(Date.now() + LEASE_MS) } });
    if (!claimed.count) throw new Error("La ejecución está reservada por otro worker.");
    const renewal = setInterval(() => void prisma.flowRun.updateMany({ where: { id: runId, leaseToken: token }, data: { leaseUntil: new Date(Date.now() + LEASE_MS) } }).catch(() => {}), LEASE_MS / 3);
    let step: FlowStepRun | undefined;
    try {
      for (let count = 0; count < 100; count++) {
        const run = await prisma.flowRun.findUniqueOrThrow({ where: { id: runId }, include: INCLUDE });
        if (!ACTIVE.includes(run.status)) return;
        if (!run.automation.isActive || !run.automation.flowEnabled || contactPaused(run.contact)) {
          await prisma.flowRun.updateMany({ where: { id: runId, leaseToken: token, status: { in: ACTIVE } }, data: { status: "PAUSED", ...(run.status === "WAITING_WINDOW" ? { waitType: "WINDOW" } : {}) } }); return;
        }
        const definition = parseFlowDefinition(run.version.definition);
        if ((contextOf(run).totalSteps ?? 0) >= MAX_STEPS) throw new Error("El flujo alcanzó su límite de pasos; revisá los ciclos.");
        if (run.status === "WAITING") {
          if (!run.waitExpiresAt || run.waitExpiresAt > new Date()) return;
          const nodeId = contextOf(run).waitNodeId ?? run.currentNodeId;
          if (!nodeId) return;
          const timeoutStep = await prisma.flowStepRun.findUniqueOrThrow({ where: { runId_nodeId_visit: { runId: run.id, nodeId, visit: contextOf(run).waitVisit ?? 0 } } });
          contextOf(run).inputAttempts = 0; contextOf(run).retryInput = false;
          await finishStep(run, timeoutStep, "timeout", targetFor(definition, nodeId, "timeout") ? {} : { status: "EXPIRED" });
          continue;
        }
        if (run.status === "WAITING_WINDOW") {
          if (!messagingWindowOpen(run.contact.lastInboundAt)) {
            if (run.resumeAt && run.resumeAt <= new Date()) await prisma.flowRun.updateMany({ where: { id: runId, leaseToken: token, status: { in: ACTIVE } }, data: { status: "EXPIRED", error: "No hubo una nueva interacción dentro del plazo de espera." } });
            return;
          }
          await prisma.flowRun.updateMany({ where: { id: runId, leaseToken: token, status: { in: ACTIVE } }, data: { status: "RUNNING", resumeAt: null, waitType: null } }); continue;
        }
        if (run.status === "PAUSED") {
          await prisma.flowRun.updateMany({ where: { id: runId, leaseToken: token, status: { in: ACTIVE } }, data: { status: resumedStatus(run), ...(run.waitType === "WINDOW" ? { waitType: null } : {}) } }); continue;
        }
        if (run.resumeAt && run.resumeAt > new Date()) return;
        await publicReply(run, assertLease);
        const node = definition.nodes.find((candidate) => candidate.id === run.currentNodeId);
        if (!node) { await prisma.flowRun.updateMany({ where: { id: runId, leaseToken: token, status: { in: ACTIVE } }, data: { status: "COMPLETED", currentNodeId: null } }); return; }
        step = await stepFor(run, node);
        if (step.status === "COMPLETED" && outputOf(step).port) { await finishStep(run, step, outputOf(step).port!); continue; }
        if (step.status === "UNCERTAIN") throw new UncertainEffect(step.error ?? "Entrega incierta.");
        if (node.type === "end") { await finishStep(run, step, "next"); return; }
        if (node.type === "start") await finishStep(run, step, "next");
        else if (node.type === "message") await sendMessageNode(run, node, step, assertLease);
        else if (node.type === "input") await sendInputNode(run, node, step, assertLease);
        else if (node.type === "condition") await finishStep(run, step, await conditionPort(run, node));
        else if (node.type === "randomizer") await finishStep(run, step, `branch.${weightedBranch(node.data.branches, Math.random())}`);
        else if (node.type === "action") await actionNode(run, node, step, assertLease);
        else if (node.type === "delay") {
          const due = node.data.until ? new Date(node.data.until) : new Date(Date.now() + node.data.minutes * 60_000);
          await finishStep(run, step, "next", { resumeAt: due });
          await enqueueFlowRun(run.id, due).catch(() => {}); return;
        }
      }
      await enqueueFlowRun(runId);
    } catch (error) {
      if (error instanceof CancelledRun) return;
      if (error instanceof DeferredRun) {
        await prisma.flowRun.updateMany({ where: { id: runId, leaseToken: token, status: { in: ACTIVE } }, data: { status: error.status, resumeAt: error.dueAt, attempts: { increment: 1 } } });
        await enqueueFlowRun(runId, error.dueAt).catch(() => {}); return;
      }
      const uncertain = error instanceof UncertainEffect;
      await prisma.flowRun.updateMany({ where: { id: runId, leaseToken: token, status: { in: ACTIVE } }, data: { status: uncertain ? "UNCERTAIN" : "FAILED", error: errorText(error) } });
      if (step) await prisma.flowStepRun.update({ where: { id: step.id }, data: { status: uncertain ? "UNCERTAIN" : "FAILED", error: errorText(error) } });
      if (!contextOf(initial).initialSent && initial.commentId) await prisma.dmLog.updateMany({ where: { automationId: initial.automationId, commentId: initial.commentId }, data: { status: "FAILED", errorMessage: errorText(error), dmDeliveryUnconfirmed: uncertain } });
    } finally {
      clearInterval(renewal);
      await prisma.flowRun.updateMany({ where: { id: runId, leaseToken: token }, data: { leaseToken: null, leaseUntil: null } });
    }
  });
}

type Inbound = { instagramAccountId: string; userId: string; eventId: string; text?: string; payload?: string; timestamp?: number };
async function handleInbound(input: Inbound): Promise<boolean> {
  const receipt = createHash("sha256").update(`flow-inbound:${input.instagramAccountId}:${input.eventId}`).digest("hex");
  if (await prisma.flowEventReceipt.findUnique({ where: { id: receipt } })) return true;
  const reference = input.payload ? parseFlowButtonPayload(input.payload) : null;
  if (input.payload?.startsWith("flow.") && !reference) return true;
  const candidates = await prisma.flowRun.findMany({ where: { ...(reference ? { id: reference.runId } : {}), status: { in: ACTIVE },
    instagramAccount: { instagramId: input.instagramAccountId }, contact: { igsid: input.userId } }, include: INCLUDE, orderBy: [{ createdAt: "asc" }], take: 50 });
  const run = reference ? candidates[0] : candidates.find((candidate) => candidate.status === "WAITING" && candidate.waitType === "INPUT")
    ?? candidates.find((candidate) => candidate.status === "WAITING") ?? candidates.find((candidate) => candidate.status === "WAITING_WINDOW") ?? candidates[0];
  if (!run) return Boolean(reference);
  return withContactLock(run.contactId, async (assertLease) => {
    await assertLease();
    const fresh = await prisma.flowRun.findUniqueOrThrow({ where: { id: run.id }, include: INCLUDE });
    const ctx = contextOf(fresh);
    // Missing source time cannot establish a fresh 24-hour permission. The
    // ingress records original provider timestamps, never worker retry time.
    if (!input.timestamp || !Number.isFinite(input.timestamp)) {
      await prisma.flowEventReceipt.create({ data: { id: receipt } });
      return true;
    }
    const timestamp = incomingEventTime(input.timestamp);
    if (await prisma.flowEventReceipt.findUnique({ where: { id: receipt } })) return true;
    const contactInbound = fresh.contact.lastInboundAt ? Math.max(fresh.contact.lastInboundAt.getTime(), timestamp) : timestamp;
    const definition = parseFlowDefinition(fresh.version.definition);
    const node = definition.nodes.find((candidate) => candidate.id === ctx.waitNodeId);
    let nextId = fresh.currentNodeId;
    let status = fresh.status;
    let consumeWait = false;
    let reopenedWindow = false;
    let savedAnswer: { key: string; value: string } | undefined;
    if (!contactPaused(fresh.contact) && fresh.automation.isActive && fresh.automation.flowEnabled) {
      if (status === "PAUSED") status = resumedStatus(fresh);
      if (status === "WAITING_WINDOW") { status = "RUNNING"; reopenedWindow = true; }
      if (status === "WAITING" && node && timestamp >= (ctx.waitStartedAt ?? Infinity) &&
          (!fresh.waitExpiresAt || timestamp <= fresh.waitExpiresAt.getTime())) {
        const referenceValid = !reference || (reference.nodeId === node.id && reference.visit === ctx.waitVisit);
        if (referenceValid && node.type === "message") {
          const buttons = [...node.data.buttons, ...(node.data.quickReplies ?? [])].filter((button) => button.kind === "continue");
          const selected = reference ? buttons.find((button) => button.id === reference.buttonId) : buttons.find((button) => button.label.trim().toLowerCase() === input.text?.trim().toLowerCase());
          const port = selected ? `button.${selected.id}` : !reference ? ctx.waitDefaultPort : undefined;
          if (port) { nextId = targetFor(definition, node.id, port); status = nextId ? "RUNNING" : "COMPLETED"; consumeWait = true; }
        } else if (referenceValid && node.type === "input") {
          let answer = input.text ?? "";
          const optionIndex = reference?.buttonId.match(/^option_(\d+)$/)?.[1];
          const option = optionIndex !== undefined ? node.data.options?.[Number(optionIndex)] : undefined;
          if (reference && reference.buttonId !== "skip" && option === undefined) return true;
          if (option !== undefined) answer = option;
          const skip = reference?.buttonId === "skip" || ["omitir", "skip"].includes(answer.trim().toLowerCase());
          const parsed = parseFlowAnswer(node.data.inputType, answer, node.data.options?.map((label) => ({ label })));
          if (skip || parsed.ok) {
            if (parsed.ok && !skip) savedAnswer = { key: node.data.fieldKey, value: parsed.value };
            nextId = targetFor(definition, node.id, skip ? "skip" : "answered"); status = nextId ? "RUNNING" : "COMPLETED";
            ctx.inputAttempts = 0; ctx.retryInput = false; consumeWait = true;
          } else {
            ctx.inputAttempts = (ctx.inputAttempts ?? 0) + 1;
            nextId = ctx.inputAttempts >= node.data.maxAttempts ? targetFor(definition, node.id, "skip") : node.id;
            ctx.retryInput = ctx.inputAttempts < node.data.maxAttempts;
            if (!ctx.retryInput) ctx.inputAttempts = 0;
            status = nextId ? "RUNNING" : "COMPLETED"; consumeWait = true;
          }
        }
      }
    }
    if (consumeWait && node) {
      ctx.visits = { ...ctx.visits, [node.id]: (ctx.waitVisit ?? 0) + 1 };
      ctx.totalSteps = (ctx.totalSteps ?? 0) + 1;
    }
    await prisma.$transaction(async (tx) => {
      await tx.flowEventReceipt.create({ data: { id: receipt } });
      const contactData: Prisma.ContactUpdateInput = { lastInboundAt: new Date(contactInbound), lastInteractionAt: new Date(Math.max(fresh.contact.lastInteractionAt.getTime(), timestamp)) };
      if (savedAnswer) {
        if (savedAnswer.key === "email" || savedAnswer.key === "phone") Object.assign(contactData, { [savedAnswer.key]: savedAnswer.value });
        else {
          const fields = fresh.contact.fields && typeof fresh.contact.fields === "object" && !Array.isArray(fresh.contact.fields) ? fresh.contact.fields : {};
          contactData.fields = json({ ...fields, [savedAnswer.key]: savedAnswer.value });
        }
      }
      await tx.contact.update({ where: { id: fresh.contactId }, data: contactData });
      await tx.flowRun.updateMany({ where: { id: fresh.id, status: { in: ACTIVE } }, data: { status, currentNodeId: nextId, context: json(ctx),
        ...(consumeWait ? { waitType: null, waitExpiresAt: null, resumeAt: null } : reopenedWindow ? { resumeAt: null, waitType: null } : {}) } });
      if (consumeWait && node) await tx.flowStepRun.updateMany({ where: { runId: fresh.id, nodeId: node.id, visit: ctx.waitVisit ?? 0 }, data: { status: "COMPLETED", completedAt: new Date(), output: json({ answered: savedAnswer?.value, port: nextId ? definition.edges.find((edge) => edge.source === node.id && edge.target === nextId)?.sourceHandle : "next" }) } });
    });
    if (savedAnswer) await enqueueContactSync(fresh.workspaceId, [fresh.contactId]);
    if (status === "RUNNING") await enqueueFlowRun(fresh.id).catch(() => {});
    return true;
  });
}

export async function handleFlowMessage(input: { instagramAccountId: string; userId: string; messageId: string; text: string; quickReplyPayload?: string; timestamp?: number }) {
  return handleInbound({ instagramAccountId: input.instagramAccountId, userId: input.userId, eventId: input.messageId, text: input.text, payload: input.quickReplyPayload, timestamp: input.timestamp });
}
export async function handleFlowPostback(input: { instagramAccountId: string; userId: string; payload: string; eventId?: string; timestamp?: number }) {
  if (!input.payload.startsWith("flow.")) return false;
  return handleInbound({ ...input, eventId: input.eventId ?? `postback:${input.payload}:${input.timestamp ?? "missing"}` });
}

export async function resumeContactFlows(contactId: string) {
  const paused = await prisma.flowRun.findMany({ where: { contactId, status: "PAUSED" }, select: { id: true, waitType: true } });
  await Promise.all(paused.map((run) => prisma.flowRun.updateMany({ where: { id: run.id, status: "PAUSED" }, data: { status: resumedStatus(run), ...(run.waitType === "WINDOW" ? { waitType: null } : {}) } })));
  const runs = await prisma.flowRun.findMany({ where: { contactId, status: { in: ["RUNNING", "WAITING", "WAITING_WINDOW"] } }, select: { id: true } });
  await Promise.all(runs.map((run) => enqueueFlowRun(run.id).catch(() => {})));
}

export async function recoverFlowRuns(): Promise<number> {
  const now = new Date();
  const runs = await prisma.flowRun.findMany({ where: {
    AND: [{ OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }],
    OR: [
      { status: "RUNNING", OR: [{ resumeAt: null }, { resumeAt: { lte: now } }] },
      { status: "WAITING", waitExpiresAt: { lte: now } },
      { status: "WAITING_WINDOW", resumeAt: { lte: now } },
      { status: "PAUSED", automation: { isActive: true, flowEnabled: true }, contact: { OR: [{ automationPaused: false }, { automationPausedUntil: { lte: now } }] } },
    ],
  }, select: { id: true }, orderBy: { updatedAt: "asc" }, take: 100 });
  await Promise.all(runs.map((run) => enqueueFlowRun(run.id).catch(() => {})));
  return runs.length;
}
