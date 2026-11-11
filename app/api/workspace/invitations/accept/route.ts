import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { normalizeInvitationEmail } from "@/lib/workspace-invitations";
import { acceptWorkspaceInvitation } from "@/lib/auth-admission";
import { workspaceSelectionResponse } from "@/lib/workspace-management";
import { findWorkspaceMembership } from "@/lib/workspace-selection";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json(
      { success: false, error: "Sign in with the invited email first" },
      { status: 401 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token : null;
  if (!token) {
    return NextResponse.json(
      { success: false, error: "Missing invitation token" },
      { status: 400 }
    );
  }

  const invitation = await prisma.workspaceInvitation.findUnique({
    where: { token },
    include: { workspace: { select: { name: true } } },
  });
  if (!invitation || (invitation.status !== "PENDING" && invitation.status !== "ACCEPTED")) {
    return NextResponse.json(
      { success: false, error: "Invitation is no longer available" },
      { status: 404 }
    );
  }

  if (invitation.status === "PENDING" && invitation.expiresAt <= new Date()) {
    await prisma.workspaceInvitation.updateMany({
      where: { id: invitation.id, token, status: "PENDING" },
      data: { status: "EXPIRED" },
    });
    return NextResponse.json(
      { success: false, error: "Invitation has expired" },
      { status: 410 }
    );
  }

  if (normalizeInvitationEmail(session.user.email) !== invitation.email) {
    return NextResponse.json(
      { success: false, error: "This invitation is for a different email" },
      { status: 403 }
    );
  }

  // The first verified sign-in can already have accepted this invitation.
  const membership = invitation.status === "ACCEPTED"
    ? await findWorkspaceMembership(session.user.id, invitation.workspaceId)
    : await acceptWorkspaceInvitation(invitation.id, session.user.id, session.user.email);
  if (!membership) return NextResponse.json({ success: false, error: "Invitation is no longer available" }, { status: 403 });

  return workspaceSelectionResponse(request, {
    id: invitation.workspaceId,
    name: invitation.workspace.name,
  });
}

