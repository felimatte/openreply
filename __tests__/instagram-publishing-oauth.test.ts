import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  context: vi.fn(), auth: vi.fn(), membership: vi.fn(), account: vi.fn(),
  existing: vi.fn(), update: vi.fn(), create: vi.fn(), event: vi.fn(),
  connectAllowed: vi.fn(), exchange: vi.fn(), longToken: vi.fn(), userInfo: vi.fn(), subscribe: vi.fn(),
}));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: mocks.context,
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
}));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db/client", () => ({ prisma: {
  workspaceMember: { findFirst: mocks.membership },
  instagramAccount: { findFirst: mocks.account, findUnique: mocks.existing, updateMany: mocks.update, create: mocks.create },
  operationalEvent: { create: mocks.event },
} }));
vi.mock("@/lib/instagram-accounts", () => ({ canConnectInstagramAccount: mocks.connectAllowed }));
vi.mock("@/lib/meta/client", () => ({
  getLongLivedToken: mocks.longToken, getUserInfo: mocks.userInfo, subscribeInstagramAccountToWebhooks: mocks.subscribe,
}));
vi.mock("@/lib/meta/oauth", async (original) => ({
  ...await original<typeof import("@/lib/meta/oauth")>(), exchangeCodeForToken: mocks.exchange,
}));

import { GET as connect } from "@/app/api/instagram/connect/route";
import { GET as callback } from "@/app/api/instagram/callback/route";
import { createOAuthState, verifyOAuthState } from "@/lib/meta/oauth";

const origin = "https://openreply.example";
const publishingQuery = "?workspaceId=workspace-a&accountId=account-a&purpose=publish";
function callbackRequest(publishing = true) {
  const state = createOAuthState("workspace-a", publishing ? { purpose: "publish", accountId: "account-a" } : undefined);
  return new NextRequest(`${origin}/api/instagram/callback?code=test-code&state=${encodeURIComponent(state)}`);
}
function destination(response: Response) { return new URL(response.headers.get("location")!); }

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXTAUTH_URL", origin);
  vi.stubEnv("NEXTAUTH_SECRET", "test-secret-with-enough-length");
  vi.stubEnv("INSTAGRAM_APP_ID", "test-app");
  vi.stubEnv("INSTAGRAM_APP_SECRET", "test-secret");
  vi.stubEnv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
  mocks.context.mockResolvedValue({ workspaceId: "workspace-a", userId: "user-a", role: "ADMIN" });
  mocks.auth.mockResolvedValue({ user: { id: "user-a" } });
  mocks.membership.mockResolvedValue({ role: "ADMIN" });
  mocks.account.mockResolvedValue({ id: "account-a", instagramId: "ig-a" });
  mocks.existing.mockResolvedValue({ id: "account-a" });
  mocks.update.mockResolvedValue({ count: 1 });
  mocks.connectAllowed.mockResolvedValue({ allowed: true });
  mocks.exchange.mockResolvedValue({ accessToken: "short-token" });
  mocks.longToken.mockResolvedValue({ accessToken: "long-token", expiresIn: 3600 });
  mocks.userInfo.mockResolvedValue({ id: "app-scoped-a", user_id: "ig-a", username: "account-a", name: "Account A" });
  mocks.subscribe.mockResolvedValue({ success: true });
  mocks.event.mockResolvedValue({});
});

