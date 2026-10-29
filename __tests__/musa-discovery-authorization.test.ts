import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  connection: vi.fn(), membership: vi.fn(), accounts: vi.fn(), workspace: vi.fn(),
  flowFind: vi.fn(), flowFirst: vi.fn(), flowUpdate: vi.fn(), flowUpsert: vi.fn(), grantUpsert: vi.fn(), grantUpdate: vi.fn(),
  exchange: vi.fn(), currentUser: vi.fn(),
}));
vi.mock("@/lib/db/client", () => {
  const db = { musaConnection: { findUnique: mocks.connection }, workspaceMember: { findUnique: mocks.membership },
    instagramAccount: { findMany: mocks.accounts }, workspace: { findUnique: mocks.workspace },
    musaDiscoveryFlow: { findUnique: mocks.flowFind, findFirst: mocks.flowFirst, updateMany: mocks.flowUpdate, upsert: mocks.flowUpsert },
    musaDiscoveryGrant: { upsert: mocks.grantUpsert, updateMany: mocks.grantUpdate } };
  return { prisma: { ...db, $transaction: async (run: (tx: typeof db) => Promise<unknown>) => run(db) } };
});
vi.mock("@/lib/integrations/musa/discovery-provider", () => ({ exchangeDiscoveryGrant: mocks.exchange }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.currentUser }));
import { hashMusaCredential } from "@/lib/integrations/musa/auth";
import { decryptToken } from "@/lib/meta/oauth";
import { issueDiscoveryTicket, discoveryTicket, beginDiscovery, claimDiscovery, finishDiscovery, revokeDiscovery } from "@/lib/integrations/musa/discovery-authorization";
import { POST as startRoute } from "@/app/integrations/musa/discovery/route";
import { GET as callback } from "@/app/api/integrations/musa/discovery/callback/route";
import { DISCOVERY_COOKIE, DISCOVERY_SCOPES } from "@/lib/integrations/musa/discovery-config";
import { discoveryPage } from "@/lib/integrations/musa/discovery-page";

const ticket = "t".repeat(43), state = "s".repeat(43), browser = "b".repeat(43);
const account = { id: "account-a", workspaceId: "workspace-a", provider: "META", instagramId: "5678", accessToken: "original-ciphertext", username: "own" };
const grant = { id: "grant-a", workspaceId: "workspace-a", businessId: "business-a", businessName: "Own business", grantedByUserId: "user-a", allowedAccountIds: ["account-a"], revokedAt: null };
const flow = () => ({ id: "flow-a", connectionId: "grant-a", accountId: "account-a", ticketHash: hashMusaCredential(ticket),
  stateHash: null, browserHash: null, actorUserId: null, accountTokenHash: hashMusaCredential(account.accessToken), instagramId: account.instagramId,
  returnPath: "/b/shop/m/content_studio/competencia?cuenta=account-a", expiresAt: new Date(Date.now() + 600_000), consumedAt: null, createdAt: new Date() });
const claimedFlow = () => ({ ...flow(), stateHash: hashMusaCredential(state), browserHash: hashMusaCredential(browser), actorUserId: "user-a" });
const bridgeRequest = () => new Request("https://openreply.example/api/integrations/musa/v1/analytics/authorizations", {
  headers: { authorization: `Bearer musa_${"a".repeat(43)}`, "x-musa-business-id": "business-a" },
});
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("FACEBOOK_APP_ID", "1234"); vi.stubEnv("FACEBOOK_APP_SECRET", "fake-secret");
  vi.stubEnv("NEXTAUTH_URL", "https://openreply.example"); vi.stubEnv("MUSA_APP_ORIGIN", "https://musa.example"); vi.stubEnv("ENCRYPTION_KEY", "1".repeat(64));
  mocks.connection.mockResolvedValue(grant); mocks.membership.mockResolvedValue({ role: "ADMIN" }); mocks.accounts.mockResolvedValue([account]);
  mocks.workspace.mockResolvedValue({ id: "workspace-a", name: "Test" }); mocks.flowFind.mockResolvedValue(flow());
  mocks.flowFirst.mockResolvedValue(claimedFlow()); mocks.flowUpdate.mockResolvedValue({ count: 1 }); mocks.currentUser.mockResolvedValue("user-a");
  mocks.exchange.mockResolvedValue({ token: "private-facebook-token", facebookUserId: "9012", facebookInstagramId: "3333", instagramUserId: "5678",
    pageId: "4444", scopes: ["instagram_basic"], expiresAt: new Date(Date.now() + 3600_000) });
});
afterEach(() => vi.unstubAllEnvs());

