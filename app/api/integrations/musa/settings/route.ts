import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { createMusaPairingCode } from "@/lib/integrations/musa/pairing";
import { MusaIntegrationError, musaErrorResponse, musaJson } from "@/lib/integrations/musa/errors";
import { getMusaPublishingCapability } from "@/lib/integrations/musa/publications-capabilities";

export const runtime = "nodejs";

async function requireAdministrator(request: Request, mutation = false) {
  const context = await getCurrentWorkspaceContext();
  if (!context) throw new MusaIntegrationError(401, "UNAUTHORIZED", "Sign in to OpenReply first.");
  if (!canManageWorkspace(context.role)) throw new MusaIntegrationError(403, "ADMIN_REQUIRED", "Only workspace owners and administrators can manage MUSA connections.");
  if (mutation && request.headers.get("origin") !== new URL(request.url).origin) {
    throw new MusaIntegrationError(403, "INVALID_ORIGIN", "Manage MUSA connections from OpenReply Settings.");
  }
  return context;
}

export async function GET(request: Request) {
  try {
    const context = await requireAdministrator(request);
    const [connections, accounts] = await Promise.all([
      prisma.musaConnection.findMany({
        where: { workspaceId: context.workspaceId, revokedAt: null },
        select: { id: true, businessName: true, allowedAccountIds: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.instagramAccount.findMany({ where: { workspaceId: context.workspaceId } }),
    ]);
    const accountCapabilities = await Promise.all(accounts.map(async (account) => ({ id: account.id, ...await getMusaPublishingCapability(account) })));
    return musaJson({ version: 1, connections, accountCapabilities });
  } catch (error) { return musaErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const context = await requireAdministrator(request, true);
    const body = z.object({ accountIds: z.array(z.string().min(1).max(120)).min(1).max(100) }).strict().safeParse(await request.json().catch(() => null));
    if (!body.success) throw new MusaIntegrationError(400, "INVALID_ACCOUNTS", "Select at least one Instagram account.");
    return musaJson({ version: 1, ...await createMusaPairingCode(context.workspaceId, context.userId, body.data.accountIds) }, 201);
  } catch (error) { return musaErrorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const context = await requireAdministrator(request, true);
    const body = z.object({ connectionId: z.string().min(1).max(120) }).strict().safeParse(await request.json().catch(() => null));
    if (!body.success) throw new MusaIntegrationError(400, "INVALID_CONNECTION", "Choose a MUSA connection to revoke.");
    const result = await prisma.musaConnection.updateMany({ where: { id: body.data.connectionId, workspaceId: context.workspaceId }, data: { revokedAt: new Date() } });
    if (!result.count) throw new MusaIntegrationError(404, "CONNECTION_NOT_FOUND", "The MUSA connection was not found in this workspace.");
    return musaJson({ version: 1, revoked: true });
  } catch (error) { return musaErrorResponse(error); }
}
