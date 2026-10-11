import { prisma } from "@/lib/db/client";
import { readWorkspaceInput, requireWorkspaceOrigin, requireWorkspaceUser, selectWorkspaceInput, WorkspaceManagementError, workspaceManagementErrorResponse, workspaceSelectionResponse } from "@/lib/workspace-management";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireWorkspaceOrigin(request);
    const user = await requireWorkspaceUser();
    const parsed = selectWorkspaceInput.safeParse(await readWorkspaceInput(request));
    if (!parsed.success) throw new WorkspaceManagementError(400, "INVALID_REQUEST");
    const membership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: parsed.data.workspaceId, userId: user.id } },
      select: { workspace: { select: { id: true, name: true } } },
    });
    if (!membership) throw new WorkspaceManagementError(403, "WORKSPACE_ACCESS_REQUIRED");
    return workspaceSelectionResponse(request, membership.workspace);
  } catch (error) { return workspaceManagementErrorResponse(error); }
}
