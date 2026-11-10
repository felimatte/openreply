import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { requireMusaAccount, validateMusaGrantScope, type MusaConnectionContext } from "./auth";
import { MusaIntegrationError } from "./errors";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const activationInput = z.object({
  version: z.literal(1), publicationId: z.uuid(), accountId: id, instagramId: id,
  automationId: id, flowVersionId: id, mediaId: id,
}).strict();

const conflict = () => new MusaIntegrationError(409, "RESERVATION_CONFLICT", "La reserva de MUSA no coincide con el Reel confirmado.");

export async function activateScheduledReel(context: MusaConnectionContext, reservationId: string, input: z.infer<typeof activationInput>) {
  const account = requireMusaAccount(context, input.accountId);
  if (account.instagramId !== input.instagramId)
    throw new MusaIntegrationError(403, "ACCOUNT_NOT_ALLOWED", "La cuenta de Instagram no coincide.");
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "MusaConnection" WHERE "id" = ${context.connectionId} FOR NO KEY UPDATE`;
    const connection = await tx.musaConnection.findFirst({ where: { id: context.connectionId, revokedAt: null } });
    const grant = await tx.musaSchedulerGrant.findUnique({ where: { connectionId_accountId: {
      connectionId: context.connectionId, accountId: account.id,
    } } });
    if (!connection || grant?.instagramId !== input.instagramId ||
      !(await validateMusaGrantScope(connection, tx)).some(item => item.id === account.id && item.instagramId === input.instagramId))
      throw new MusaIntegrationError(403, "GRANT_REVOKED", "La conexión de MUSA ya no está disponible.");

    await tx.$queryRaw`SELECT "id" FROM "Automation" WHERE "id" = ${input.automationId} FOR UPDATE`;
    const attempt = await tx.musaScheduledReel.findFirst({ where: {
      connectionId: context.connectionId, accountId: account.id, automationId: input.automationId,
      publicationId: input.publicationId, flowVersionId: input.flowVersionId,
      OR: [{ reservationId }, { reservationId: null, status: "reserving" }],
    } });
    if (!attempt) throw conflict();
    if (attempt.status === "active") {
      if (attempt.mediaId !== input.mediaId) throw conflict();
      return;
    }
    if (attempt.status !== "reserving" && attempt.status !== "waiting") throw conflict();
    const eligible = {
      id: { in: attempt.flowCampaignIds }, workspaceId: context.workspaceId, instagramAccountId: account.id,
      isActive: false, flowEnabled: false, postId: null, matchAnyPost: false, pendingNextReel: false, dmTriggerEnabled: false,
    };
    await tx.$queryRaw`SELECT "id" FROM "Automation" WHERE "id" = ANY(${attempt.flowCampaignIds}::text[]) ORDER BY "id" FOR UPDATE`;
    const root = await tx.automation.findFirst({ where: { ...eligible, id: attempt.rootCampaignId,
      flowPublishedVersionId: input.flowVersionId, musaScheduledPublicationId: input.publicationId } });
    if (!root) throw conflict();
    const now = new Date();
    const updated = await tx.musaScheduledReel.updateMany({ where: { requestId: attempt.requestId,
      status: { in: ["reserving", "waiting"] }, OR: [{ reservationId }, { reservationId: null }] },
      data: { reservationId, status: "active", mediaId: input.mediaId, activatedAt: now, replayDueAt: now, errorCode: null } });
    if (!updated.count) throw conflict();
    const subflowIds = attempt.flowCampaignIds.filter(id => id !== root.id);
    const bundle = await tx.automation.updateMany({ where: { ...eligible, id: { in: subflowIds },
      flowPublishedVersionId: { not: null } }, data: { isActive: true, flowEnabled: true } });
    if (bundle.count !== subflowIds.length) throw conflict();
    await tx.automation.update({ where: { id: root.id }, data: { postId: input.mediaId, isActive: true, flowEnabled: true } });
  });
}
