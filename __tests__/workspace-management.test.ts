import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sessionUser: vi.fn(), user: vi.fn(), memberships: vi.fn(), membership: vi.fn(),
  lock: vi.fn(), count: vi.fn(), create: vi.fn(), transaction: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: mocks.sessionUser }));
vi.mock("@/lib/workspace-selection", () => ({ SELECTED_WORKSPACE_COOKIE: "openreply-workspace" }));
vi.mock("@/lib/db/client", () => ({ prisma: {
  user: { findUnique: mocks.user }, workspaceMember: { findMany: mocks.memberships, findUnique: mocks.membership },
  $transaction: mocks.transaction,
} }));

import { GET as list, POST as create } from "@/app/api/workspaces/route";
import { POST as select } from "@/app/api/workspaces/select/route";
import { canCreateIndependentWorkspace, createIndependentWorkspace, WORKSPACE_CREATION_LIMIT } from "@/lib/workspace-management";

const origin = "https://openreply.example";
function request(body: unknown, options: { origin?: string | null; path?: string } = {}) {
  return new Request(`${origin}/api/workspaces${options.path ?? ""}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(options.origin !== null ? { Origin: options.origin ?? origin } : {}) },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ALLOWED_EMAILS", "agency@example.test");
  mocks.sessionUser.mockResolvedValue("agency-a");
  mocks.user.mockResolvedValue({ id: "agency-a", email: "Agency@Example.Test" });
  mocks.memberships.mockResolvedValue([{ role: "OWNER", workspace: { id: "workspace-a", name: "Client A" } }]);
  mocks.membership.mockResolvedValue({ workspace: { id: "workspace-b", name: "Client B" } });
  mocks.count.mockResolvedValue(0);
  mocks.create.mockResolvedValue({ id: "workspace-new", name: "Client C" });
  mocks.transaction.mockImplementation(async (fn) => fn({ $queryRaw: mocks.lock, user: { findUnique: mocks.user }, workspace: { count: mocks.count, create: mocks.create } }));
});

describe("independent workspace creation", () => {
  it("normalizes the allowlist check without treating invitation admission as ownership authority", () => {
    expect(canCreateIndependentWorkspace(" Agency@Example.Test ")).toBe(true);
    expect(canCreateIndependentWorkspace("client@example.test")).toBe(false);
    expect(canCreateIndependentWorkspace(null)).toBe(false);
    vi.stubEnv("ALLOWED_EMAILS", "");
    expect(canCreateIndependentWorkspace("selfhost@example.test")).toBe(true);
  });

  it("creates the workspace and OWNER membership together under the user's durable creation lock", async () => {
    const response = await create(request({ name: " Client C " }));
    expect(response.status).toBe(201);
    expect(mocks.lock).toHaveBeenCalled();
    expect(mocks.count).toHaveBeenCalledWith({ where: { ownerId: "agency-a", createdAt: { gt: expect.any(Date) } } });
    expect(mocks.create).toHaveBeenCalledWith({
      data: { name: "Client C", ownerId: "agency-a", members: { create: { userId: "agency-a", role: "OWNER" } } },
      select: { id: true, name: true },
    });
    expect(response.headers.get("set-cookie")).toContain("openreply-workspace=workspace-new");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.create.mock.invocationCallOrder[0]);
  });

  it("rejects invitation-only clients even if they own an older workspace", async () => {
    mocks.user.mockResolvedValue({ id: "client-a", email: "client@example.test" });
    const response = await create(request({ name: "Independent client workspace" }));
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("CREATION_NOT_ALLOWED");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it.each(["", " ", "A", "X".repeat(81), "Client\nB"])("rejects invalid workspace names", async (name) => {
    expect((await create(request({ name }))).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects payload fields that could move accounts or assign another owner", async () => {
    expect((await create(request({ name: "Client", ownerId: "other", accountId: "existing" }))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("blocks the eleventh creation in the rolling hour and returns a retry hint", async () => {
    mocks.count.mockResolvedValue(WORKSPACE_CREATION_LIMIT);
    const response = await create(request({ name: "Client C" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("3600");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rechecks creation authority inside the transaction", async () => {
    mocks.user.mockResolvedValueOnce({ id: "agency-a", email: "agency@example.test" }).mockResolvedValue({ email: "client@example.test" });
    expect((await create(request({ name: "Client C" }))).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does not expose an internal database failure", async () => {
    mocks.create.mockRejectedValue(new Error("secret database connection string"));
    await expect(createIndependentWorkspace("agency-a", { name: "Client C" })).rejects.toThrow();
    const response = await create(request({ name: "Client C" }));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret");
  });
});

describe("workspace selection authorization", () => {
  it("lists only the current user's memberships and no account credentials", async () => {
    const response = await list();
    expect(await response.json()).toEqual({ success: true, data: { workspaces: [{ id: "workspace-a", name: "Client A", role: "OWNER" }], canCreate: true } });
    expect(mocks.memberships).toHaveBeenCalledWith({ where: { userId: "agency-a" }, select: { role: true, workspace: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } });
  });

  it("lets invited clients choose only their actual memberships", async () => {
    mocks.user.mockResolvedValue({ id: "client-a", email: "client@example.test" });
    const response = await select(request({ workspaceId: "workspace-b" }, { path: "/select" }));
    expect(response.status).toBe(200);
    expect(mocks.membership).toHaveBeenCalledWith({ where: { workspaceId_userId: { workspaceId: "workspace-b", userId: "client-a" } }, select: { workspace: { select: { id: true, name: true } } } });
    expect(response.headers.get("set-cookie")).toContain("openreply-workspace=workspace-b");
    expect(mocks.create).not.toHaveBeenCalled();
    expect((await (await list()).json()).data.canCreate).toBe(false);
  });

  it("does not set a selection cookie when access was removed or belongs to another client", async () => {
    mocks.membership.mockResolvedValue(null);
    const response = await select(request({ workspaceId: "workspace-other" }));
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects unauthenticated listing and mutations", async () => {
    mocks.sessionUser.mockResolvedValue(null);
    expect((await list()).status).toBe(401);
    expect((await create(request({ name: "Client" }))).status).toBe(401);
    expect((await select(request({ workspaceId: "workspace-b" }))).status).toBe(401);
    expect(mocks.membership).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([null, "https://attacker.example"])("rejects missing or foreign mutation Origin %s", async (source) => {
    expect((await create(request({ name: "Client" }, { origin: source }))).status).toBe(403);
    expect((await select(request({ workspaceId: "workspace-b" }, { origin: source }))).status).toBe(403);
    expect(mocks.sessionUser).not.toHaveBeenCalled();
  });
});
