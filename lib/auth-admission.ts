import type { Prisma, WorkspaceInvitation } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { isEmailAllowedToSignIn } from "@/lib/env";
import { normalizeInvitationEmail } from "@/lib/workspace-invitations";

type InvitationDb = Pick<Prisma.TransactionClient, "workspaceMember">;

/** An invitation's authority belongs to its specific workspace, not another membership. */
export async function isWorkspaceInvitationUsable(
  invitation: Pick<WorkspaceInvitation, "workspaceId" | "invitedByUserId" | "status" | "expiresAt" | "role">,
  db: InvitationDb = prisma,
  now = new Date(),
): Promise<boolean> {
  if (invitation.status !== "PENDING" || invitation.expiresAt <= now || !invitation.invitedByUserId ||
      (invitation.role !== "ADMIN" && invitation.role !== "MEMBER")) return false;
  const issuer = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: invitation.invitedByUserId } },
    select: { role: true },
  });
  return issuer?.role === "OWNER" || issuer?.role === "ADMIN";
}

/** Admission is checked before sending a magic link and again when redeeming it. */
export async function isEmailAdmittedToSignIn(email: string | null | undefined): Promise<boolean> {
  if (!email?.trim()) return false;
  const normalized = normalizeInvitationEmail(email);
  if (isEmailAllowedToSignIn(normalized)) return true;
  try {
    const user = await prisma.user.findUnique({ where: { email: normalized }, select: { id: true } });
    if (user) {
      const membership = await prisma.workspaceMember.findFirst({
        where: {
          userId: user.id,
          role: { in: ["ADMIN", "MEMBER"] },
          // A personal workspace created by a previous unrestricted signup is
          // not an invitation and must not bypass a subsequently closed allowlist.
          workspace: { ownerId: { not: user.id } },
        },
        select: { id: true },
      });
      if (membership) return true;
    }
    const now = new Date();
    const invitations = await prisma.workspaceInvitation.findMany({
      where: {
        email: normalized, status: "PENDING", expiresAt: { gt: now }, role: { in: ["ADMIN", "MEMBER"] }, invitedByUserId: { not: null },
        ...(user ? { workspace: { ownerId: { not: user.id } } } : {}),
      },
      select: { workspaceId: true, invitedByUserId: true, status: true, expiresAt: true, role: true },
    });
    for (const invitation of invitations) {
      if (await isWorkspaceInvitationUsable(invitation, prisma, now)) return true;
    }
    return false;
  } catch {
    // Fail closed without exposing database errors or email addresses.
    return false;
  }
}

/** Claim and accept one still-valid invitation under the same transaction. */
export async function acceptWorkspaceInvitation(invitationId: string, userId: string, email: string): Promise<boolean> {
  const normalized = normalizeInvitationEmail(email);
  return prisma.$transaction(async (tx) => {
    const invitation = await tx.workspaceInvitation.findUnique({ where: { id: invitationId } });
    const now = new Date();
    if (!invitation || invitation.email !== normalized || !await isWorkspaceInvitationUsable(invitation, tx, now)) return false;
    const claimed = await tx.workspaceInvitation.updateMany({
      where: { id: invitation.id, status: "PENDING", expiresAt: { gt: now }, token: invitation.token, invitedByUserId: invitation.invitedByUserId },
      data: { status: "ACCEPTED", acceptedAt: now },
    });
    if (claimed.count !== 1) return false;
    const membershipKey = { workspaceId_userId: { workspaceId: invitation.workspaceId, userId } };
    const membership = await tx.workspaceMember.findUnique({ where: membershipKey, select: { role: true } });
    await tx.workspaceMember.upsert({
      where: membershipKey,
      create: { workspaceId: invitation.workspaceId, userId, role: invitation.role },
      update: membership?.role === "OWNER" ? {} : { role: invitation.role },
    });
    return true;
  });
}
