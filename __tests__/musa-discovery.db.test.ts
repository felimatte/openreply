/** No provider calls; PostgreSQL is explicitly disposable and required in CI. */
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
const state = vi.hoisted(() => ({ db: undefined as unknown as PrismaClient, exchange: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ get prisma() { return state.db; } }));
vi.mock("@/lib/integrations/musa/discovery-provider", () => ({ exchangeDiscoveryGrant: state.exchange }));
import { hashMusaCredential } from "@/lib/integrations/musa/auth";
import { issueDiscoveryTicket, beginDiscovery, claimDiscovery, finishDiscovery, revokeDiscovery } from "@/lib/integrations/musa/discovery-authorization";

const databaseUrl = process.env.MUSA_TEST_DATABASE_URL;
const prefix = `qa-discovery-${randomUUID()}`, id = (suffix: string) => `${prefix}-${suffix}`;
const businessId = randomUUID(), credential = `musa_${"d".repeat(43)}`;
const request = () => new Request("https://openreply.example/api/integrations/musa/v1/analytics/authorizations", {
  headers: { authorization: `Bearer ${credential}`, "x-musa-business-id": businessId },
});
const result = () => ({ token: "fake-facebook-credential", facebookUserId: "111", facebookInstagramId: "222", instagramUserId: "333",
  pageId: "444", scopes: ["instagram_basic"], expiresAt: new Date(Date.now() + 3600_000) });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

describe.skipIf(!databaseUrl)("Discovery consent against PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "57322" || url.pathname !== "/openreply_musa_qa") throw new Error("Disposable MUSA QA database required.");
    vi.stubEnv("FACEBOOK_APP_ID", "1234"); vi.stubEnv("FACEBOOK_APP_SECRET", "fake-secret");
    vi.stubEnv("NEXTAUTH_URL", "https://openreply.example"); vi.stubEnv("MUSA_APP_ORIGIN", "https://musa.example"); vi.stubEnv("ENCRYPTION_KEY", "1".repeat(64));
    state.db = new PrismaClient({ adapter: new PrismaPg(databaseUrl!) });
    await state.db.user.create({ data: { id: id("owner") } });
    await state.db.workspace.create({ data: { id: id("workspace"), name: "QA", ownerId: id("owner") } });
    await state.db.workspaceMember.create({ data: { workspaceId: id("workspace"), userId: id("owner"), role: "OWNER" } });
    await state.db.instagramAccount.create({ data: { id: id("account"), workspaceId: id("workspace"), instagramId: "333", username: "qa_discovery", provider: "META", accessToken: "fake-original-ciphertext" } });
    await state.db.musaConnection.create({ data: { id: id("connection"), workspaceId: id("workspace"), businessId, businessName: "QA", grantedByUserId: id("owner"), allowedAccountIds: [id("account")], tokenHash: hashMusaCredential(credential) } });
    state.exchange.mockImplementation(async () => result());
  });
  afterAll(async () => {
    if (state.db) { await state.db.user.deleteMany({ where: { id: id("owner") } }); await state.db.$disconnect(); }
    vi.unstubAllEnvs();
  });
  async function ticket() {
    const issued = await issueDiscoveryTicket(request(), { accountId: id("account"), returnPath: `/b/shop/m/content_studio/competencia?cuenta=${id("account")}` });
    return new URL(issued.url).searchParams.get("ticket")!;
  }
  async function started() {
    const start = await beginDiscovery(await ticket(), id("owner"));
    return { state: new URL(start.url).searchParams.get("state")!, browser: start.browser };
  }
  async function claim() { const start = await started(); return claimDiscovery(start.state, start.browser, id("owner")); }
  const grant = () => state.db.musaDiscoveryGrant.findUnique({ where: { connectionId_accountId: { connectionId: id("connection"), accountId: id("account") } } });

  it("consumes one state exactly once under concurrent callbacks", async () => {
    const start = await started();
    const outcomes = await Promise.allSettled([0, 1].map(() => claimDiscovery(start.state, start.browser, id("owner"))));
    expect(outcomes.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(item => item.status === "rejected")).toHaveLength(1);
    expect(state.exchange).not.toHaveBeenCalled();
  });
  it("a newer ticket or a cancellation prevents an older exchanged callback from saving", async () => {
    for (const cancel of [false, true]) {
      const claimed = await claim(), entered = deferred<void>(), release = deferred<ReturnType<typeof result>>();
      state.exchange.mockImplementationOnce(() => { entered.resolve(); return release.promise; });
      const finishing = finishDiscovery(claimed, "fake-code", new AbortController().signal);
      const rejected = expect(finishing).rejects.toMatchObject({ code: "DISCOVERY_UNAVAILABLE" });
      await entered.promise;
      const newer = await ticket(); if (cancel) await revokeDiscovery(newer, id("owner"));
      release.resolve(result()); await rejected;
      expect(await grant()).toBeNull();
    }
  });
  it("local disconnect clears a saved credential and prevents its callback from restoring it", async () => {
    const claimed = await claim(); await finishDiscovery(claimed, "fake-code", new AbortController().signal);
    expect((await grant())?.encryptedToken).toBeTruthy();
    await revokeDiscovery(await ticket(), id("owner"));
    expect(await grant()).toMatchObject({ encryptedToken: null, revokedAt: expect.any(Date) });
    await expect(finishDiscovery(claimed, "fake-code", new AbortController().signal)).rejects.toThrow();
    expect(await grant()).toMatchObject({ encryptedToken: null });
  });
  it("global disconnect clears tokens and pending states atomically, including an in-flight exchange", async () => {
    await finishDiscovery(await claim(), "fake-code", new AbortController().signal);
    const claimed = await claim(), entered = deferred<void>(), release = deferred<ReturnType<typeof result>>();
    state.exchange.mockImplementationOnce(() => { entered.resolve(); return release.promise; });
    const finishing = finishDiscovery(claimed, "fake-code", new AbortController().signal);
    const rejected = expect(finishing).rejects.toThrow(); await entered.promise;
    await state.db.$transaction(async tx => {
      await tx.musaConnection.update({ where: { id: id("connection") }, data: { revokedAt: new Date() } });
      expect(await tx.musaDiscoveryGrant.findFirst({ where: { connectionId: id("connection") } })).toMatchObject({ encryptedToken: null, revokedAt: expect.any(Date) });
      expect(await tx.musaDiscoveryFlow.findFirst({ where: { connectionId: id("connection") } })).toMatchObject({ stateHash: null, browserHash: null, consumedAt: expect.any(Date) });
    });
    release.resolve(result()); await rejected;
    expect(await grant()).toMatchObject({ encryptedToken: null });
  });
});
