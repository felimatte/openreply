import { z } from "zod";
import type { Automation } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { requireMusaAccount, validateMusaGrantScope, type MusaConnectionContext } from "./auth";
import { MusaIntegrationError } from "./errors";
import { getScheduledReel, requireScheduler } from "./scheduler";

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
  const target = {
    connectionId: context.connectionId, accountId: account.id, automationId: input.automationId,
    publicationId: input.publicationId, flowVersionId: input.flowVersionId,
    OR: [{ reservationId }, { reservationId: null, status: "reserving" }],
  };
  const previous = await prisma.musaScheduledReel.findFirst({ where: target });
  if (!previous) throw conflict();
  if (previous.status === "active") {
    if (previous.mediaId !== input.mediaId) throw conflict();
    return;
  }
  if (previous.status !== "reserving" && previous.status !== "waiting") throw conflict();
  const scheduler = await requireScheduler(context.workspaceId, account.id, context.connectionId);
  const remote = await getScheduledReel(scheduler, reservationId);
  if (remote.reservationId !== reservationId || remote.publicationId !== input.publicationId ||
    (remote.status !== "waiting" && remote.status !== "active")) throw conflict();

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
    const attempt = await tx.musaScheduledReel.findFirst({ where: target });
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


export async function setScheduledCampaignActive(campaign: Automation, isActive: boolean) {
  if (!campaign.postId || !campaign.musaScheduledPublicationId) throw conflict();
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Automation" WHERE "id" = ${campaign.id} FOR UPDATE`;
    const root = await tx.automation.findFirst({ where: { id: campaign.id, workspaceId: campaign.workspaceId,
      instagramAccountId: campaign.instagramAccountId, postId: campaign.postId,
      musaScheduledPublicationId: campaign.musaScheduledPublicationId } });
    const attempt = await tx.musaScheduledReel.findFirst({ where: { automationId: campaign.id,
      publicationId: campaign.musaScheduledPublicationId!, status: "active", mediaId: campaign.postId } });
    if (!root || !attempt) throw conflict();
    const bundle = await tx.automation.updateMany({ where: { id: { in: attempt.flowCampaignIds },
      workspaceId: campaign.workspaceId, instagramAccountId: campaign.instagramAccountId, flowEnabled: true },
      data: { isActive } });
    if (bundle.count !== attempt.flowCampaignIds.length) throw conflict();
    return tx.automation.findUniqueOrThrow({ where: { id: root.id } });
  });
}
