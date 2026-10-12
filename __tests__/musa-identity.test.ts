import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  musaConnection: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  musaPairingCode: { updateMany: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn() },
  workspaceMember: { findUnique: vi.fn() }, instagramAccount: { findMany: vi.fn() },
  workspace: { findUnique: vi.fn(), updateMany: vi.fn() }, dmLog: { groupBy: vi.fn() }, linkClick: { count: vi.fn() }, flowLinkClick: { count: vi.fn() },
  $queryRaw: vi.fn(), $transaction: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ prisma: db }));

import { hashMusaCredential, requireMusaConnection, requireMusaAccount, publicMusaAccount } from "@/lib/integrations/musa/auth";
import { createMusaPairingCode, exchangeMusaPairingCode } from "@/lib/integrations/musa/pairing";
import { getMusaSummary, musaSummaryPeriod } from "@/lib/integrations/musa/summary";
import { musaErrorResponse } from "@/lib/integrations/musa/errors";
import { POST as pairRoute } from "@/app/api/integrations/musa/v1/pair/route";
import { DELETE as revokeRoute } from "@/app/api/integrations/musa/v1/connection/route";

const businessId = "11111111-1111-4111-8111-111111111111";
const token = `musa_${"a".repeat(43)}`;
const account = { id: "account-a", instagramId: "ig-a", username: "client_a", provider: "META", workspaceId: "workspace-a", accessToken: "encrypted-provider-token" };
const grant = { id: "grant-a", workspaceId: "workspace-a", businessId, businessName: "Client A", grantedByUserId: "admin-a", allowedAccountIds: ["account-a"], tokenHash: hashMusaCredential(token), revokedAt: null };
function request(overrides: Record<string, string> = {}, method = "GET") {
  return new Request("https://openreply.example/api/integrations/musa/v1/accounts", { method, headers: { authorization: `Bearer ${token}`, "X-Musa-Business-Id": businessId, ...overrides } });
}

beforeEach(() => {
  vi.resetAllMocks();
  db.musaConnection.findUnique.mockResolvedValue(grant);
  db.workspaceMember.findUnique.mockResolvedValue({ role: "ADMIN" });
  db.instagramAccount.findMany.mockResolvedValue([account]);
  db.workspace.findUnique.mockResolvedValue({ id: "workspace-a", name: "Workspace A" });
  db.workspace.updateMany.mockResolvedValue({ count: 1 });
  db.$transaction.mockImplementation((fn) => fn(db));
  db.flowLinkClick.count.mockResolvedValue(0);
});

describe("MUSA identity and account isolation", () => {
  it("authenticates only the saved business and returns sanitized account descriptors", async () => {
    const context = await requireMusaConnection(request());
    expect(context).toMatchObject({ connectionId: "grant-a", workspaceId: "workspace-a", allowedInstagramAccountIds: ["account-a"] });
    expect(db.musaConnection.findUnique).toHaveBeenCalledWith({ where: { tokenHash: hashMusaCredential(token) } });
    expect(db.workspaceMember.findUnique).toHaveBeenCalledWith({ where: { workspaceId_userId: { workspaceId: "workspace-a", userId: "admin-a" } }, select: { role: true } });
    expect(publicMusaAccount(context.accounts[0])).toEqual({ id: "account-a", instagramId: "ig-a", username: "client_a", provider: "META" });
  });
  it.each<Record<string, string>>([
    { authorization: "" },
    { "X-Musa-Business-Id": "" },
    { "X-Musa-Business-Id": "22222222-2222-4222-8222-222222222222" },
  ])("rejects missing credentials and a different business: %j", async (headers) => {
    await expect(requireMusaConnection(request(headers))).rejects.toMatchObject({ status: 401 });
    expect(db.instagramAccount.findMany).not.toHaveBeenCalled();
  });
  it("rejects revoked grants without touching accounts", async () => {
    db.musaConnection.findUnique.mockResolvedValue({ ...grant, revokedAt: new Date() });
    await expect(requireMusaConnection(request())).rejects.toMatchObject({ status: 401 });
    expect(db.instagramAccount.findMany).not.toHaveBeenCalled();
  });
  it.each([null, { role: "MEMBER" }])("rechecks the grant issuer on every call: %j", async (membership) => {
    await requireMusaConnection(request());
    db.workspaceMember.findUnique.mockResolvedValue(membership);
    await expect(requireMusaConnection(request())).rejects.toMatchObject({ code: "GRANT_REVOKED" });
  });
  it("rejects a grant when a selected account disappears from its workspace", async () => {
    db.instagramAccount.findMany.mockResolvedValue([]);
    await expect(requireMusaConnection(request())).rejects.toMatchObject({ code: "ACCOUNT_SCOPE_CHANGED" });
    expect(db.instagramAccount.findMany).toHaveBeenCalledWith({ where: { workspaceId: "workspace-a", id: { in: ["account-a"] } }, orderBy: { id: "asc" } });
  });
  it("does not allow reading another account or falling back to all accounts", async () => {
    const context = await requireMusaConnection(request());
    for (const id of [null, "all", "account-b"]) expect(() => requireMusaAccount(context, id)).toThrow();
  });
  it("revokes only the authenticated grant and returns the agreed JSON", async () => {
    db.musaConnection.updateMany.mockResolvedValue({ count: 1 });
    const response = await revokeRoute(request({}, "DELETE"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: 1, revoked: true });
    expect(db.musaConnection.updateMany.mock.calls[0][0].where).toEqual({ id: "grant-a", workspaceId: "workspace-a", revokedAt: null });
  });
});

