import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accept: vi.fn(), session: vi.fn(), invite: vi.fn(), expire: vi.fn(),
  membership: vi.fn(), cookie: vi.fn(), deleteCookie: vi.fn(), deleteSession: vi.fn(),
}));

vi.mock("next-auth", () => ({ default: () => ({ auth: mocks.session, handlers: {} }) }));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: () => ({ deleteSession: mocks.deleteSession }) }));
vi.mock("@/lib/db/client", () => ({ prisma: {
  workspaceInvitation: { findUnique: mocks.invite, updateMany: mocks.expire },
  workspaceMember: { findUnique: mocks.membership },
} }));
vi.mock("@/lib/auth-admission", () => ({ acceptWorkspaceInvitation: mocks.accept }));
vi.mock("@/lib/i18n/provider", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/i18n/server", () => ({ getI18n: async () => ({
  t: (key: string) => key, label: (key: string) => key,
}) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookie, delete: mocks.deleteCookie }),
  headers: async () => new Headers(),
}));

import { NextRequest } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { POST as acceptInvitation } from "@/app/api/workspace/invitations/accept/route";
import InvitePage from "@/app/invite/[token]/page";
import InvitationAcceptCard from "@/components/invitation-accept-card";
import { authConfig } from "@/lib/auth";
import { resolveUserWorkspace, SELECTED_WORKSPACE_COOKIE } from "@/lib/workspace-selection";

const user = { id: "client", email: "Client@example.test" };
const invitation = {
  id: "invitation-a",
  token: "invite-token",
  email: "client@example.test",
  status: "PENDING",
  expiresAt: new Date(Date.now() + 60_000),
  workspaceId: "workspace-invited",
  workspace: { name: "Client team" },
};

function invitationRequest(origin = "https://openreply.example") {
  return new NextRequest("https://openreply.example/api/workspace/invitations/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ token: invitation.token }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.invite.mockResolvedValue(invitation);
  mocks.session.mockResolvedValue({ user });
  mocks.accept.mockResolvedValue(true);
});

describe("workspace invitations", () => {
  it("rejects cross-origin requests to select an invited workspace", async () => {
    const response = await acceptInvitation(invitationRequest("https://elsewhere.example"));
    expect(response.status).toBe(403);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(mocks.invite).not.toHaveBeenCalled();
  });

  it("keeps the invitation as the return destination for sign-in", () => {
    const html = renderToStaticMarkup(createElement(InvitationAcceptCard, {
      token: invitation.token, matchingSession: false, accepted: false, invitedEmail: invitation.email,
    }));
    expect(html).toContain('href="/login?callbackUrl=%2Finvite%2Finvite-token"');
  });

  it("selects the invited workspace after accepting the pending invitation", async () => {
    const response = await acceptInvitation(invitationRequest());
    expect(response.status).toBe(200);
    expect(mocks.accept).toHaveBeenCalledWith(invitation.id, user.id, user.email);
    expect(response.headers.get("set-cookie")).toContain("openreply-workspace=workspace-invited");
  });

  it("opens an invitation already accepted during signup without creating another membership", async () => {
    mocks.invite.mockResolvedValue({ ...invitation, status: "ACCEPTED" });
    mocks.membership.mockResolvedValue({ role: "MEMBER" });
    const page = await InvitePage({ params: Promise.resolve({ token: invitation.token }) });
    expect(renderToStaticMarkup(page)).toContain(">Open</button>");
    const response = await acceptInvitation(invitationRequest());
    expect(response.status).toBe(200);
    expect(mocks.membership).toHaveBeenCalledWith({
      where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: user.id } },
      include: { workspace: true },
    });
    expect(response.headers.get("set-cookie")).toContain("openreply-workspace=workspace-invited");
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it.each([
    { status: "ACCEPTED", email: user.email, expiresAt: invitation.expiresAt, expected: 403 },
    { status: "PENDING", email: "different@example.test", expiresAt: invitation.expiresAt, expected: 403 },
    { status: "PENDING", email: user.email, expiresAt: new Date(0), expected: 410 },
    { status: "REVOKED", email: user.email, expiresAt: invitation.expiresAt, expected: 404 },
  ])("does not grant access for unavailable or mismatched invites (%#)", async ({ status, email, expiresAt, expected }) => {
    mocks.invite.mockResolvedValue({ ...invitation, status, expiresAt });
    mocks.session.mockResolvedValue({ user: { ...user, email } });
    mocks.membership.mockResolvedValue(null);
    const response = await acceptInvitation(invitationRequest());
    expect(response.status).toBe(expected);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(mocks.accept).not.toHaveBeenCalled();
  });
});

describe("session cleanup during email sign-in", () => {
  it("allows sign-in when the browser still has a session cookie already removed from the database", async () => {
    mocks.deleteSession.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Session missing", {
      code: "P2025", clientVersion: "test",
    }));
    await expect(authConfig.adapter.deleteSession("old-session")).resolves.toBeNull();
  });

  it("still reports unexpected errors while deleting a session", async () => {
    mocks.deleteSession.mockRejectedValue(new Error("Database unavailable"));
    await expect(authConfig.adapter.deleteSession("old-session")).rejects.toThrow("Database unavailable");
  });
});

describe("workspace selection at verified sign-in", () => {
  it("clears a workspace belonging to the browser's previous user", async () => {
    mocks.cookie.mockReturnValue({ value: "previous-workspace" });
    mocks.membership.mockResolvedValue(null);
    await authConfig.events.signIn({ user });
    expect(mocks.deleteCookie).toHaveBeenCalledWith(SELECTED_WORKSPACE_COOKIE);
  });

  it("preserves a selection backed by the signed-in user's live membership", async () => {
    mocks.cookie.mockReturnValue({ value: "owned-workspace" });
    mocks.membership.mockResolvedValue({ role: "OWNER" });
    await authConfig.events.signIn({ user });
    expect(mocks.deleteCookie).not.toHaveBeenCalled();
  });

  it("keeps an explicitly requested workspace closed when membership is absent", async () => {
    mocks.membership.mockResolvedValue(null);
    await expect(resolveUserWorkspace(user.id, "another-workspace")).resolves.toBeNull();
    expect(mocks.cookie).not.toHaveBeenCalled();
  });
});
