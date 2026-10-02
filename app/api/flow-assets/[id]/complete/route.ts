import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { expectedFlowChunkBytes, flowAssetFailure, flowAssetResponse, FlowAssetError, FLOW_ASSET_UPLOAD_LIFETIME_MS, validateFlowAssetContent } from "../../_shared";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return Response.json({ error: "Iniciá sesión para completar el archivo." }, { status: 401 });
  if (!canManageWorkspace(context.role)) return Response.json({ error: "Se necesita permiso de administrador para subir archivos." }, { status: 403 });
  const { id } = await params;
  try {
    const asset = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "FlowAsset" WHERE "id" = ${id} AND "workspaceId" = ${context.workspaceId} FOR UPDATE`;
      const current = await tx.flowAsset.findFirst({ where: { id, workspaceId: context.workspaceId } });
      if (!current) throw new FlowAssetError("Archivo no encontrado.", 404);
      if (current.status === "READY") return current;
      if (current.status !== "UPLOADING") throw new FlowAssetError("El archivo ya está cerrado.", 409);
      if (Date.now() - current.createdAt.getTime() > FLOW_ASSET_UPLOAD_LIFETIME_MS) throw new FlowAssetError("La carga venció. Volvé a elegir el archivo.", 410);
      const chunks = await tx.flowAssetChunk.findMany({ where: { assetId: id }, orderBy: { index: "asc" } });
      if (chunks.length !== current.chunkCount || chunks.some((chunk, index) => chunk.index !== index || chunk.data.length !== expectedFlowChunkBytes(current.byteSize, index))) throw new FlowAssetError("Faltan partes del archivo. Completá la carga antes de continuar.");
      const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.data)), current.byteSize);
      validateFlowAssetContent(bytes, current.mimeType);
      return tx.flowAsset.update({ where: { id }, data: { status: "READY" } });
    }, { timeout: 15_000 });
    return Response.json({ success: true, data: flowAssetResponse(asset) });
  } catch (error) { return flowAssetFailure(error); }
}
