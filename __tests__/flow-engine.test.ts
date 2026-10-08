import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { FlowDefinition, FlowNode } from "@/lib/flows/definition";

type Row = Record<string, unknown>;
const fixtures = vi.hoisted(() => {
  const runs: Row[] = []; const steps: Row[] = []; const receipts = new Set<string>(); const locks = new Map<string, string>();
  const versions: Row[] = []; const contacts: Row[] = []; const automations: Row[] = []; const logs: Row[] = [];
  const object = (value: unknown) => (value ?? {}) as Row;
  const match = (row: Row, where: Row) => {
    for (const key of ["id", "runId", "nodeId", "visit", "contactId", "automationId", "instagramAccountId", "commentId"]) if (where[key] !== undefined && row[key] !== where[key]) return false;
    if (typeof where.status === "string" && row.status !== where.status) return false;
    const statuses = object(where.status).in;
    if (Array.isArray(statuses) && !statuses.includes(row.status)) return false;
    return true;
  };
  const changes = (row: Row, data: Row) => {
    for (const [key, value] of Object.entries(data)) row[key] = typeof object(value).increment === "number" ? Number(row[key] ?? 0) + Number(object(value).increment) : structuredClone(value);
    return row;
  };
  const account = { id: "account", instagramId: "ig", workspaceId: "workspace", provider: "META", accessToken: "encrypted", zernioAccountId: null };
  const hydrate = (row: Row) => structuredClone({ ...row, version: versions.find((version) => version.id === row.versionId), automation: automations.find((campaign) => campaign.id === row.automationId),
    contact: contacts.find((contact) => contact.id === row.contactId), instagramAccount: account });
  const runFind = (args: Row) => {
    const where = object(args.where); const compound = object(where.automationId_commentId);
    return runs.find((row) => compound.automationId ? row.automationId === compound.automationId && row.commentId === compound.commentId : match(row, where));
  };
  const stepFind = (args: Row) => {
    const where = object(args.where); const compound = object(where.runId_nodeId_visit);
    return steps.find((row) => compound.runId ? match(row, compound) : match(row, where));
  };
  const prisma = {
    automation: { findFirst: vi.fn(async (args: Row) => structuredClone(automations.find((row) => match(row, object(args.where))))) },
    flowVersion: { findFirst: vi.fn(async (args: Row) => structuredClone(versions.find((row) => match(row, object(args.where))))) },
    contact: {
      findFirst: vi.fn(async (args: Row) => structuredClone(contacts.find((row) => match(row, object(args.where))))),
      findUniqueOrThrow: vi.fn(async (args: Row) => structuredClone(contacts.find((row) => match(row, object(args.where))))),
      update: vi.fn(async (args: Row) => changes(contacts.find((row) => match(row, object(args.where)))!, object(args.data))),
    },
    flowRun: {
      findUnique: vi.fn(async (args: Row) => { const row = runFind(args); return row ? hydrate(row) : null; }),
      findUniqueOrThrow: vi.fn(async (args: Row) => hydrate(runFind(args)!)),
      findFirst: vi.fn(async (args: Row) => { const row = runs.find((row) => match(row, object(args.where)) && (!object(args.where).waitType || row.waitType === object(args.where).waitType)); return row ? hydrate(row) : null; }),
      findMany: vi.fn(async (args: Row) => runs.filter((row) => match(row, object(args.where))).map(hydrate)),
      create: vi.fn(async (args: Row) => {
        const row = { id: `run_${runs.length}`, createdAt: new Date(), updatedAt: new Date(), status: "RUNNING", waitType: null, waitExpiresAt: null, resumeAt: null, leaseUntil: null, attempts: 0, ...object(args.data) };
        runs.push(row); return structuredClone(row);
      }),
      update: vi.fn(async (args: Row) => structuredClone(changes(runFind(args)!, object(args.data)))),
      updateMany: vi.fn(async (args: Row) => { const rows = runs.filter((row) => match(row, object(args.where))); rows.forEach((row) => changes(row, object(args.data))); return { count: rows.length }; }),
    },
    flowStepRun: {
      upsert: vi.fn(async (args: Row) => { let row = stepFind(args); if (!row) { row = { id: `step_${steps.length}`, status: "PENDING", output: null, startedAt: new Date(), ...object(args.create) }; steps.push(row); } return structuredClone(row); }),
      findUniqueOrThrow: vi.fn(async (args: Row) => structuredClone(stepFind(args))),
      update: vi.fn(async (args: Row) => structuredClone(changes(stepFind(args)!, object(args.data)))),
      updateMany: vi.fn(async (args: Row) => { const rows = steps.filter((row) => match(row, object(args.where))); rows.forEach((row) => changes(row, object(args.data))); return { count: rows.length }; }),
    },
    flowEventReceipt: {
      create: vi.fn(async (args: Row) => { const id = object(args.data).id as string; if (receipts.has(id)) throw { code: "P2002" }; receipts.add(id); return { id }; }),
      findUnique: vi.fn(async (args: Row) => { const id = object(args.where).id as string; return receipts.has(id) ? { id } : null; }),
      delete: vi.fn(async (args: Row) => { receipts.delete(object(args.where).id as string); }),
    },
    dmLog: {
      findFirst: vi.fn(async () => null),
      upsert: vi.fn(async (args: Row) => { const key = object(object(args.where).automationId_commentId); let row = logs.find((row) => match(row, key)); if (!row) { row = { ...object(args.create) }; logs.push(row); } return row; }),
      updateMany: vi.fn(async (args: Row) => { const rows = logs.filter((row) => match(row, object(args.where))); rows.forEach((row) => changes(row, object(args.data))); return { count: rows.length }; }),
    },
    contactTag: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    flowLink: { findFirst: vi.fn(async () => null) },
    $transaction: vi.fn(async (task: unknown) => Array.isArray(task) ? Promise.all(task) : (task as (tx: unknown) => Promise<unknown>)(prisma)),
    $queryRaw: vi.fn(async () => []),
  };
  const redis = {
    set: vi.fn(async (key: string, value: string) => { if (locks.has(key)) return null; locks.set(key, value); return "OK"; }),
    get: vi.fn(async (key: string) => locks.get(key)),
    eval: vi.fn(async (script: string, _count: number, key: string, token: string) => {
      if (locks.get(key) !== token) return 0;
      if (script.includes("DEL")) locks.delete(key);
      return 1;
    }),
  };
  return { runs, steps, versions, contacts, automations, receipts, locks, logs, prisma, redis, account,
    sendText: vi.fn(), sendMedia: vi.fn(), sendPublic: vi.fn(), queue: vi.fn(), sync: vi.fn(), follow: vi.fn(), http: vi.fn(), addTags: vi.fn() };
});
vi.mock("@/lib/db/client", () => ({ prisma: fixtures.prisma }));
vi.mock("@/lib/queue/client", () => ({ getRedisConnection: () => fixtures.redis }));
vi.mock("@/lib/flows/queue", () => ({ enqueueFlowRun: fixtures.queue }));
vi.mock("@/lib/contacts/store", () => ({ addContactTags: fixtures.addTags }));
vi.mock("@/lib/contacts/sync", () => ({ enqueueContactSync: fixtures.sync }));
vi.mock("@/lib/flows/media", () => ({ sendFlowTextMessage: fixtures.sendText, sendFlowMediaMessage: fixtures.sendMedia }));
vi.mock("@/lib/flows/tracking", () => ({ buildFlowTrackedUrl: async () => "https://openreply.test/f/opaque" }));
vi.mock("@/lib/flows/http-action", () => ({ executeFlowHttpAction: fixtures.http, FlowHttpActionError: class extends Error {} }));
vi.mock("@/lib/instagram/provider", () => ({ createInstagramContext: async () => ({ provider: "META", accessToken: "token" }), getUserFollowStatus: fixtures.follow,
  sendCommentReply: fixtures.sendPublic, MetaApiError: class extends Error {}, RateLimitError: class extends Error {} }));