describe("MUSA one-time pairing", () => {
  const code = `musa_pair_${"b".repeat(43)}`;
  const input = { code, businessId, businessName: "Client A" };
  beforeEach(() => {
    db.musaPairingCode.updateMany.mockResolvedValue({ count: 1 });
    db.musaPairingCode.findUniqueOrThrow.mockResolvedValue({ ...grant, workspace: { id: "workspace-a", name: "Workspace A" } });
    db.musaConnection.create.mockImplementation(async ({ data }) => ({ id: "new-grant", ...data }));
    db.musaPairingCode.create.mockResolvedValue({ id: "pairing-a" });
  });
  it("only stores hashes and limits generated codes to ten minutes", async () => {
    const before = Date.now();
    const issued = await createMusaPairingCode("workspace-a", "admin-a", ["account-a"]);
    expect(issued.code).toMatch(/^musa_pair_[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(issued.expiresAt) - before).toBeGreaterThanOrEqual(599_000);
    expect(Date.parse(issued.expiresAt) - before).toBeLessThanOrEqual(601_000);
    const persisted = db.musaPairingCode.create.mock.calls[0][0].data;
    expect(persisted.codeHash).toBe(hashMusaCredential(issued.code));
    expect(JSON.stringify(persisted)).not.toContain(issued.code);
  });
  it("atomically claims the code and returns a credential once", async () => {
    const paired = await exchangeMusaPairingCode(input);
    expect(paired.token).toMatch(/^musa_[A-Za-z0-9_-]{43}$/);
    expect(paired).toMatchObject({ version: 1, connectionId: "new-grant", workspace: { id: "workspace-a" }, accounts: [{ id: "account-a" }] });
    const stored = db.musaConnection.create.mock.calls[0][0].data;
    expect(stored.tokenHash).toBe(hashMusaCredential(paired.token));
    expect(JSON.stringify(stored)).not.toContain(paired.token);
    expect(db.musaConnection.updateMany).not.toHaveBeenCalled();
    expect(db.musaPairingCode.updateMany.mock.calls[0][0].where).toEqual({ codeHash: hashMusaCredential(code), consumedAt: null, expiresAt: { gt: expect.any(Date) } });
  });
  it("rejects an expired, consumed or unknown code without creating a grant", async () => {
    db.musaPairingCode.updateMany.mockResolvedValue({ count: 0 });
    await expect(exchangeMusaPairingCode(input)).rejects.toMatchObject({ code: "PAIRING_CODE_UNAVAILABLE" });
    expect(db.musaConnection.create).not.toHaveBeenCalled();
  });
  it("binds a workspace to one business even after its grants are revoked", async () => {
    db.workspace.updateMany.mockResolvedValue({ count: 0 });
    await expect(exchangeMusaPairingCode(input)).rejects.toMatchObject({ status: 409, code: "WORKSPACE_ALREADY_BOUND" });
    expect(db.workspace.updateMany).toHaveBeenCalledWith({
      where: { id: "workspace-a", OR: [{ musaBusinessId: null }, { musaBusinessId: businessId }] },
      data: { musaBusinessId: businessId },
    });
    expect(db.musaConnection.create).not.toHaveBeenCalled();
  });
  it("checks issuer role again during pairing", async () => {
    db.workspaceMember.findUnique.mockResolvedValue({ role: "MEMBER" });
    await expect(exchangeMusaPairingCode(input)).rejects.toMatchObject({ status: 403 });
    expect(db.musaConnection.create).not.toHaveBeenCalled();
  });
  it("requires the pairing business header to match the body", async () => {
    for (const header of [null, "22222222-2222-4222-8222-222222222222"]) {
      const response = await pairRoute(new Request("https://openreply.example/api/integrations/musa/v1/pair", { method: "POST", headers: { "Content-Type": "application/json", ...(header ? { "X-Musa-Business-Id": header } : {}) }, body: JSON.stringify(input) }));
      expect(response.status).toBe(400);
    }
    expect(db.musaPairingCode.updateMany).not.toHaveBeenCalled();
  });
});

describe("MUSA automation metrics", () => {
  it("scopes counts to workspace, account and half-open time interval; unknown delivery is separate", async () => {
    db.dmLog.groupBy.mockResolvedValue([
      { status: "SENT", dmDeliveryUnconfirmed: false, _count: { _all: 5 } },
      { status: "FAILED", dmDeliveryUnconfirmed: false, _count: { _all: 2 } },
      { status: "FAILED", dmDeliveryUnconfirmed: true, _count: { _all: 3 } },
      { status: "SKIPPED_DEDUP", dmDeliveryUnconfirmed: false, _count: { _all: 1 } },
      { status: "PENDING", dmDeliveryUnconfirmed: false, _count: { _all: 7 } },
    ]);
    db.linkClick.count.mockResolvedValue(2);
    db.$queryRaw.mockResolvedValue([{ count: BigInt(4) }]);
    const from = "2026-10-01T00:00:00.000Z", to = "2026-10-11T00:00:00.000Z";
    const result = await getMusaSummary(await requireMusaConnection(request()), new URLSearchParams({ accountId: "account-a", from, to }));
    expect(result.metrics).toEqual({ sent: 5, failed: 2, skipped: 1, unconfirmed: 3, clicks: 2, contacts: 4, ctr: 40 });
    expect(result).toMatchObject({ from, to, accountId: "account-a", availability: { automations: true } });
    expect(db.dmLog.groupBy.mock.calls[0][0].where).toEqual({ workspaceId: "workspace-a", instagramAccountId: "account-a", createdAt: { gte: new Date(from), lt: new Date(to) } });
    expect(db.$queryRaw.mock.calls[0].slice(1)).toEqual(["workspace-a", "account-a", new Date(from), new Date(to)]);
  });
  it("rejects invalid, backwards and unbounded periods", () => {
    const invalidPeriods: Array<Record<string, string>> = [{ from: "yesterday" }, { from: "2026-10-12T00:00:00Z", to: "2026-10-11T00:00:00Z" }, { from: "2020-01-01T00:00:00Z", to: "2026-01-01T00:00:00Z" }];
    for (const params of invalidPeriods) {
      expect(() => musaSummaryPeriod(new URLSearchParams(params))).toThrow();
    }
  });
  it("does not turn a metrics failure into zero activity or expose error internals", async () => {
    db.dmLog.groupBy.mockRejectedValue(new Error("database credentials must stay private"));
    db.linkClick.count.mockResolvedValue(0); db.$queryRaw.mockResolvedValue([]);
    const context = await requireMusaConnection(request());
    await expect(getMusaSummary(context, new URLSearchParams({ accountId: "account-a" }))).rejects.toThrow();
    const response = musaErrorResponse(new Error("database credentials must stay private"));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("credentials");
  });
});
