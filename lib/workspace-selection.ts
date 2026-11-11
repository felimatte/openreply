import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db/client";
import { ensureWorkspaceForUser, WorkspaceAccessRequiredError } from "@/lib/workspace";

export const SELECTED_WORKSPACE_COOKIE = "openreply-workspace";

export function findWorkspaceMembership(userId: string, workspaceId: string) {
  return prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    include: { workspace: true },
  });
}

export async function clearStaleWorkspaceSelection(userId: string) {
  const cookieStore = await cookies();
  const selectedId = cookieStore.get(SELECTED_WORKSPACE_COOKIE)?.value;
  if (!selectedId) return;
  if (selectedId.length <= 120 && await findWorkspaceMembership(userId, selectedId)) return;
  cookieStore.delete(SELECTED_WORKSPACE_COOKIE);
}

/** A selection is only a preference; the current user's live membership is authority. */
export async function resolveUserWorkspace(userId: string, requestedWorkspaceId?: string | null) {
  const explicitId = requestedWorkspaceId ?? (await headers()).get("x-openreply-workspace-id");
  if (explicitId !== null && !explicitId.trim()) return null;
  const selectedId = explicitId ?? (await cookies()).get(SELECTED_WORKSPACE_COOKIE)?.value;
  if (selectedId) {
    if (selectedId.length > 120) return null;
    // Do not silently fall back to a different customer's workspace when access is lost.
    return findWorkspaceMembership(userId, selectedId);
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  let workspace;
  try {
    workspace = await ensureWorkspaceForUser(userId, user?.email);
  } catch (error) {
    if (error instanceof WorkspaceAccessRequiredError) return null;
    throw error;
  }
  return findWorkspaceMembership(userId, workspace.id);
}
