import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), pair: vi.fn(), list: vi.fn(), revoke: vi.fn(), accounts: vi.fn(), capability: vi.fn() }));
vi.mock("@/lib/workspace-access", () => ({ getCurrentWorkspaceContext: mocks.context, canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN" }));
vi.mock("@/lib/integrations/musa/pairing", () => ({ createMusaPairingCode: mocks.pair }));
vi.mock("@/lib/db/client", () => ({ prisma: { musaConnection: { findMany: mocks.list, updateMany: mocks.revoke }, instagramAccount: { findMany: mocks.accounts } } }));
vi.mock("@/lib/integrations/musa/publications-capabilities", () => ({ getMusaPublishingCapability: mocks.capability }));
import { GET, POST, DELETE } from "@/app/api/integrations/musa/settings/route";

function request(method: string, body?: unknown, origin: string | null = "https://openreply.example") {
  return new Request("https://openreply.example/api/integrations/musa/settings", {
    method, headers: { "Content-Type": "application/json", ...(origin ? { origin } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue({ userId: "admin-a", workspaceId: "workspace-a", role: "ADMIN" });
  mocks.list.mockResolvedValue([]); mocks.revoke.mockResolvedValue({ count: 1 });
  mocks.accounts.mockResolvedValue([]);
  mocks.pair.mockResolvedValue({ id: "pair-a", code: "one-time-secret", expiresAt: "2026-10-11T00:10:00Z" });
});

describe("MUSA administrator settings", () => {
  it.each([null, { userId: "member-a", workspaceId: "workspace-a", role: "MEMBER" }])("rejects missing administrator membership: %j", async (context) => {
    mocks.context.mockResolvedValue(context);
    const response = await POST(request("POST", { accountIds: ["account-a"] }));
    expect(response.status).toBe(context ? 403 : 401);
    expect(mocks.pair).not.toHaveBeenCalled();
  });
  it.each([null, "https://foreign.example"])("rejects cross-origin and originless browser mutations: %j", async (origin) => {
    expect((await POST(request("POST", { accountIds: ["account-a"] }, origin))).status).toBe(403);
    expect((await DELETE(request("DELETE", { connectionId: "grant-a" }, origin))).status).toBe(403);
    expect(mocks.pair).not.toHaveBeenCalled(); expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it("grants only selected accounts using the current administrator and workspace", async () => {
    const response = await POST(request("POST", { accountIds: ["account-a"] }));
    expect(response.status).toBe(201);
    expect(mocks.pair).toHaveBeenCalledWith("workspace-a", "admin-a", ["account-a"]);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("lists descriptors without ever selecting token hashes", async () => {
    await GET(request("GET"));
    expect(mocks.list).toHaveBeenCalledWith({ where: { workspaceId: "workspace-a", revokedAt: null }, select: { id: true, businessName: true, allowedAccountIds: true, createdAt: true }, orderBy: { createdAt: "desc" } });
  });
  it("cannot revoke a grant in another workspace", async () => {
    mocks.revoke.mockResolvedValue({ count: 0 });
    const response = await DELETE(request("DELETE", { connectionId: "grant-b" }));
    expect(response.status).toBe(404);
    expect(mocks.revoke.mock.calls[0][0].where).toEqual({ id: "grant-b", workspaceId: "workspace-a" });
  });
  it("reports publishing readiness without exposing provider credentials", async () => {
    mocks.accounts.mockResolvedValue([{ id: "account-a", accessToken: "private-encrypted-token" }]);
    mocks.capability.mockResolvedValue({ canPublish: false, publishUnavailableReason: "PUBLISH_PERMISSION_REQUIRED" });
    const response = await GET(request("GET"));
    expect(await response.json()).toEqual({ version: 1, connections: [], accountCapabilities: [{ id: "account-a", canPublish: false, publishUnavailableReason: "PUBLISH_PERMISSION_REQUIRED" }] });
  });
});
