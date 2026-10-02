import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { flowAssetFailure } from "../_shared";

export const runtime = "nodejs";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return Response.json({ error: "Iniciá sesión para eliminar el archivo." }, { status: 401 });
  if (!canManageWorkspace(context.role)) return Response.json({ error: "Se necesita permiso de administrador." }, { status: 403 });
  const { id } = await params;
  try {
    const result = await prisma.flowAsset.deleteMany({ where: { id, workspaceId: context.workspaceId } });
    if (!result.count) return Response.json({ error: "Archivo no encontrado." }, { status: 404 });
    return Response.json({ success: true });
  } catch (error) { return flowAssetFailure(error); }
}
