import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { expectedFlowChunkBytes, flowAssetFailure, FlowAssetError, FLOW_ASSET_UPLOAD_LIFETIME_MS, readFlowAssetBody } from "../../../_shared";

export const runtime = "nodejs";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string; index: string }> }) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return Response.json({ error: "Iniciá sesión para subir un archivo." }, { status: 401 });
  if (!canManageWorkspace(context.role)) return Response.json({ error: "Se necesita permiso de administrador para subir archivos." }, { status: 403 });
  const { id, index: rawIndex } = await params;
  if (!/^\d{1,2}$/.test(rawIndex)) return Response.json({ error: "La parte del archivo no es válida." }, { status: 400 });
  const index = Number(rawIndex);
  try {
    const asset = await prisma.flowAsset.findFirst({ where: { id, workspaceId: context.workspaceId } });
    if (!asset) throw new FlowAssetError("Archivo no encontrado.", 404);
    if (asset.status !== "UPLOADING") throw new FlowAssetError("El archivo ya está cerrado.", 409);
    if (Date.now() - asset.createdAt.getTime() > FLOW_ASSET_UPLOAD_LIFETIME_MS) throw new FlowAssetError("La carga venció. Volvé a elegir el archivo.", 410);
    const expected = expectedFlowChunkBytes(asset.byteSize, index);
    const bytes = await readFlowAssetBody(request, expected);
    if (bytes.length !== expected) throw new FlowAssetError("La parte del archivo está incompleta.");
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "FlowAsset" WHERE "id" = ${id} AND "workspaceId" = ${context.workspaceId} FOR UPDATE`;
      const current = await tx.flowAsset.findFirst({ where: { id, workspaceId: context.workspaceId } });
      if (!current) throw new FlowAssetError("Archivo no encontrado.", 404);
      if (current.status !== "UPLOADING") throw new FlowAssetError("El archivo ya está cerrado.", 409);
      const data = new Uint8Array(bytes);
      await tx.flowAssetChunk.upsert({ where: { assetId_index: { assetId: id, index } }, create: { assetId: id, index, data }, update: { data } });
    });
    return Response.json({ success: true, index });
  } catch (error) { return flowAssetFailure(error); }
}
