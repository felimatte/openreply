import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cookie: undefined as string | undefined, header: null as string | null,
  member: vi.fn(), user: vi.fn(), ensureWorkspace: vi.fn(), currentUser: vi.fn(), account: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => state.cookie ? { value: state.cookie } : undefined }), headers: async () => ({ get: () => state.header }) }));
vi.mock("@/lib/db/client", () => ({ prisma: { workspaceMember: { findUnique: state.member }, user: { findUnique: state.user }, instagramAccount: { findFirst: state.account } } }));
vi.mock("@/lib/workspace", () => ({ ensureWorkspaceForUser: state.ensureWorkspace, WorkspaceAccessRequiredError: class WorkspaceAccessRequiredError extends Error {} }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: state.currentUser }));

import { resolveUserWorkspace } from "@/lib/workspace-selection";
import { createWorkspaceFetch } from "@/lib/workspace-request";
import { GET as openMusa } from "@/app/integrations/musa/open/route";
import { getWorkspaceStorageKey, setClientWorkspaceScope } from "@/lib/client-cache";
import { WorkspaceAccessRequiredError } from "@/lib/workspace";

beforeEach(() => {
  vi.resetAllMocks(); state.cookie = undefined; state.header = null;
  state.currentUser.mockResolvedValue("user-a");
  state.member.mockResolvedValue({ id: "member-a", workspaceId: "workspace-a", workspace: { id: "workspace-a" } });
  state.account.mockResolvedValue({ id: "account-a" });
});

describe("own-user MUSA launch", () => {
  const url = "https://openreply.example/integrations/musa/open?workspaceId=workspace-a&accountId=account-a";
  it("asks unauthenticated visitors to log in themselves and preserves exact context", async () => {
    state.currentUser.mockResolvedValue(null);
    const response = await openMusa(new Request(url));
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("callbackUrl")).toBe("/integrations/musa/open?workspaceId=workspace-a&accountId=account-a");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(state.member).not.toHaveBeenCalled();
  });
  it("sets only a validated workspace preference, without issuing an auth session", async () => {
    const response = await openMusa(new Request(url));
    expect(response.headers.get("location")).toBe("https://openreply.example/dashboard?instagramAccountId=account-a");
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("openreply-workspace=workspace-a");
    expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("Secure");
    expect(cookie).not.toContain("session");
    expect(state.member).toHaveBeenCalledWith({ where: { workspaceId_userId: { workspaceId: "workspace-a", userId: "user-a" } }, select: { id: true } });
    expect(state.account).toHaveBeenCalledWith({ where: { id: "account-a", workspaceId: "workspace-a" }, select: { id: true } });
  });
  it.each(["membership", "account"])("keeps the login screen when the own user lacks %s access", async (kind) => {
    if (kind === "membership") state.member.mockResolvedValue(null);
    else state.account.mockResolvedValue(null);
    const response = await openMusa(new Request(url));
    expect(new URL(response.headers.get("location")!).searchParams.get("musa")).toBe("access_required");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("workspace selection and cross-tab isolation", () => {
  it("returns no workspace when an invitation-only user has lost their last membership", async () => {
    state.user.mockResolvedValue({ email: "client@example.com" });
    state.ensureWorkspace.mockRejectedValue(new WorkspaceAccessRequiredError());
    expect(await resolveUserWorkspace("client")).toBeNull();
    expect(state.member).not.toHaveBeenCalled();
  });
  it("separates cached messages, selected accounts and queued imports by user and workspace", () => {
    const restoreA = setClientWorkspaceScope("user-a", "workspace-a");
    const keysA = ["inbox:msgs:thread-1", "inbox:selectedAccount", "openreply-import-queue"].map(getWorkspaceStorageKey);
    const restoreB = setClientWorkspaceScope("user-a", "workspace-b");
    const keysB = ["inbox:msgs:thread-1", "inbox:selectedAccount", "openreply-import-queue"].map(getWorkspaceStorageKey);
    expect(keysA.every((key, index) => key !== keysB[index])).toBe(true);
    restoreB();
    expect(getWorkspaceStorageKey("inbox:selectedAccount")).toBe(keysA[1]);
    const restoreOtherUser = setClientWorkspaceScope("user-b", "workspace-a");
    expect(getWorkspaceStorageKey("inbox:selectedAccount")).not.toBe(keysA[1]);
    restoreOtherUser(); restoreA();
  });
  it("revalidates the selected workspace and never falls back after access was lost", async () => {
    state.cookie = "workspace-b"; state.member.mockResolvedValue(null);
    expect(await resolveUserWorkspace("user-a")).toBeNull();
    expect(state.ensureWorkspace).not.toHaveBeenCalled();
    expect(state.member.mock.calls[0][0].where).toEqual({ workspaceId_userId: { workspaceId: "workspace-b", userId: "user-a" } });
  });
  it("keeps a rendered tab A bound to A after another tab changes the browser cookie to B", async () => {
    state.cookie = "workspace-b";
    const outgoing = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      state.header = new Headers(init?.headers).get("X-OpenReply-Workspace-Id");
      await resolveUserWorkspace("user-a");
      return new Response("{}");
    });
    const tabA = createWorkspaceFetch(outgoing, "workspace-a", "https://openreply.example");
    const tabB = createWorkspaceFetch(outgoing, "workspace-b", "https://openreply.example");
    await tabA("/api/automations", { method: "POST", body: "{}" });
    expect(state.member.mock.calls.at(-1)?.[0].where).toEqual({ workspaceId_userId: { workspaceId: "workspace-a", userId: "user-a" } });
    await tabB("/api/automations", { method: "POST", body: "{}" });
    expect(state.member.mock.calls.at(-1)?.[0].where).toEqual({ workspaceId_userId: { workspaceId: "workspace-b", userId: "user-a" } });
  });
  it("does not send workspace headers to another origin and preserves request options", async () => {
    const outgoing = vi.fn(async () => new Response("{}"));
    const scoped = createWorkspaceFetch(outgoing, "workspace-a", "https://openreply.example");
    const options = { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } };
    await scoped("https://provider.example/upload", options);
    expect(outgoing).toHaveBeenCalledWith("https://provider.example/upload", options);
    await scoped(new Request("https://openreply.example/api/automations", options));
    const sent = outgoing.mock.calls.at(-1) as unknown as [Request, RequestInit];
    expect(new Headers(sent[1].headers).get("Content-Type")).toBe("application/json");
    expect(new Headers(sent[1].headers).get("X-OpenReply-Workspace-Id")).toBe("workspace-a");
  });
});
