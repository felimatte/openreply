import { prisma } from "@/lib/db/client";
import { canCreateIndependentWorkspace, createIndependentWorkspace, readWorkspaceInput, requireWorkspaceOrigin, requireWorkspaceUser, workspaceJson, workspaceManagementErrorResponse, workspaceSelectionResponse } from "@/lib/workspace-management";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireWorkspaceUser();
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId: user.id },
      select: { role: true, workspace: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    return workspaceJson({ success: true, data: {
      workspaces: memberships.map(({ role, workspace }) => ({ ...workspace, role })),
      canCreate: canCreateIndependentWorkspace(user.email),
    } });
  } catch (error) { return workspaceManagementErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    requireWorkspaceOrigin(request);
    const user = await requireWorkspaceUser();
    const workspace = await createIndependentWorkspace(user.id, await readWorkspaceInput(request));
    return workspaceSelectionResponse(request, workspace, 201);
  } catch (error) { return workspaceManagementErrorResponse(error); }
}
