/** Opt-in persistence checks. TEST_DATABASE_URL points to a disposable
 * Postgres; every execution uses and drops its own schema. Providers and the
 * queue are simulated, so this suite never contacts Instagram or webhooks. */
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "../app/generated/prisma/client";
import type { FlowDefinition, FlowNode } from "@/lib/flows/definition";

const databaseUrl = process.env.TEST_DATABASE_URL;
const schema = `flow_test_${randomBytes(6).toString("hex")}`;
const state = vi.hoisted(() => {
  const locks = new Map<string, string>();
  return {
    db: undefined as unknown as import("../app/generated/prisma/client").PrismaClient,
    locks, sendText: vi.fn(), sendMedia: vi.fn(), sendPublic: vi.fn(), enqueue: vi.fn(),
    redis: {
      set: vi.fn(async (key: string, token: string) => { if (locks.has(key)) return null; locks.set(key, token); return "OK"; }),
      get: vi.fn(async (key: string) => locks.get(key)),
      eval: vi.fn(async (script: string, _count: number, key: string, token: string) => {
        if (locks.get(key) !== token) return 0;
        if (script.includes("DEL")) locks.delete(key);
        return 1;
      }),
    },
  };
});
vi.mock("@/lib/db/client", () => ({ get prisma() { return state.db; } }));
vi.mock("@/lib/queue/client", () => ({ getRedisConnection: () => state.redis }));
vi.mock("@/lib/flows/queue", () => ({ enqueueFlowRun: state.enqueue }));
vi.mock("@/lib/contacts/sync", () => ({ enqueueContactSync: vi.fn(async () => {}) }));
vi.mock("@/lib/flows/media", () => ({ sendFlowTextMessage: state.sendText, sendFlowMediaMessage: state.sendMedia }));
vi.mock("@/lib/flows/tracking", () => ({ buildFlowTrackedUrl: async () => "https://example.test/f/opaque" }));
vi.mock("@/lib/flows/http-action", () => ({ executeFlowHttpAction: async () => ({ status: 200 }), FlowHttpActionError: class extends Error {} }));
vi.mock("@/lib/instagram/provider", () => ({
  createInstagramContext: async () => ({ provider: "META", accessToken: "test-only" }),
  getUserFollowStatus: async () => null, sendCommentReply: state.sendPublic,
  MetaApiError: class extends Error {}, RateLimitError: class extends Error {},
}));
vi.mock("@/lib/billing/usage", () => ({ reserveWorkspaceDMSend: async () => ({ allowed: true, reserved: false }), releaseWorkspaceDMReservation: vi.fn() }));
vi.mock("@/lib/utils/rate-limiter", () => ({ reserveDMSlot: async () => ({ allowed: true, reserved: false }), releaseDMSlot: vi.fn() }));

import { executeFlowRun, handleFlowMessage, resumeContactFlows, startFlowRun } from "@/lib/flows/engine";

const node = <T extends FlowNode["type"]>(id: string, type: T, data: Extract<FlowNode, { type: T }>["data"]): FlowNode => ({ id, type, data, label: id, position: { x: 0, y: 0 } }) as FlowNode;
const message = (id: string, text: string) => node(id, "message", { blocks: [{ type: "text", text }], buttons: [] });
function graph(middle: FlowNode[] = [message("resource", "Tu recurso")]): FlowDefinition {
  const nodes = [node("start", "start", {}), message("opening", "Respondé SI"), ...middle, node("end", "end", {})];
  return { schemaVersion: 1, entryNodeId: "start", nodes, edges: nodes.slice(0, -1).map((source, index) => ({ id: `e_${index}`, source: source.id, target: nodes[index + 1].id, sourceHandle: source.type === "input" ? "answered" : "next" })) };
}
async function publish(definition = graph(), publicReplyEnabled = false) {
  await state.db.automation.create({ data: { id: "flow_campaign", workspaceId: "flow_workspace", instagramAccountId: "flow_account", name: "Integration", keywords: ["GUIA"], dmMessage: "legacy", flowEnabled: true, publicReplyEnabled, publicReplyMessages: ["Te escribí, {username}."] } });
  await state.db.flowVersion.create({ data: { id: "flow_version", workspaceId: "flow_workspace", automationId: "flow_campaign", version: 1, definition: definition as unknown as Prisma.InputJsonValue, publishedAt: new Date() } });
  await state.db.automation.update({ where: { id: "flow_campaign" }, data: { flowPublishedVersionId: "flow_version" } });
}
const startInput = () => ({ automationId: "flow_campaign", instagramAccountId: "flow_account", contactId: "flow_contact", commentId: "flow_comment", commentText: "GUIA", commenterId: "flow_person", commenterName: "ana", mediaId: "flow_reel", timestamp: Date.now() });
async function start(definition = graph(), publicEnabled = false) {
  await publish(definition, publicEnabled);
  return (await startFlowRun(startInput()))!.id;
}
async function answer(runId: string, text = "SI", messageId = "flow_inbound") {
  await handleFlowMessage({ instagramAccountId: "flow_ig", userId: "flow_person", messageId, text, timestamp: Date.now() });
  await executeFlowRun(runId);
}

