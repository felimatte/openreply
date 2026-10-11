/** Runs only against the explicitly supplied disposable local MUSA QA database. */
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";

const state = vi.hoisted(() => ({ db: undefined as unknown as import("@/app/generated/prisma/client").PrismaClient }));
vi.mock("@/lib/db/client", () => ({ get prisma() { return state.db; } }));
import { createMusaPairingCode, exchangeMusaPairingCode } from "@/lib/integrations/musa/pairing";
import { hashMusaCredential, requireMusaConnection } from "@/lib/integrations/musa/auth";
import { GET as summaryRoute } from "@/app/api/integrations/musa/v1/summary/route";
import { GET as campaignsRoute } from "@/app/api/integrations/musa/v1/campaigns/route";
import { DELETE as revokeRoute } from "@/app/api/integrations/musa/v1/connection/route";

const databaseUrl = process.env.MUSA_TEST_DATABASE_URL;
const prefix = `qa-identity-${randomUUID()}`;
const id = (suffix: string) => `${prefix}-${suffix}`;
const businesses = { a: randomUUID(), b: randomUUID() };
const from = "2026-10-01T00:00:00.000Z", to = "2026-10-11T00:00:00.000Z";

function apiRequest(path: string, token: string, businessId: string, method = "GET") {
  return new Request(`https://openreply.example/api/integrations/musa/v1/${path}`, { method, headers: { authorization: `Bearer ${token}`, "X-Musa-Business-Id": businessId } });
}