vi.mock("@/lib/billing/usage", () => ({ reserveWorkspaceDMSend: async () => ({ allowed: true, reserved: false }), releaseWorkspaceDMReservation: vi.fn() }));
vi.mock("@/lib/utils/rate-limiter", () => ({ reserveDMSlot: async () => ({ allowed: true, reserved: false }), releaseDMSlot: vi.fn() }));

import { executeFlowRun, handleFlowMessage, handleFlowPostback, resumeContactFlows, startFlowRun } from "@/lib/flows/engine";
import { durationToMinutes } from "@/lib/flows/duration";
import { flowButtonPayload, incomingEventTime, messagingWindowOpen, parseFlowAnswer, parseFlowButtonPayload, renderFlowText, weightedBranch } from "@/lib/flows/runtime-values";

const now = new Date("2026-10-01T15:00:00Z");
const node = <T extends FlowNode["type"]>(id: string, type: T, data: Extract<FlowNode, { type: T }>["data"]): FlowNode => ({ id, type, data, label: id, position: { x: 0, y: 0 } }) as FlowNode;
const message = (id: string, text: string) => node(id, "message", { blocks: [{ type: "text", text }], buttons: [] });
const opening = message("opening", "Respondé SI para continuar.");
function definition(middle: FlowNode[] = [message("resource", "Acá está tu recurso, {username}.")]): FlowDefinition {
  const nodes = [node("start", "start", {}), opening, ...middle, node("end", "end", {})];
  return { schemaVersion: 1, entryNodeId: "start", nodes, edges: nodes.slice(0, -1).map((current, index) => ({ id: `edge_${index}`, source: current.id, target: nodes[index + 1].id, sourceHandle: current.type === "input" ? "answered" : "next" })) };
}
function definitionWithFollowGate(): FlowDefinition {
  return {
    schemaVersion: 1, entryNodeId: "start",
    nodes: [
      node("start", "start", {}), message("opening", "Como va? Ahi te mando"),
      node("follow_check", "condition", { match: "all", rules: [{ field: "follows", operator: "equals", value: "true" }] }),
      node("resource", "message", { blocks: [{ type: "text", text: "Acá está tu recurso." }, { type: "image", url: "https://example.com/resource.jpg" }, { type: "pdf", url: "https://example.com/guide.pdf", name: "Guía" }], buttons: [] }),
      node("follow_request", "message", { blocks: [{ type: "text", text: "Seguí la cuenta para recibir el recurso." }], buttons: [{ id: "followed", label: "Ya te seguí", kind: "continue" }] }),
      node("end", "end", {}),
    ],
    edges: [
      { id: "start_opening", source: "start", sourceHandle: "next", target: "opening" },
      { id: "opening_check", source: "opening", sourceHandle: "next", target: "follow_check" },
      { id: "follow_yes", source: "follow_check", sourceHandle: "yes", target: "resource" },
      { id: "follow_no", source: "follow_check", sourceHandle: "no", target: "follow_request" },
      { id: "resource_end", source: "resource", sourceHandle: "next", target: "end" },
      { id: "follow_recheck", source: "follow_request", sourceHandle: "button.followed", target: "follow_check" },
    ],
  };
}
async function start(graph = definition()) {
  fixtures.versions.push({ id: "version", automationId: "automation", workspaceId: "workspace", definition: graph });
  const run = await startFlowRun({ automationId: "automation", instagramAccountId: "account", contactId: "contact", commentId: "comment", commentText: "GUIA", commenterId: "user", mediaId: "reel", timestamp: now.getTime() });
  return run!.id;
}
async function reply(runId: string, text = "SI", mid = "message_1") {
  await handleFlowMessage({ instagramAccountId: "ig", userId: "user", messageId: mid, text, timestamp: Date.now() });
  await executeFlowRun(runId);
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); vi.clearAllMocks();
  for (const rows of [fixtures.runs, fixtures.steps, fixtures.versions, fixtures.contacts, fixtures.automations, fixtures.logs]) rows.splice(0);
  fixtures.receipts.clear(); fixtures.locks.clear();
  fixtures.contacts.push({ id: "contact", workspaceId: "workspace", igsid: "user", username: "ana", email: null, phone: null, fields: {}, notes: [], tags: [], lastInboundAt: null, lastInteractionAt: now, automationPaused: false, automationPausedUntil: null });
  fixtures.automations.push({ id: "automation", workspaceId: "workspace", instagramAccountId: "account", isActive: true, flowEnabled: true, flowPublishedVersionId: "version", publicReplyEnabled: false, publicReplyMessages: [], publicReplyMessage: null });
  fixtures.sendText.mockResolvedValue({ message_id: "outbound" }); fixtures.sendMedia.mockResolvedValue({ message_id: "attachment" }); fixtures.sendPublic.mockResolvedValue({ id: "reply" });
  fixtures.queue.mockResolvedValue(undefined); fixtures.follow.mockResolvedValue(null); fixtures.http.mockResolvedValue({ status: 200 });
});
afterEach(() => vi.useRealTimers());

