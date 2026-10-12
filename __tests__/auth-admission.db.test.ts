/** Synthetic identity fixtures only; never sends email or creates login links. */
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";

const state = vi.hoisted(() => ({ db: undefined as unknown as import("@/app/generated/prisma/client").PrismaClient }));
vi.mock("@/lib/db/client", () => ({ get prisma() { return state.db; } }));
import { acceptWorkspaceInvitation, isEmailAdmittedToSignIn } from "@/lib/auth-admission";
import { acceptPendingInvitationsForUser, ensureWorkspaceForUser, WorkspaceAccessRequiredError } from "@/lib/workspace";

const databaseUrl = process.env.MUSA_TEST_DATABASE_URL;
const prefix = `qa-admission-${randomUUID()}`;
const id = (suffix: string) => `${prefix}-${suffix}`;
const email = (suffix: string) => `${id(suffix).toLowerCase()}@example.invalid`;

describe.skipIf(!databaseUrl)("invited login admission against PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== "57322" || url.pathname !== "/openreply_musa_qa") throw new Error("Admission tests require the disposable local QA database.");
    vi.stubEnv("ALLOWED_EMAILS", email("owner-a"));
    state.db = new PrismaClient({ adapter: new PrismaPg(databaseUrl!) });
    await state.db.user.createMany({ data: ["owner-a", "owner-b", "admin-a"].map((suffix) => ({ id: id(suffix), email: email(suffix) })) });
    await state.db.workspace.createMany({ data: [
      { id: id("a"), name: "Admission QA A", ownerId: id("owner-a") },
      { id: id("b"), name: "Admission QA B", ownerId: id("owner-b") },
    ] });
    await state.db.workspaceMember.createMany({ data: [
      { workspaceId: id("a"), userId: id("owner-a"), role: "OWNER" },
      { workspaceId: id("a"), userId: id("admin-a"), role: "ADMIN" },
      { workspaceId: id("b"), userId: id("owner-b"), role: "OWNER" },
    ] });
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (!state.db) return;
    await state.db.user.deleteMany({ where: { id: { startsWith: `${prefix}-` } } });
    await state.db.$disconnect();
  });

  const user = (suffix: string) => state.db.user.create({ data: { id: id(suffix), email: email(suffix) } });
  const invite = (suffix: string, overrides = {}) => state.db.workspaceInvitation.create({ data: {
    workspaceId: id("a"), email: email(suffix), role: "MEMBER", token: randomUUID(), invitedByUserId: id("admin-a"), expiresAt: new Date(Date.now() + 60_000), ...overrides,
  } });

  it("admits an own-email invitee and accepts the invitation into the existing workspace", async () => {
    const invitation = await invite("valid");
    expect(await isEmailAdmittedToSignIn(email("valid"))).toBe(true);
    const client = await user("valid");
    expect((await ensureWorkspaceForUser(client.id, client.email)).id).toBe(id("a"));
    expect((await state.db.workspaceInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).status).toBe("ACCEPTED");
    expect(await state.db.workspace.count({ where: { ownerId: client.id } })).toBe(0);
    expect(await isEmailAdmittedToSignIn(client.email)).toBe(true);
  });

  it("rejects expired, revoked and already accepted invitations without live membership", async () => {
    for (const [suffix, changes] of [
      ["expired", { expiresAt: new Date(Date.now() - 1000) }],
      ["revoked", { status: "REVOKED" }],
      ["accepted", { status: "ACCEPTED" }],
    ] as const) {
      const invitation = await invite(suffix, changes); const client = await user(suffix);
      expect(await isEmailAdmittedToSignIn(client.email)).toBe(false);
      expect(await acceptWorkspaceInvitation(invitation.id, client.id, client.email!)).toBe(false);
    }
  });

  it("revokes pending invitation authority when its administrator is demoted or removed", async () => {
    const invitation = await invite("issuer-lost"); const client = await user("issuer-lost");
    const key = { workspaceId_userId: { workspaceId: id("a"), userId: id("admin-a") } };
    await state.db.workspaceMember.update({ where: key, data: { role: "MEMBER" } });
    try {
      expect(await isEmailAdmittedToSignIn(client.email)).toBe(false);
      expect(await acceptWorkspaceInvitation(invitation.id, client.id, client.email!)).toBe(false);
      await state.db.workspaceMember.delete({ where: key });
      expect(await isEmailAdmittedToSignIn(client.email)).toBe(false);
    } finally {
      await state.db.workspaceMember.upsert({ where: key, create: { workspaceId: id("a"), userId: id("admin-a"), role: "ADMIN" }, update: { role: "ADMIN" } });
    }
  });

  it("does not borrow an administrator's authority from another workspace or accept its invitation", async () => {
    const client = await user("cross-workspace");
    await invite("cross-workspace", { workspaceId: id("b") }); // admin-a has no membership in B.
    expect(await isEmailAdmittedToSignIn(client.email)).toBe(false);
    await invite("cross-workspace");
    expect(await isEmailAdmittedToSignIn(client.email)).toBe(true);
    await acceptPendingInvitationsForUser(client.id, client.email);
    const memberships = await state.db.workspaceMember.findMany({ where: { userId: client.id } });
    expect(memberships.map((entry) => entry.workspaceId)).toEqual([id("a")]);
    expect((await state.db.workspaceInvitation.findUniqueOrThrow({ where: { workspaceId_email: { workspaceId: id("b"), email: client.email! } } })).status).toBe("PENDING");
  });

  it("supports direct ADMIN and MEMBER admission, and denies again after membership removal", async () => {
    for (const role of ["ADMIN", "MEMBER"] as const) {
      const client = await user(`direct-${role}`);
      const member = await state.db.workspaceMember.create({ data: { workspaceId: id("a"), userId: client.id, role } });
      expect(await state.db.workspaceInvitation.count({ where: { email: client.email! } })).toBe(0);
      expect(await isEmailAdmittedToSignIn(client.email)).toBe(true);
      await state.db.workspaceMember.delete({ where: { id: member.id } });
      expect(await isEmailAdmittedToSignIn(client.email)).toBe(false);
      await expect(ensureWorkspaceForUser(client.id, client.email)).rejects.toBeInstanceOf(WorkspaceAccessRequiredError);
      expect(await state.db.workspace.count({ where: { ownerId: client.id } })).toBe(0);
    }
  });

  it("cannot reuse an accepted invitation after removal or use a personal workspace as admission", async () => {
    const client = await user("personal");
    await state.db.workspace.create({ data: { id: id("personal"), name: "Old personal workspace", ownerId: client.id, members: { create: { userId: client.id, role: "OWNER" } } } });
    expect(await isEmailAdmittedToSignIn(client.email)).toBe(false);
    // Even a historical inconsistent ADMIN role on an owned workspace cannot bypass the restriction.
    await state.db.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: id("personal"), userId: client.id } }, data: { role: "ADMIN" } });
    expect(await isEmailAdmittedToSignIn(client.email)).toBe(false);
    await state.db.workspaceMember.create({ data: { workspaceId: id("personal"), userId: id("admin-a"), role: "ADMIN" } });
    await invite("personal", { workspaceId: id("personal") });
    expect(await isEmailAdmittedToSignIn(client.email)).toBe(false);
    const invitation = await invite("personal");
    expect(await acceptWorkspaceInvitation(invitation.id, client.id, client.email!)).toBe(true);
    expect(await isEmailAdmittedToSignIn(client.email)).toBe(true);
    await state.db.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId: id("a"), userId: client.id } } });
    expect(await isEmailAdmittedToSignIn(client.email)).toBe(false);
  });

  it("accepts a pending invitation exactly once and only for its email", async () => {
    const invitation = await invite("concurrent"); const client = await user("concurrent");
    expect(await acceptWorkspaceInvitation(invitation.id, client.id, email("someone-else"))).toBe(false);
    const accepted = await Promise.all([
      acceptWorkspaceInvitation(invitation.id, client.id, client.email!),
      acceptWorkspaceInvitation(invitation.id, client.id, client.email!),
    ]);
    expect(accepted.sort()).toEqual([false, true]);
  });
});
