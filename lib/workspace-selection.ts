import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db/client";
import { ensureWorkspaceForUser, WorkspaceAccessRequiredError } from "@/lib/workspace";

export const SELECTED_WORKSPACE_COOKIE = "openreply-workspace";

/** A selection is only a preference; the current user's live membership is authority. */
export async function resolveUserWorkspace(userId: string, requestedWorkspaceId?: string | null) {
  const explicitId = requestedWorkspaceId ?? (await headers()).get("x-openreply-workspace-id");
  if (explicitId !== null && !explicitId.trim()) return null;
  const selectedId = explicitId ?? (await cookies()).get(SELECTED_WORKSPACE_COOKIE)?.value;
  if (selectedId) {
    if (selectedId.length > 120) return null;
    // Do not silently fall back to a different customer's workspace when access is lost.
    return prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: selectedId, userId } },
      include: { workspace: true },
    });
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  let workspace;
  try {
    workspace = await ensureWorkspaceForUser(userId, user?.email);
  } catch (error) {
    if (error instanceof WorkspaceAccessRequiredError) return null;
    throw error;
  }
  return prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId } },
    include: { workspace: true },
  });
}