describe.skipIf(!databaseUrl)("MUSA grants and metrics against PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== "57322" || url.pathname !== "/openreply_musa_qa") throw new Error("MUSA identity tests require the disposable local QA database.");
    state.db = new PrismaClient({ adapter: new PrismaPg(databaseUrl!) });
    await state.db.user.createMany({ data: ["owner-a", "owner-b", "admin-a", "member-a"].map((suffix) => ({ id: id(suffix) })) });
    await state.db.workspace.createMany({ data: [
      { id: id("workspace-a"), name: "QA client A", ownerId: id("owner-a") },
      { id: id("workspace-b"), name: "QA client B", ownerId: id("owner-b") },
      { id: id("workspace-c"), name: "QA binding race", ownerId: id("owner-a") },
    ] });
    await state.db.workspaceMember.createMany({ data: [
      { workspaceId: id("workspace-a"), userId: id("owner-a"), role: "OWNER" },
      { workspaceId: id("workspace-a"), userId: id("admin-a"), role: "ADMIN" },
      { workspaceId: id("workspace-a"), userId: id("member-a"), role: "MEMBER" },
      { workspaceId: id("workspace-b"), userId: id("owner-b"), role: "OWNER" },
      { workspaceId: id("workspace-c"), userId: id("owner-a"), role: "OWNER" },
    ] });
    await state.db.instagramAccount.createMany({ data: [
      { id: id("account-a"), workspaceId: id("workspace-a"), instagramId: id("ig-a"), username: "qa_a", accessToken: "unused-fake-token" },
      { id: id("account-a2"), workspaceId: id("workspace-a"), instagramId: id("ig-a2"), username: "qa_a2", accessToken: "unused-fake-token" },
      { id: id("account-b"), workspaceId: id("workspace-b"), instagramId: id("ig-b"), username: "qa_b", accessToken: "unused-fake-token" },
      { id: id("account-c"), workspaceId: id("workspace-c"), instagramId: id("ig-c"), username: "qa_c", accessToken: "unused-fake-token" },
    ] });
    await state.db.automation.createMany({ data: [
      { id: id("campaign-a"), name: "QA A draft", workspaceId: id("workspace-a"), instagramAccountId: id("account-a"), keywords: ["TEST"], dmMessage: "Never sent", isActive: false, pendingNextReel: true },
      { id: id("campaign-a2"), name: "QA A unrelated", workspaceId: id("workspace-a"), instagramAccountId: id("account-a2"), keywords: ["TEST"], dmMessage: "Never sent", isActive: false },
      { id: id("campaign-b"), name: "QA B draft", workspaceId: id("workspace-b"), instagramAccountId: id("account-b"), keywords: ["TEST"], dmMessage: "Never sent", isActive: false },
    ] });
    const log = (suffix: string, status: "SENT" | "FAILED" | "SKIPPED_DEDUP", extra = {}) => ({
      id: id(suffix), workspaceId: id("workspace-a"), instagramAccountId: id("account-a"), automationId: id("campaign-a"),
      commenterId: "person-a", commentId: id(suffix), commentText: "test", createdAt: new Date("2026-10-05T12:00:00Z"), status, ...extra,
    });
    await state.db.dmLog.createMany({ data: [
      log("sent", "SENT"), log("failed", "FAILED", { commenterId: "person-b" }),
      log("unconfirmed", "FAILED", { dmDeliveryUnconfirmed: true }), log("skipped", "SKIPPED_DEDUP"),
      log("before", "SENT", { createdAt: new Date("2026-09-30T23:59:59Z") }),
      log("boundary", "SENT", { createdAt: new Date(to) }),
      log("other-account", "SENT", { instagramAccountId: id("account-a2"), automationId: id("campaign-a2") }),
      log("other-workspace", "SENT", { workspaceId: id("workspace-b"), instagramAccountId: id("account-b"), automationId: id("campaign-b") }),
    ] });
    await state.db.trackedLink.create({ data: { id: id("tracked"), workspaceId: id("workspace-a"), automationId: id("campaign-a"), slug: id("slug"), destinationUrl: "https://example.com/qa" } });
    await state.db.linkClick.create({ data: { workspaceId: id("workspace-a"), instagramAccountId: id("account-a"), automationId: id("campaign-a"), trackedLinkId: id("tracked"), createdAt: new Date("2026-10-05T12:00:00Z") } });
  });

  afterAll(async () => {
    if (!state.db) return;
    await state.db.user.deleteMany({ where: { id: { in: ["owner-a", "owner-b", "admin-a", "member-a"].map(id) } } });
    await state.db.$disconnect();
  });

  async function pair(suffix: "a" | "b" = "a") {
    const code = await createMusaPairingCode(id(`workspace-${suffix}`), id(suffix === "a" ? "admin-a" : "owner-b"), [id(`account-${suffix}`)]);
    const businessId = businesses[suffix];
    return { ...await exchangeMusaPairingCode({ code: code.code, businessId, businessName: `QA ${suffix}` }), businessId };
  }

  it("consumes a pairing code exactly once under concurrent PostgreSQL transactions", async () => {
    const code = await createMusaPairingCode(id("workspace-a"), id("admin-a"), [id("account-a")]);
    const input = { code: code.code, businessId: businesses.a, businessName: "Concurrent QA" };
    const outcomes = await Promise.allSettled([exchangeMusaPairingCode(input), exchangeMusaPairingCode(input)]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect(await state.db.musaConnection.count({ where: { businessId: input.businessId } })).toBe(1);
    const persisted = await state.db.musaPairingCode.findUniqueOrThrow({ where: { codeHash: hashMusaCredential(code.code) } });
    expect(persisted.consumedAt).toBeInstanceOf(Date);
  });

  it("refuses expired codes, non-administrators and accounts in another workspace", async () => {
    const code = await createMusaPairingCode(id("workspace-a"), id("admin-a"), [id("account-a")]);
    await state.db.musaPairingCode.update({ where: { codeHash: hashMusaCredential(code.code) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(exchangeMusaPairingCode({ code: code.code, businessId: randomUUID(), businessName: "Expired" })).rejects.toMatchObject({ code: "PAIRING_CODE_UNAVAILABLE" });
    await expect(createMusaPairingCode(id("workspace-a"), id("member-a"), [id("account-a")])).rejects.toMatchObject({ status: 403 });
    await expect(createMusaPairingCode(id("workspace-a"), id("admin-a"), [id("account-b")])).rejects.toMatchObject({ status: 403 });
  });

  it("does not revoke a persisted grant when distinct codes race for the same business", async () => {
    const businessId = businesses.a;
    const [firstCode, secondCode] = await Promise.all([
      createMusaPairingCode(id("workspace-a"), id("admin-a"), [id("account-a")]),
      createMusaPairingCode(id("workspace-a"), id("admin-a"), [id("account-a")]),
    ]);
    const [first, second] = await Promise.all([
      exchangeMusaPairingCode({ code: firstCode.code, businessId, businessName: "Concurrent persistence" }),
      exchangeMusaPairingCode({ code: secondCode.code, businessId, businessName: "Concurrent persistence" }),
    ]);
    // Suppose MUSA stored first and its unique business constraint rejected second.
    expect((await revokeRoute(apiRequest("connection", second.token, businessId, "DELETE"))).status).toBe(200);
    await expect(requireMusaConnection(apiRequest("accounts", first.token, businessId))).resolves.toMatchObject({ connectionId: first.connectionId });
    await expect(requireMusaConnection(apiRequest("accounts", second.token, businessId))).rejects.toMatchObject({ status: 401 });
  });

  it("isolates two businesses, accounts, campaigns and actual metrics", async () => {
    const a = await pair(); const b = await pair("b");
    await expect(requireMusaConnection(apiRequest("accounts", a.token, b.businessId))).rejects.toMatchObject({ status: 401 });
    const foreign = await summaryRoute(apiRequest(`summary?${new URLSearchParams({ accountId: id("account-b"), from, to })}`, a.token, a.businessId));
    expect(foreign.status).toBe(403);
    const sibling = await summaryRoute(apiRequest(`summary?${new URLSearchParams({ accountId: id("account-a2"), from, to })}`, a.token, a.businessId));
    expect(sibling.status).toBe(403);
    const response = await summaryRoute(apiRequest(`summary?${new URLSearchParams({ accountId: id("account-a"), from, to })}`, a.token, a.businessId));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ version: 1, from, to, metrics: { sent: 1, failed: 1, skipped: 1, unconfirmed: 1, clicks: 1, contacts: 2, ctr: 100 } });
    const campaigns = await campaignsRoute(apiRequest(`campaigns?accountId=${id("account-a")}`, a.token, a.businessId));
    expect(await campaigns.json()).toEqual({ version: 1, campaigns: [{ id: id("campaign-a"), name: "QA A draft", status: "paused", instagramMediaId: null, canAttach: true }] });
  });

  it("serializes different businesses pairing one workspace and preserves its client after revocation", async () => {
    const codes = await Promise.all([0, 1].map(() => createMusaPairingCode(id("workspace-c"), id("owner-a"), [id("account-c")])));
    const inputs = codes.map((code) => ({ code: code.code, businessId: randomUUID(), businessName: "Client race" }));
    const outcomes = await Promise.allSettled(inputs.map(exchangeMusaPairingCode));
    const winnerIndex = outcomes.findIndex((outcome) => outcome.status === "fulfilled");
    const loserIndex = 1 - winnerIndex;
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes[loserIndex]).toMatchObject({ status: "rejected", reason: { code: "WORKSPACE_ALREADY_BOUND" } });
    const persisted = await state.db.workspace.findUniqueOrThrow({ where: { id: id("workspace-c") } });
    expect(persisted.musaBusinessId).toBe(inputs[winnerIndex].businessId);
    const losingCode = await state.db.musaPairingCode.findUniqueOrThrow({ where: { codeHash: hashMusaCredential(codes[loserIndex].code) } });
    expect(losingCode.consumedAt).toBeNull();
    await state.db.musaConnection.updateMany({ where: { workspaceId: id("workspace-c") }, data: { revokedAt: new Date() } });
    await expect(exchangeMusaPairingCode(inputs[loserIndex])).rejects.toMatchObject({ code: "WORKSPACE_ALREADY_BOUND" });
    // The original client may reconnect without affecting any unrelated workspace.
    await expect(exchangeMusaPairingCode({ ...inputs[loserIndex], businessId: inputs[winnerIndex].businessId })).resolves.toMatchObject({ workspace: { id: id("workspace-c") } });
  });

  it("stops future calls after revocation or issuer role loss", async () => {
    const a = await pair();
    expect((await revokeRoute(apiRequest("connection", a.token, a.businessId, "DELETE"))).status).toBe(200);
    await expect(requireMusaConnection(apiRequest("accounts", a.token, a.businessId))).rejects.toMatchObject({ status: 401 });
    const another = await pair();
    const where = { workspaceId_userId: { workspaceId: id("workspace-a"), userId: id("admin-a") } };
    await state.db.workspaceMember.update({ where, data: { role: "MEMBER" } });
    try { await expect(requireMusaConnection(apiRequest("accounts", another.token, another.businessId))).rejects.toMatchObject({ code: "GRANT_REVOKED" }); }
    finally { await state.db.workspaceMember.update({ where, data: { role: "ADMIN" } }); }
  });

  it("stops calls when an account moves out of its granted workspace", async () => {
    const a = await pair();
    await state.db.instagramAccount.update({ where: { id: id("account-a") }, data: { workspaceId: id("workspace-b") } });
    try { await expect(requireMusaConnection(apiRequest("accounts", a.token, a.businessId))).rejects.toMatchObject({ code: "ACCOUNT_SCOPE_CHANGED" }); }
    finally { await state.db.instagramAccount.update({ where: { id: id("account-a") }, data: { workspaceId: id("workspace-a") } }); }
  });
});