describe("persistent flow executor", () => {
  it("sends the configured public comment once and preserves its acknowledgement across recovery", async () => {
    fixtures.automations[0].publicReplyEnabled = true;
    fixtures.automations[0].publicReplyMessages = ["Te lo mandé, {username}."];
    const id = await start(); await executeFlowRun(id);
    expect(fixtures.sendPublic).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ commentId: "comment", message: "Te lo mandé, ana.", postId: "reel" }));
    expect(fixtures.logs[0].publicReplySentAt).toEqual(now);
    // Simulate a restart after provider acknowledgement but before completing
    // the public-reply step. The saved effect must be reused without a send.
    fixtures.steps.find((step) => step.nodeId === "__public_reply")!.status = "RUNNING";
    await reply(id);
    expect(fixtures.sendPublic).toHaveBeenCalledTimes(1);
  });

  it("does not retry an uncertain public reply and still sends the private opening", async () => {
    fixtures.automations[0].publicReplyEnabled = true;
    fixtures.automations[0].publicReplyMessages = ["Te escribí."];
    fixtures.sendPublic.mockRejectedValueOnce(new Error("acknowledgement lost"));
    const id = await start(); await executeFlowRun(id);
    expect(fixtures.logs[0].publicReplyDeliveryUnconfirmed).toBe(true);
    expect(fixtures.logs[0].publicReplySentAt).toBeUndefined();
    expect(fixtures.sendText).toHaveBeenCalledTimes(1);
    await reply(id);
    expect(fixtures.sendPublic).toHaveBeenCalledTimes(1);
    expect(fixtures.runs[0].status).toBe("COMPLETED");
  });

  it("sends one private opening, waits for an inbound reply and then completes the sequence", async () => {
    const id = await start(); await executeFlowRun(id);
    expect(fixtures.sendText).toHaveBeenCalledTimes(1);
    expect(fixtures.sendText.mock.calls[0][0]).toMatchObject({ commentId: "comment", userId: "user" });
    expect(fixtures.runs[0].status).toBe("WAITING");
    await executeFlowRun(id); expect(fixtures.sendText).toHaveBeenCalledTimes(1);
    await reply(id);
    expect(fixtures.sendText).toHaveBeenCalledTimes(2);
    expect(fixtures.sendText.mock.calls[1][0]).toMatchObject({ text: "Acá está tu recurso, ana.", commentId: undefined });
    expect(fixtures.runs[0].status).toBe("COMPLETED");
    expect(fixtures.logs[0].status).toBe("SENT");
    expect(await handleFlowMessage({ instagramAccountId: "ig", userId: "user", messageId: "message_1", text: "SI" })).toBe(true);
    await executeFlowRun(id); expect(fixtures.sendText).toHaveBeenCalledTimes(2);
  });

  it.each([null, new Date(now.getTime() - 25 * 60 * 60_000)])("waits before checking a follower with a closed window (%j), then delivers text, image and PDF after a reply", async (lastInboundAt) => {
    fixtures.contacts[0].lastInboundAt = lastInboundAt;
    fixtures.follow.mockResolvedValue(true);
    const id = await start(definitionWithFollowGate());
    await executeFlowRun(id);
    await executeFlowRun(id);

    expect(fixtures.follow).not.toHaveBeenCalled();
    expect(fixtures.sendMedia).not.toHaveBeenCalled();
    expect(fixtures.sendText).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ text: "Como va? Ahi te mando", commentId: "comment" }));
    expect(fixtures.runs[0]).toMatchObject({ status: "WAITING", waitType: "INTERACTION", currentNodeId: "opening" });
    expect(fixtures.contacts[0].lastInboundAt).toEqual(lastInboundAt);

    await reply(id);
    expect(fixtures.follow).toHaveBeenCalledTimes(1);
    expect(fixtures.sendText).toHaveBeenCalledTimes(2);
    expect(fixtures.sendText.mock.calls[1][0]).toMatchObject({ text: "Acá está tu recurso.", commentId: undefined });
    expect(fixtures.sendMedia).toHaveBeenCalledTimes(2);
    expect(fixtures.sendMedia).toHaveBeenNthCalledWith(1, expect.objectContaining({ userId: "user", type: "image", url: "https://example.com/resource.jpg" }));
    expect(fixtures.sendMedia).toHaveBeenNthCalledWith(2, expect.objectContaining({ userId: "user", type: "pdf", url: "https://example.com/guide.pdf", name: "Guía" }));
    expect(fixtures.runs[0].status).toBe("COMPLETED");
  });

  it("rechecks follow status after the follow button and delivers only when it becomes true", async () => {
    fixtures.follow.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const id = await start(definitionWithFollowGate());
    await executeFlowRun(id);
    expect(fixtures.follow).not.toHaveBeenCalled();
    await reply(id);

    expect(fixtures.follow).toHaveBeenCalledTimes(1);
    expect(fixtures.sendMedia).not.toHaveBeenCalled();
    expect(fixtures.sendText.mock.calls.at(-1)?.[0]).toMatchObject({ text: "Seguí la cuenta para recibir el recurso.", buttons: [{ type: "postback", title: "Ya te seguí", payload: expect.any(String) }] });
    expect(fixtures.runs[0]).toMatchObject({ status: "WAITING", waitType: "BUTTON", currentNodeId: "follow_request" });
    const payload = fixtures.sendText.mock.calls.at(-1)![0].buttons[0].payload;
    await handleFlowPostback({ instagramAccountId: "ig", userId: "user", payload, eventId: "followed_tap", timestamp: Date.now() });
    await executeFlowRun(id);

    expect(fixtures.follow).toHaveBeenCalledTimes(2);
    expect(fixtures.sendText.mock.calls.at(-1)?.[0].text).toBe("Acá está tu recurso.");
    expect(fixtures.sendMedia).toHaveBeenCalledTimes(2);
    expect(fixtures.runs[0].status).toBe("COMPLETED");
  });

  it("never delivers the gated resource when follow status cannot be verified, even after the follow button", async () => {
    fixtures.follow.mockResolvedValue(null);
    const id = await start(definitionWithFollowGate());
    await executeFlowRun(id);
    expect(fixtures.follow).not.toHaveBeenCalled();
    await reply(id);
    const payload = fixtures.sendText.mock.calls.at(-1)![0].buttons[0].payload;
    await handleFlowPostback({ instagramAccountId: "ig", userId: "user", payload, eventId: "unverified_followed_tap", timestamp: Date.now() });
    await executeFlowRun(id);

    expect(fixtures.follow).toHaveBeenCalledTimes(2);
    expect(fixtures.sendMedia).not.toHaveBeenCalled();
    expect(fixtures.sendText.mock.calls.map(([request]) => request.text)).toEqual([
      "Como va? Ahi te mando", "Seguí la cuenta para recibir el recurso.", "Seguí la cuenta para recibir el recurso.",
    ]);
    expect(fixtures.runs[0]).toMatchObject({ status: "WAITING", waitType: "BUTTON", currentNodeId: "follow_request" });
  });

  it("keeps the published version that the conversation started with", async () => {
    const id = await start(); await executeFlowRun(id);
    fixtures.versions.push({ id: "new_version", definition: definition([message("resource", "Mensaje nuevo")]) });
    fixtures.automations[0].flowPublishedVersionId = "new_version";
    await reply(id);
    expect(fixtures.sendText.mock.calls[1][0].text).toBe("Acá está tu recurso, ana.");
  });

  it("leaves an ambiguous send for review and never automatically dispatches it again", async () => {
    fixtures.sendText.mockRejectedValueOnce(new Error("connection lost after send"));
    const id = await start(); await executeFlowRun(id);
    expect(fixtures.runs[0].status).toBe("UNCERTAIN");
    expect(fixtures.logs[0].dmDeliveryUnconfirmed).toBe(true);
    await executeFlowRun(id); expect(fixtures.sendText).toHaveBeenCalledTimes(1);
  });

  it("recovers a crash after the durable send claim without resending", async () => {
    const id = await start();
    fixtures.runs[0].currentNodeId = "opening";
    fixtures.steps.push({ id: "crashed", runId: id, nodeId: "opening", visit: 0, status: "RUNNING", startedAt: now, output: { effects: { "block.0": { status: "CLAIMED" } } } });
    await executeFlowRun(id);
    expect(fixtures.runs[0].status).toBe("UNCERTAIN"); expect(fixtures.sendText).not.toHaveBeenCalled();
  });

  it("does not use an old inbound event to answer a newer question", async () => {
    const id = await start(); await executeFlowRun(id);
    await handleFlowMessage({ instagramAccountId: "ig", userId: "user", messageId: "old_event", text: "SI", timestamp: now.getTime() - 25 * 60 * 60_000 });
    expect(fixtures.runs[0].status).toBe("WAITING"); expect(messagingWindowOpen(fixtures.contacts[0].lastInboundAt as Date)).toBe(false);
    await executeFlowRun(id); expect(fixtures.sendText).toHaveBeenCalledTimes(1);
  });

  it("validates successive questions and stores each answer separately", async () => {
    const email = node("email", "input", { prompt: "Tu email", inputType: "email", fieldKey: "email", retryMessage: "Revisá el email", maxAttempts: 3, timeoutMinutes: 60 });
    const interest = node("interest", "input", { prompt: "Qué te interesa", inputType: "choice", fieldKey: "interest", retryMessage: "Elegí una opción", maxAttempts: 3, timeoutMinutes: 60, options: ["Curso", "Guía"] });
    const id = await start(definition([email, interest])); await executeFlowRun(id); await reply(id);
    expect(fixtures.runs[0].waitType).toBe("INPUT");
    await reply(id, "no es email", "bad"); expect(fixtures.sendText.mock.calls.at(-1)?.[0].text).toBe("Revisá el email");
    await reply(id, "ana@example.com", "email_answer"); expect(fixtures.contacts[0].email).toBe("ana@example.com");
    await reply(id, "Curso", "interest_answer"); expect(fixtures.contacts[0].fields).toEqual({ interest: "Curso" }); expect(fixtures.runs[0].status).toBe("COMPLETED");
  });

  it("uses a durable delay and checks the window again before sending", async () => {
    const id = await start(definition([node("delay", "delay", { minutes: 60 }), message("later", "Recordatorio")]));
    await executeFlowRun(id); await reply(id);
    expect(fixtures.runs[0].currentNodeId).toBe("later"); expect(fixtures.runs[0].resumeAt).toEqual(new Date(now.getTime() + 60 * 60_000));
    await executeFlowRun(id); expect(fixtures.sendText).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(now.getTime() + 25 * 60 * 60_000)); await executeFlowRun(id);
    expect(fixtures.runs[0].status).toBe("WAITING_WINDOW"); expect(fixtures.sendText).toHaveBeenCalledTimes(1);
    await reply(id, "Hola", "reopen"); expect(fixtures.sendText).toHaveBeenCalledTimes(2); expect(fixtures.runs[0].status).toBe("COMPLETED");
  });

  it.each([
    [30, "seconds", 30_000],
    [2, "hours", 2 * 60 * 60_000],
  ] as const)("schedules %s %s from canonical minutes and resumes at the exact deadline", async (value, unit, milliseconds) => {
    const id = await start(definition([
      node("delay", "delay", { minutes: durationToMinutes(value, unit), unit }),
      message("later", "Mensaje después de la espera"),
    ]));
    await executeFlowRun(id);
    fixtures.queue.mockClear();
    await reply(id);

    const due = new Date(now.getTime() + milliseconds);
    expect(fixtures.runs[0]).toMatchObject({ status: "RUNNING", currentNodeId: "later", resumeAt: due });
    expect(fixtures.queue).toHaveBeenLastCalledWith(id, due);
    expect(fixtures.sendText).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(due.getTime() - 1));
    await executeFlowRun(id);
    expect(fixtures.sendText).toHaveBeenCalledTimes(1);
    expect(fixtures.runs[0].resumeAt).toEqual(due);

    vi.setSystemTime(due);
    await executeFlowRun(id);
    expect(fixtures.sendText).toHaveBeenCalledTimes(2);
    expect(fixtures.sendText.mock.calls[1][0].text).toBe("Mensaje después de la espera");
    expect(fixtures.runs[0]).toMatchObject({ status: "COMPLETED", resumeAt: null });
  });

  it("restores a paused window wait and clears its deadline when a new DM arrives", async () => {
    const id = await start(definition([node("delay", "delay", { minutes: 60 }), message("later", "Recordatorio")]));
    await executeFlowRun(id); await reply(id);
    vi.setSystemTime(new Date(now.getTime() + 25 * 60 * 60_000)); await executeFlowRun(id);
    expect(fixtures.runs[0].status).toBe("WAITING_WINDOW");
    fixtures.contacts[0].automationPaused = true;
    await executeFlowRun(id);
    expect(fixtures.runs[0]).toMatchObject({ status: "PAUSED", waitType: "WINDOW" });
    fixtures.contacts[0].automationPaused = false;
    await resumeContactFlows("contact");
    expect(fixtures.runs[0]).toMatchObject({ status: "WAITING_WINDOW", waitType: null });
    await reply(id, "Hola", "window_after_pause");
    expect(fixtures.runs[0]).toMatchObject({ status: "COMPLETED", resumeAt: null });
    expect(fixtures.sendText).toHaveBeenCalledTimes(2);
  });

  it("accepts a new DM after a timed pause expired without waiting for the recovery tick", async () => {
    const id = await start(); await executeFlowRun(id);
    fixtures.runs[0].status = "PAUSED";
    fixtures.contacts[0].automationPaused = true;
    fixtures.contacts[0].automationPausedUntil = new Date(now.getTime() + 1_000);
    vi.setSystemTime(new Date(now.getTime() + 2_000));
    await reply(id);
    expect(fixtures.runs[0].status).toBe("COMPLETED");
    expect(fixtures.sendText).toHaveBeenCalledTimes(2);
  });

  it("never invents a private-reply permission for a comment without source time", async () => {
    fixtures.versions.push({ id: "version", automationId: "automation", workspaceId: "workspace", definition: definition() });
    const result = await startFlowRun({ automationId: "automation", instagramAccountId: "account", contactId: "contact", commentId: "undated", commentText: "GUIA", commenterId: "user" });
    expect(result).toBeNull(); expect(fixtures.runs).toHaveLength(0); expect(fixtures.sendText).not.toHaveBeenCalled();
  });

  it("sends media only after the user has opened the conversation", async () => {
    const id = await start(definition([node("media", "message", { blocks: [{ type: "image", url: "https://cdn.test/image.png" }, { type: "pdf", url: "https://cdn.test/guide.pdf", name: "Guía" }], buttons: [] })]));
    await executeFlowRun(id); expect(fixtures.sendMedia).not.toHaveBeenCalled(); await reply(id);
    expect(fixtures.sendMedia).toHaveBeenCalledTimes(2); expect(fixtures.sendMedia.mock.calls[1][0]).toMatchObject({ type: "pdf", userId: "user" });
  });

  it("does not advance a different step when an old button is replayed", async () => {
    const choice = node("choice", "message", { blocks: [{ type: "text", text: "Elegí" }], buttons: [{ id: "yes", label: "Sí", kind: "continue" }] });
    const graph = definition([choice]); graph.edges.find((edge) => edge.source === "choice")!.sourceHandle = "button.yes";
    const id = await start(graph); await executeFlowRun(id); await reply(id);
    expect(fixtures.runs[0].waitType).toBe("BUTTON");
    await handleFlowPostback({ instagramAccountId: "ig", userId: "user", eventId: "old_tap", timestamp: Date.now(), payload: flowButtonPayload({ runId: id, nodeId: "opening", visit: 0, buttonId: "yes" }) });
    expect(fixtures.runs[0].status).toBe("WAITING");
    await handleFlowPostback({ instagramAccountId: "ig", userId: "user", eventId: "real_tap", timestamp: Date.now(), payload: flowButtonPayload({ runId: id, nodeId: "choice", visit: 0, buttonId: "yes" }) });
    await executeFlowRun(id); expect(fixtures.runs[0].status).toBe("COMPLETED");
  });

  it("pauses a handoff and records a note without sending the subsequent automated message", async () => {
    const id = await start(definition([node("handoff", "action", { action: "handoff", note: "Atender a {username}" }), message("later", "No enviar aún")]));
    await executeFlowRun(id); await reply(id);
    expect(fixtures.contacts[0].automationPaused).toBe(true); expect(fixtures.runs[0].status).toBe("PAUSED"); expect(fixtures.sendText).toHaveBeenCalledTimes(1);
    expect((fixtures.contacts[0].notes as Row[])[0].text).toBe("Atender a ana");
    expect((fixtures.contacts[0].notes as Row[])[0]).toMatchObject({ id: expect.any(String), createdAt: now.toISOString() });
  });

  it("preserves a manual note added after loading the handoff step", async () => {
    const id = await start(definition([node("handoff", "action", { action: "handoff", note: "Atender" })]));
    await executeFlowRun(id);
    fixtures.prisma.$queryRaw.mockImplementationOnce(async () => { fixtures.contacts[0].notes = [{ id: "manual", text: "Nota del administrador", createdAt: now.toISOString() }]; return []; });
    await reply(id);
    expect(fixtures.contacts[0].notes).toEqual([
      expect.objectContaining({ id: "manual", text: "Nota del administrador" }),
      expect.objectContaining({ text: "Atender", id: expect.any(String), createdAt: now.toISOString() }),
    ]);
  });

  it("chooses an explicit unknown-follow branch and takes the HTTP error path", async () => {
    const condition = node("follows", "condition", { match: "all", rules: [{ field: "follows", operator: "equals", value: "true" }] });
    const hook = node("hook", "action", { action: "webhook", url: "https://hook.test/receive" });
    const graph = definition([condition, hook, message("failure", "No se completó")]);
    graph.edges = [graph.edges[0], graph.edges[1], { id: "yes", source: "follows", sourceHandle: "yes", target: "end" }, { id: "no", source: "follows", sourceHandle: "no", target: "hook" },
      { id: "hook_ok", source: "hook", sourceHandle: "next", target: "end" }, { id: "hook_error", source: "hook", sourceHandle: "error", target: "failure" }, { id: "done", source: "failure", sourceHandle: "next", target: "end" }];
    fixtures.http.mockResolvedValue({ status: 422 }); const id = await start(graph); await executeFlowRun(id); await reply(id);
    expect(fixtures.http).toHaveBeenCalledTimes(1); expect(fixtures.sendText.mock.calls.at(-1)?.[0].text).toBe("No se completó");
  });

  it("does not process two events concurrently for a contact whose lock is held", async () => {
    const id = await start(); fixtures.locks.set("flow:contact:contact", "another_worker");
    await expect(executeFlowRun(id)).rejects.toThrow("está siendo procesada"); expect(fixtures.sendText).not.toHaveBeenCalled();
  });

  it("keeps cancellation terminal when it happens during a message dispatch", async () => {
    const id = await start(definition([node("several", "message", { blocks: [{ type: "text", text: "Primero" }, { type: "text", text: "Segundo" }], buttons: [] })]));
    await executeFlowRun(id);
    fixtures.sendText.mockImplementationOnce(async () => { fixtures.runs[0].status = "CANCELLED"; return { message_id: "already_sent" }; });
    await reply(id);
    expect(fixtures.runs[0].status).toBe("CANCELLED"); expect(fixtures.sendText).toHaveBeenCalledTimes(2);
    await executeFlowRun(id); expect(fixtures.sendText).toHaveBeenCalledTimes(2);
  });

  it("counts a timed-out question as a visit before looping back to ask again", async () => {
    const input = node("email", "input", { prompt: "Tu email", inputType: "email", fieldKey: "email", retryMessage: "Revisá", maxAttempts: 3, timeoutMinutes: 1 });
    const graph = definition([input]); graph.edges.push({ id: "timeout_loop", source: "email", target: "email", sourceHandle: "timeout" });
    const id = await start(graph); await executeFlowRun(id); await reply(id);
    const oldPayload = fixtures.sendText.mock.calls.at(-1)?.[0].quickReplies[0].payload;
    vi.setSystemTime(new Date(now.getTime() + 61_000)); await executeFlowRun(id);
    expect(fixtures.sendText).toHaveBeenCalledTimes(3); expect((fixtures.runs[0].context as Row).waitVisit).toBe(1);
    await handleFlowPostback({ instagramAccountId: "ig", userId: "user", eventId: "expired_button", timestamp: Date.now(), payload: oldPayload });
    expect(fixtures.runs[0].status).toBe("WAITING"); expect((fixtures.runs[0].context as Row).waitVisit).toBe(1);
  });

  it("does not open the messaging window when the event has no original timestamp", async () => {
    const id = await start(); await executeFlowRun(id);
    await handleFlowMessage({ instagramAccountId: "ig", userId: "user", messageId: "undated", text: "SI" });
    expect(fixtures.contacts[0].lastInboundAt).toBeNull(); expect(fixtures.runs[0].status).toBe("WAITING");
    await executeFlowRun(id); expect(fixtures.sendText).toHaveBeenCalledTimes(1);
  });
});

