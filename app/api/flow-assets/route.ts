import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { createFlowAssetToken, flowAssetFailure, flowAssetResponse, FlowAssetError, FLOW_ASSET_CHUNK_BYTES, FLOW_ASSET_WORKSPACE_MAX_BYTES, getFlowAssetUrl, parseFlowAssetMetadata, readFlowAssetBody } from "./_shared";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return Response.json({ error: "Iniciá sesión para subir un archivo." }, { status: 401 });
  if (!canManageWorkspace(context.role)) return Response.json({ error: "Se necesita permiso de administrador para subir archivos." }, { status: 403 });
  try {
    const raw = await readFlowAssetBody(request, 4096);
    let value: unknown;
    try { value = JSON.parse(raw.toString("utf8")); } catch { throw new FlowAssetError("No se pudo leer la información del archivo."); }
    const metadata = parseFlowAssetMetadata(value);
    const publicToken = createFlowAssetToken();
    getFlowAssetUrl(publicToken);
    const asset = await prisma.$transaction(async (tx) => {
      // Serialize quota reservations for this workspace, including concurrent uploads.
      await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${context.workspaceId} FOR UPDATE`;
      const total = await tx.flowAsset.aggregate({ where: { workspaceId: context.workspaceId }, _sum: { byteSize: true } });
      if ((total._sum.byteSize ?? 0) + metadata.byteSize > FLOW_ASSET_WORKSPACE_MAX_BYTES) throw new FlowAssetError("El espacio de archivos está lleno. Eliminá archivos que no uses.", 413);
      return tx.flowAsset.create({ data: { ...metadata, workspaceId: context.workspaceId, publicToken } });
    });
    return Response.json({ success: true, data: flowAssetResponse(asset), asset: { id: asset.id, url: null, uploadUrl: `/api/flow-assets/${asset.id}/chunks/{index}` }, chunkSize: FLOW_ASSET_CHUNK_BYTES }, { status: 201 });
  } catch (error) { return flowAssetFailure(error); }
}