describe("MUSA-scoped Discovery authorization", () => {
  it("issues only an expiring hashed ticket for the exact granted account", async () => {
    const result = await issueDiscoveryTicket(bridgeRequest(), { accountId: account.id, returnPath: flow().returnPath });
    expect(result).toMatchObject({ connectionId: grant.id, accountId: account.id });
    const raw = new URL(result.url).searchParams.get("ticket")!;
    expect(mocks.flowUpsert.mock.calls[0][0].create.ticketHash).toBe(hashMusaCredential(raw));
    expect(JSON.stringify(mocks.flowUpsert.mock.calls)).not.toContain(raw);
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
  it.each(["missing", "revoked", "wrong-business", "member", "other-account"])("denies ticket outside the live scope: %s", async kind => {
    if (kind === "missing") mocks.connection.mockResolvedValue(null);
    if (kind === "revoked") mocks.connection.mockResolvedValue({ ...grant, revokedAt: new Date() });
    if (kind === "wrong-business") mocks.connection.mockResolvedValue({ ...grant, businessId: "other" });
    if (kind === "member") mocks.membership.mockResolvedValue({ role: "MEMBER" });
    if (kind === "other-account") mocks.accounts.mockResolvedValue([]);
    await expect(issueDiscoveryTicket(bridgeRequest(), { accountId: account.id, returnPath: flow().returnPath })).rejects.toThrow();
    expect(mocks.flowUpsert).not.toHaveBeenCalled();
  });
  it.each([{ consumedAt: new Date() }, { stateHash: "started" }, { expiresAt: new Date(0) }, { instagramId: "9999" }, { accountTokenHash: "changed" }])("rejects stale or changed ticket %j", async changed => {
    mocks.flowFind.mockResolvedValue({ ...flow(), ...changed }); await expect(discoveryTicket(ticket, "user-a")).rejects.toThrow();
  });
  it("binds the OAuth state to the signed-in actor and a separate browser cookie", async () => {
    const result = await beginDiscovery(ticket, "user-a"), oauthState = new URL(result.url).searchParams.get("state")!;
    expect(result.browser).not.toBe(oauthState);
    expect(mocks.flowUpdate.mock.calls[0][0].data).toMatchObject({ actorUserId: "user-a", stateHash: hashMusaCredential(oauthState), browserHash: hashMusaCredential(result.browser) });
  });
  it("rejects a claimed state before exchanging any code", async () => {
    mocks.flowUpdate.mockResolvedValue({ count: 0 });
    await expect(claimDiscovery(state, browser, "user-a")).rejects.toThrow(); expect(mocks.exchange).not.toHaveBeenCalled();
  });
  it("uses actor, cookie, expiry and consumed state in the atomic claim", async () => {
    await claimDiscovery(state, browser, "user-a");
    expect(mocks.flowUpdate.mock.calls[0][0].where).toMatchObject({ actorUserId: "user-a", browserHash: hashMusaCredential(browser), consumedAt: null, expiresAt: { gt: expect.any(Date) } });
  });
  it("never saves after a newer ticket or revocation wins the final generation lock", async () => {
    const claim = await claimDiscovery(state, browser, "user-a"); mocks.flowUpdate.mockResolvedValue({ count: 0 });
    await expect(finishDiscovery(claim, "code", new AbortController().signal)).rejects.toThrow(); expect(mocks.grantUpsert).not.toHaveBeenCalled();
  });
  it("encrypts only the independent Facebook credential with its scope binding", async () => {
    const claim = await claimDiscovery(state, browser, "user-a"); await finishDiscovery(claim, "code", new AbortController().signal);
    const saved = mocks.grantUpsert.mock.calls[0][0].create;
    expect(saved.encryptedToken).not.toContain("private-facebook-token");
    expect(JSON.parse(decryptToken(saved.encryptedToken))).toEqual({ version: 1, connectionId: grant.id, accountId: account.id,
      accountTokenHash: hashMusaCredential(account.accessToken), token: "private-facebook-token" });
    expect(account.accessToken).toBe("original-ciphertext");
  });
  it("cancels the flow and clears the credential together on local disconnect", async () => {
    await revokeDiscovery(ticket, "user-a");
    expect(mocks.flowUpdate.mock.calls[0][0].data).toMatchObject({ stateHash: null, browserHash: null, consumedAt: expect.any(Date) });
    expect(mocks.grantUpdate.mock.calls[0][0]).toMatchObject({ where: { connectionId: grant.id, accountId: account.id }, data: { encryptedToken: null, revokedAt: expect.any(Date) } });
  });
});

describe("browser consent boundaries", () => {
  it("allows only the fixed Facebook origin for the form redirect and escapes rendered identities", async () => {
    const response = discoveryPage({ title: "Connect", message: "Review", business: '<script>alert(1)</script>', account: '<img src=x>', ticket });
    expect(response.headers.get("content-security-policy")).toContain("form-action 'self' https://www.facebook.com;");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin");
    expect(discoveryPage({ title: "Error", message: "Retry" }).headers.get("referrer-policy")).toBe("no-referrer");
    const html = await response.text(); expect(html).not.toContain('<script>'); expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;'); expect(html).toContain('action="/integrations/musa/discovery"');
  });
  it.each(["https://other.example", "null", undefined])("refuses an invalid Origin before touching a flow: %s", async origin => {
    const response = await startRoute(new Request("https://openreply.example/integrations/musa/discovery", { method: "POST", headers: origin ? { origin } : {}, body: `ticket=${ticket}&intent=connect` }));
    expect(response.status).toBe(400); expect(mocks.flowFind).not.toHaveBeenCalled();
  });
  it("starts an authorized same-origin POST with a bound cookie and fixed Facebook scope", async () => {
    const response = await startRoute(new Request("https://openreply.example/integrations/musa/discovery", {
      method: "POST", headers: { origin: "https://openreply.example" }, body: `ticket=${ticket}&intent=connect`,
    }));
    expect(response.status).toBe(303);
    const destination = new URL(response.headers.get("location")!);
    expect(destination.origin).toBe("https://www.facebook.com");
    expect(destination.searchParams.get("redirect_uri")).toBe("https://openreply.example/api/integrations/musa/discovery/callback");
    expect(destination.searchParams.get("scope")).toBe(DISCOVERY_SCOPES.join(","));
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const cookie = response.headers.get("set-cookie")!;
    for (const flag of ["HttpOnly", "Secure", "SameSite=lax", "Path=/api/integrations/musa/discovery/callback"]) expect(cookie).toContain(flag);
    expect(mocks.flowUpdate).toHaveBeenCalledOnce();
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
  it("does not exchange a code without its browser cookie", async () => {
    const response = await callback(new NextRequest(`https://openreply.example/api/integrations/musa/discovery/callback?state=${state}&code=test`));
    expect(response.status).toBe(400); expect(mocks.exchange).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain(`${DISCOVERY_COOKIE}=`);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("consumes denied consent and does not call the provider", async () => {
    const request = new NextRequest(`https://openreply.example/api/integrations/musa/discovery/callback?state=${state}&error=access_denied`, { headers: { cookie: `${DISCOVERY_COOKIE}=${browser}` } });
    expect((await callback(request)).status).toBe(400); expect(mocks.flowUpdate).toHaveBeenCalledOnce(); expect(mocks.exchange).not.toHaveBeenCalled();
  });
});