describe("flow runtime validation", () => {
  it("keeps phone formatting, rejects non-numbers and checks choices", () => {
    expect(parseFlowAnswer("phone", "+54 9 11 2345 6789")).toEqual({ ok: true, value: "+5491123456789" });
    expect(parseFlowAnswer("number", "20,5")).toEqual({ ok: true, value: "20.5" }); expect(parseFlowAnswer("number", "20 pesos").ok).toBe(false);
    expect(parseFlowAnswer("choice", "otro", [{ label: "Curso" }]).ok).toBe(false);
  });
  it("uses event time, clamps future values and respects a strict 24-hour window", () => {
    expect(incomingEventTime(now.getTime() / 1000)).toBe(now.getTime()); expect(incomingEventTime(now.getTime() + 1000)).toBe(now.getTime());
    expect(messagingWindowOpen(new Date(now.getTime() - 24 * 60 * 60_000))).toBe(false);
  });
  it("rejects malformed button references and personalizes absent values with a fallback", () => {
    expect(parseFlowButtonPayload("flow.e30")).toBeNull(); expect(renderFlowText("Hola {{username|amiga}}", {})).toBe("Hola amiga");
    expect(weightedBranch([{ id: "a", weight: 20 }, { id: "b", weight: 80 }], 0.21)).toBe("b");
  });
});