describe.skipIf(!databaseUrl)("flow persistence on real Postgres", () => {
  let sql: Client;
  beforeAll(async () => {
    sql = new Client({ connectionString: databaseUrl });
    await sql.connect();
    await sql.query(`CREATE SCHEMA "${schema}"`);
    await sql.query(`SET search_path TO "${schema}"`);
    const migrationsDir = path.join(__dirname, "..", "prisma", "migrations");
    const migrations = readdirSync(migrationsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    for (const migration of migrations) await sql.query(readFileSync(path.join(migrationsDir, migration, "migration.sql"), "utf8"));
    state.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, options: `-c search_path=${schema}` }, { schema }) });
  }, 60_000);
  afterAll(async () => {
    await state.db?.$disconnect();
    if (sql) { await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await sql.end(); }
  });
  beforeEach(async () => {
    vi.clearAllMocks(); state.locks.clear();
    state.sendText.mockReset().mockResolvedValue({ message_id: "flow_sent" });
    state.sendMedia.mockReset().mockResolvedValue({ message_id: "flow_media" });
    state.sendPublic.mockReset().mockResolvedValue({ id: "flow_reply" });
    state.enqueue.mockResolvedValue(undefined);
    await state.db.flowEventReceipt.deleteMany();
    await state.db.user.deleteMany();
    await state.db.user.create({ data: { id: "flow_user", email: "flow@example.test" } });
    await state.db.workspace.create({ data: { id: "flow_workspace", name: "Flows test", ownerId: "flow_user" } });
    await state.db.instagramAccount.create({ data: { id: "flow_account", workspaceId: "flow_workspace", instagramId: "flow_ig", username: "brand", accessToken: "test-only" } });
    await state.db.contact.create({ data: { id: "flow_contact", workspaceId: "flow_workspace", igAccountId: "flow_ig", igsid: "flow_person", username: "ana", fields: { points: "0" } } });
  });

  it("deduplicates concurrent starts and public/private sends through persisted constraints", async () => {
    await publish(graph(), true);
    const [first, second] = await Promise.all([startFlowRun(startInput()), startFlowRun(startInput())]);
    expect(first!.id).toBe(second!.id);
    expect(await state.db.flowRun.count()).toBe(1);
    await executeFlowRun(first!.id); await executeFlowRun(first!.id);
    expect(state.sendPublic).toHaveBeenCalledTimes(1); expect(state.sendText).toHaveBeenCalledTimes(1);
    const log = await state.db.dmLog.findFirstOrThrow({ where: { automationId: "flow_campaign" } });
    expect(log.status).toBe("SENT"); expect(log.publicReplySentAt).toBeInstanceOf(Date);
    await answer(first!.id);
    expect((await state.db.flowRun.findUniqueOrThrow({ where: { id: first!.id } })).status).toBe("COMPLETED");
    expect(state.sendPublic).toHaveBeenCalledTimes(1); expect(state.sendText).toHaveBeenCalledTimes(2);
  });

  it("keeps cancellation terminal when the provider call is still in progress", async () => {
    const id = await start(graph([node("blocks", "message", { blocks: [{ type: "text", text: "Primero" }, { type: "text", text: "Segundo" }], buttons: [] })]));
    await executeFlowRun(id);
    state.sendText.mockImplementationOnce(async () => { await state.db.flowRun.update({ where: { id }, data: { status: "CANCELLED" } }); return { message_id: "first_already_sent" }; });
    await answer(id);
    expect(state.sendText).toHaveBeenCalledTimes(2);
    expect((await state.db.flowRun.findUniqueOrThrow({ where: { id } })).status).toBe("CANCELLED");
    await executeFlowRun(id); expect(state.sendText).toHaveBeenCalledTimes(2);
  });

  it("persists fields, tags and branching while counting an increment only once", async () => {
    const increment = node("increment", "action", { action: "increment_field", fieldKey: "points", value: "2" });
    const tag = node("tag", "action", { action: "add_tag", tag: "Interesado" });
    const condition = node("condition", "condition", { match: "all", rules: [{ field: "points", operator: "equals", value: "2" }, { field: "tag", operator: "equals", value: "Interesado" }] });
    const definition = graph([increment, tag, condition, message("success", "Listo")]);
    definition.edges.find((edge) => edge.source === "condition")!.sourceHandle = "yes";
    definition.edges.push({ id: "no", source: "condition", target: "end", sourceHandle: "no" });
    const id = await start(definition); await executeFlowRun(id); await answer(id); await executeFlowRun(id);
    const contact = await state.db.contact.findUniqueOrThrow({ where: { id: "flow_contact" }, include: { tags: { include: { tag: true } } } });
    expect(contact.fields).toEqual({ points: "2" }); expect(contact.tags[0].tag.name).toBe("Interesado");
    expect(state.sendText.mock.calls.at(-1)?.[0].text).toBe("Listo");
    expect(await state.db.flowStepRun.count({ where: { runId: id, nodeId: "increment", status: "COMPLETED" } })).toBe(1);
  });

  it("commits handoff, note, step completion and continuation together", async () => {
    const id = await start(graph([node("handoff", "action", { action: "handoff", note: "Atender a {username}" }), message("later", "Continuamos")]));
    await executeFlowRun(id); await answer(id);
    const paused = await state.db.flowRun.findUniqueOrThrow({ where: { id }, include: { contact: true, steps: true } });
    expect(paused.error).toBeNull();
    expect(paused).toMatchObject({ status: "PAUSED", currentNodeId: "later" });
    expect(paused.contact.automationPaused).toBe(true);
    expect(paused.contact.notes).toEqual([expect.objectContaining({ id: expect.any(String), text: "Atender a ana", createdAt: expect.any(String) })]);
    expect(paused.steps.find((step) => step.nodeId === "handoff")?.status).toBe("COMPLETED");
    await state.db.contact.update({ where: { id: "flow_contact" }, data: { automationPaused: false } });
    await resumeContactFlows("flow_contact"); await executeFlowRun(id);
    expect((await state.db.flowRun.findUniqueOrThrow({ where: { id } })).status).toBe("COMPLETED");
    expect((await state.db.contact.findUniqueOrThrow({ where: { id: "flow_contact" } })).notes).toHaveLength(1);
  });

  it("rolls back a field increment when completing its step fails, then safely resumes", async () => {
    const id = await start(graph([node("increment", "action", { action: "increment_field", fieldKey: "points", value: "2" }), message("later", "Listo")]));
    await executeFlowRun(id);
    // This DB failure occurs after the transaction has advanced the run and
    // modified the contact. All three writes must roll back together.
    await sql.query(`CREATE FUNCTION reject_increment_step() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."nodeId" = 'increment' AND NEW."status" = 'COMPLETED' THEN RAISE EXCEPTION 'simulated completion failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_increment BEFORE UPDATE ON "FlowStepRun" FOR EACH ROW EXECUTE FUNCTION reject_increment_step();`);
    try {
      await answer(id);
      const interrupted = await state.db.flowRun.findUniqueOrThrow({ where: { id }, include: { contact: true } });
      expect(interrupted).toMatchObject({ status: "FAILED", currentNodeId: "increment" });
      expect(interrupted.contact.fields).toEqual({ points: "0" });
      expect((await state.db.flowStepRun.findFirstOrThrow({ where: { runId: id, nodeId: "increment" } })).status).toBe("FAILED");
    } finally {
      await sql.query('DROP TRIGGER reject_increment ON "FlowStepRun"; DROP FUNCTION reject_increment_step();');
    }
    await state.db.flowRun.update({ where: { id }, data: { status: "RUNNING", error: null } });
    await executeFlowRun(id);
    expect((await state.db.contact.findUniqueOrThrow({ where: { id: "flow_contact" } })).fields).toEqual({ points: "2" });
    expect((await state.db.flowRun.findUniqueOrThrow({ where: { id } })).status).toBe("COMPLETED");
  });

  it("does not resend a durable claim left behind by a lost acknowledgement", async () => {
    const id = await start();
    await state.db.flowRun.update({ where: { id }, data: { currentNodeId: "opening" } });
    await state.db.flowStepRun.create({ data: { runId: id, nodeId: "opening", visit: 0, status: "RUNNING", output: { effects: { "block.0": { status: "CLAIMED", startedAt: Date.now() } } } } });
    await executeFlowRun(id); await executeFlowRun(id);
    expect(state.sendText).not.toHaveBeenCalled();
    expect((await state.db.flowRun.findUniqueOrThrow({ where: { id } })).status).toBe("UNCERTAIN");
  });
});