describe("opt-in publishing consent", () => {
  it("preserves standard connect and reconnection scopes without looking up a publication account", async () => {
    const url = destination(await connect(new Request(`${origin}/api/instagram/connect?workspaceId=workspace-a`)));
    expect(url.origin).toBe("https://www.instagram.com");
    expect(url.searchParams.get("scope")).not.toContain("instagram_business_content_publish");
    expect(verifyOAuthState(url.searchParams.get("state"))).toMatchObject({ workspaceId: "workspace-a" });
    expect(verifyOAuthState(url.searchParams.get("state"))?.publication).toBeUndefined();
    expect(mocks.account).not.toHaveBeenCalled();
  });

  it("adds publishing only for a live admin and the exact Meta account in the requested workspace", async () => {
    const url = destination(await connect(new Request(`${origin}/api/instagram/connect${publishingQuery}`)));
    expect(mocks.context).toHaveBeenCalledWith("workspace-a");
    expect(mocks.account).toHaveBeenCalledWith({ where: { id: "account-a", workspaceId: "workspace-a", provider: "META" }, select: { id: true } });
    expect(url.searchParams.get("scope")?.split(",")).toContain("instagram_business_content_publish");
    expect(verifyOAuthState(url.searchParams.get("state"))?.publication).toEqual({ purpose: "publish", accountId: "account-a" });
  });

  it.each([
    "?purpose=publish&accountId=account-a",
    "?purpose=publish&workspaceId=workspace-a",
    "?purpose=unknown&workspaceId=workspace-a&accountId=account-a",
  ])("rejects incomplete or unsupported publication context: %s", async (query) => {
    expect(destination(await connect(new Request(`${origin}/api/instagram/connect${query}`))).searchParams.get("instagram")).toBe("invalid");
    expect(mocks.account).not.toHaveBeenCalled();
  });

  it.each(["MEMBER", "account"])("rejects publication consent outside the permitted %s scope", async (scope) => {
    if (scope === "MEMBER") mocks.context.mockResolvedValue({ workspaceId: "workspace-a", role: "MEMBER" });
    else mocks.account.mockResolvedValue(null);
    expect(destination(await connect(new Request(`${origin}/api/instagram/connect${publishingQuery}`))).searchParams.get("instagram")).toBe("forbidden");
  });
});

describe("publishing OAuth callback", () => {
  it("rechecks membership and account access before exchanging the code", async () => {
    mocks.membership.mockResolvedValue({ role: "MEMBER" });
    expect(destination(await callback(callbackRequest())).searchParams.get("instagram")).toBe("forbidden");
    expect(mocks.exchange).not.toHaveBeenCalled();
    mocks.membership.mockResolvedValue({ role: "ADMIN" });
    mocks.account.mockResolvedValue(null);
    expect(destination(await callback(callbackRequest())).searchParams.get("instagram")).toBe("forbidden");
    expect(mocks.exchange).not.toHaveBeenCalled();
  });

  it("does not subscribe or save a different Instagram identity returned by consent", async () => {
    mocks.userInfo.mockResolvedValue({ id: "different-app-id", user_id: "ig-other", username: "other" });
    expect(destination(await callback(callbackRequest())).searchParams.get("instagram")).toBe("account_mismatch");
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("updates only the signed account after consent and leaves capability confirmation to permissions lookup", async () => {
    const response = await callback(callbackRequest());
    expect(destination(response).searchParams.get("instagram")).toBe("publishing_reconnected");
    expect(response.headers.get("set-cookie")).toContain("openreply-workspace=workspace-a");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.membership).toHaveBeenCalledWith({ where: { workspaceId: "workspace-a", userId: "user-a" } });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "account-a", instagramId: "ig-a", workspaceId: "workspace-a", provider: "META" },
      data: expect.objectContaining({ username: "account-a", webhookSubscribed: true }),
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does not recreate the selected account when it disappears during the remote consent", async () => {
    mocks.update.mockResolvedValue({ count: 0 });
    expect(destination(await callback(callbackRequest())).searchParams.get("instagram")).toBe("forbidden");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("preserves the ordinary reconnect flow for states issued without a publishing target", async () => {
    const url = destination(await callback(callbackRequest(false)));
    expect(url.pathname).toBe("/dashboard");
    expect(url.searchParams.get("connected")).toBe("true");
    expect(mocks.account).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "account-a", workspaceId: "workspace-a", provider: "META" }, data: expect.objectContaining({ username: "account-a" }) });
  });

  it("preserves ordinary first-time connection creation", async () => {
    mocks.existing.mockResolvedValue(null);
    expect(destination(await callback(callbackRequest(false))).searchParams.get("connected")).toBe("true");
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ workspaceId: "workspace-a", instagramId: "ig-a", provider: "META" }) });
  });
});
