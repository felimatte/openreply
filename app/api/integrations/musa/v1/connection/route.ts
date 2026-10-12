import { prisma } from "@/lib/db/client";
import { requireMusaConnection } from "@/lib/integrations/musa/auth";
import { musaErrorResponse, musaJson } from "@/lib/integrations/musa/errors";

export const runtime = "nodejs";
export async function DELETE(request: Request) {
  try {
    const { connectionId, workspaceId } = await requireMusaConnection(request);
    await prisma.musaConnection.updateMany({ where: { id: connectionId, workspaceId, revokedAt: null }, data: { revokedAt: new Date() } });
    return musaJson({ version: 1, revoked: true });
  } catch (error) { return musaErrorResponse(error); }
}
