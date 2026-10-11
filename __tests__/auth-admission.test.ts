import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  workspaceMember: { findFirst: vi.fn(), findUnique: vi.fn() },
  workspaceInvitation: { findMany: vi.fn() },
}));
vi.mock("@/lib/db/client", () => ({ prisma: db }));
import { isEmailAdmittedToSignIn, isWorkspaceInvitationUsable } from "@/lib/auth-admission";

const invitation = () => ({ workspaceId: "workspace-a", invitedByUserId: "admin-a", status: "PENDING" as const, role: "MEMBER" as const, expiresAt: new Date(Date.now() + 60_000) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ALLOWED_EMAILS", "owner@example.com");
  db.user.findUnique.mockResolvedValue(null);
  db.workspaceMember.findFirst.mockResolvedValue(null);
  db.workspaceMember.findUnique.mockResolvedValue({ role: "ADMIN" });
  db.workspaceInvitation.findMany.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe("own-email login admission", () => {
  it("keeps allowlisted and unrestricted signup without depending on the database", async () => {
    expect(await isEmailAdmittedToSignIn(" Owner@Example.COM ")).toBe(true);
    vi.stubEnv("ALLOWED_EMAILS", "");
    expect(await isEmailAdmittedToSignIn("new@example.com")).toBe(true);
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("denies empty addresses and independent signup outside the allowlist", async () => {
    for (const email of [null, undefined, "", "  ", "stranger@example.com"]) {
      expect(await isEmailAdmittedToSignIn(email)).toBe(false);
    }
  });

  it("admits a normalized invited email only while the issuing workspace role remains valid", async () => {
    db.workspaceInvitation.findMany.mockResolvedValue([invitation()]);
    expect(await isEmailAdmittedToSignIn(" Client@Example.com ")).toBe(true);
    expect(db.workspaceInvitation.findMany.mock.calls[0][0].where.email).toBe("client@example.com");
    expect(db.workspaceMember.findUnique).toHaveBeenCalledWith({
      where: { workspaceId_userId: { workspaceId: "workspace-a", userId: "admin-a" } }, select: { role: true },
    });
    db.workspaceMember.findUnique.mockResolvedValue({ role: "MEMBER" });
    expect(await isEmailAdmittedToSignIn("client@example.com")).toBe(false);
  });

  it("requires a peer-workspace ADMIN or MEMBER membership and does not use an owned workspace", async () => {
    db.user.findUnique.mockResolvedValue({ id: "client" });
    db.workspaceMember.findFirst.mockResolvedValue({ id: "direct-member" });
    expect(await isEmailAdmittedToSignIn("client@example.com")).toBe(true);
    expect(db.workspaceMember.findFirst).toHaveBeenCalledWith({
      where: { userId: "client", role: { in: ["ADMIN", "MEMBER"] }, workspace: { ownerId: { not: "client" } } }, select: { id: true },
    });
  });

  it.each(["user", "membership", "invitation", "issuer"])("fails closed when the %s database read fails", async (stage) => {
    if (stage === "user") db.user.findUnique.mockRejectedValue(new Error("offline"));
    if (stage === "membership") {
      db.user.findUnique.mockResolvedValue({ id: "client" });
      db.workspaceMember.findFirst.mockRejectedValue(new Error("offline"));
    }
    if (stage === "invitation") db.workspaceInvitation.findMany.mockRejectedValue(new Error("offline"));
    if (stage === "issuer") {
      db.workspaceInvitation.findMany.mockResolvedValue([invitation()]);
      db.workspaceMember.findUnique.mockRejectedValue(new Error("offline"));
    }
    expect(await isEmailAdmittedToSignIn("client@example.com")).toBe(false);
  });

  it("rejects expired, revoked, consumed, owner-role and orphaned invitations", async () => {
    const now = new Date();
    const invalid = [
      { ...invitation(), expiresAt: now },
      { ...invitation(), status: "REVOKED" as const },
      { ...invitation(), status: "ACCEPTED" as const },
      { ...invitation(), role: "OWNER" as const },
      { ...invitation(), invitedByUserId: null },
    ];
    for (const value of invalid) expect(await isWorkspaceInvitationUsable(value, db as never, now)).toBe(false);
    expect(db.workspaceMember.findUnique).not.toHaveBeenCalled();
  });
});
