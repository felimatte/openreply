import { randomUUID } from "node:crypto";
import type { Automation, MusaScheduledReel, Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { flowDefinitionSchema, validateFlowDefinition } from "@/lib/flows/definition";
import { MusaIntegrationError } from "./errors";
import { freezeScheduledMusaFlow } from "./flows";
import { getScheduledReel, requireScheduler, reserveScheduledReel, type Scheduler } from "./scheduler";

type ReservationView = {
  status: "draft" | "waiting" | "active" | "cancelled" | "failed" | "unconfirmed";
  publicationId: string;
  requestId?: string;
  reservationId?: string;
  code?: string;
  title?: string;
  scheduledAt?: string;
  timezone?: string;
};

function reservationView(attempt: MusaScheduledReel): ReservationView {
  const status = attempt.status === "reserving" ? "unconfirmed" : attempt.status as Exclude<ReservationView["status"], "draft" | "unconfirmed">;
  return { status, publicationId: attempt.publicationId, requestId: attempt.requestId,
    ...(attempt.reservationId ? { reservationId: attempt.reservationId } : {}),
    ...(attempt.errorCode ? { code: attempt.errorCode } : {}) };
}

async function findLatestAttempt(automationId: string) {
  return await prisma.musaScheduledReel.findFirst({ where: { automationId }, orderBy: [{ createdAt: "desc" }, { requestId: "desc" }] });
}

export async function readScheduledCampaign(campaign: Automation): Promise<ReservationView> {
  if (!campaign.musaScheduledPublicationId)
    throw new MusaIntegrationError(404, "CAMPAIGN_NOT_FOUND", "No encontramos el flujo programado.");
  const attempt = await findLatestAttempt(campaign.id);
  if (!attempt) return { status: "draft", publicationId: campaign.musaScheduledPublicationId };
  if (!attempt.reservationId || attempt.status !== "waiting") return reservationView(attempt);
  try {
    const scheduler = await requireScheduler(campaign.workspaceId, campaign.instagramAccountId, attempt.connectionId);
    const remote = await getScheduledReel(scheduler, attempt.reservationId);
    if (remote.reservationId !== attempt.reservationId || remote.publicationId !== attempt.publicationId)
      throw new MusaIntegrationError(503, "MUSA_UNAVAILABLE", "No pudimos comprobar el Reel de MUSA.");
    if (remote.status === "cancelled" || remote.status === "failed") {
      await prisma.musaScheduledReel.updateMany({ where: { requestId: attempt.requestId, status: "waiting" },
        data: { status: remote.status } });
    }
    const current = await prisma.musaScheduledReel.findUniqueOrThrow({ where: { requestId: attempt.requestId } });
    return { ...reservationView(current), title: remote.title, scheduledAt: remote.scheduledAt, timezone: remote.timezone };
  } catch (error) {
    if (error instanceof MusaIntegrationError && error.code === "MUSA_RESERVATION_GONE") {
      await prisma.musaScheduledReel.updateMany({ where: { requestId: attempt.requestId, status: "waiting" },
        data: { status: "cancelled", errorCode: error.code } });
    }
    const current = await prisma.musaScheduledReel.findUniqueOrThrow({ where: { requestId: attempt.requestId } });
    return { ...reservationView(current), code: current.status === "waiting"
      ? error instanceof MusaIntegrationError ? error.code : "MUSA_UNAVAILABLE"
      : current.errorCode ?? undefined };
  }
}

async function createAttempt(campaign: Automation, scheduler: Scheduler, input: {
  requestId: string; publicationId: string; expectedRevision?: number;
}) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "MusaConnection" WHERE "id" = ${scheduler.connection.id} FOR NO KEY UPDATE`;
    const grant = await tx.musaSchedulerGrant.findFirst({ where: { connectionId: scheduler.connection.id,
      accountId: scheduler.account.id, instagramId: scheduler.account.instagramId,
      connection: { revokedAt: null, workspaceId: campaign.workspaceId } }, select: { accountId: true } });
    if (!grant) throw new MusaIntegrationError(409, "MUSA_NOT_CONNECTED", "La conexión de MUSA ya no está disponible.");
    await tx.$queryRaw`SELECT "id" FROM "Automation" WHERE "id" = ${campaign.id} FOR UPDATE`;
    const source = await tx.automation.findFirst({
      where: { id: campaign.id, workspaceId: campaign.workspaceId, instagramAccountId: scheduler.account.id },
    });
    if (!source?.musaScheduledPublicationId || source.isActive)
      throw new MusaIntegrationError(409, "MUSA_REEL_ALREADY_ACTIVE", "Este flujo ya tiene un Reel vinculado.");
    const ongoing = await tx.musaScheduledReel.findFirst({
      where: { automationId: source.id, status: { in: ["reserving", "waiting", "active"] } },
    });
    if (ongoing) {
      if (ongoing.publicationId === input.publicationId && ongoing.connectionId === scheduler.connection.id) return ongoing;
      throw new MusaIntegrationError(409, "MUSA_REEL_ALREADY_RESERVED", "El flujo tiene una reserva pendiente. Comprobá su estado antes de elegir otro Reel.");
    }
    const previous = await tx.musaScheduledReel.findFirst({ where: { requestId: input.requestId, automationId: source.id } });
    if (previous) {
      if (previous.publicationId !== input.publicationId || previous.connectionId !== scheduler.connection.id)
        throw new MusaIntegrationError(409, "MUSA_REQUEST_CONFLICT", "La solicitud corresponde a otro Reel.");
      return previous;
    }
    if (input.expectedRevision !== undefined && input.expectedRevision !== source.flowDraftRevision)
      throw new MusaIntegrationError(409, "FLOW_REVISION_CHANGED", "Otro editor cambió el borrador. Recargá antes de publicar.");
    const graph = flowDefinitionSchema.safeParse(source.flowDraft);
    if (!graph.success || !validateFlowDefinition(graph.data).valid)
      throw new MusaIntegrationError(400, "FLOW_INVALID", "Completá el flujo antes de publicarlo.");
    const latest = await tx.flowVersion.findFirst({ where: { automationId: source.id }, orderBy: { version: "desc" }, select: { version: true } });
    const version = await tx.flowVersion.create({ data: { workspaceId: source.workspaceId,
      automationId: source.id, version: (latest?.version ?? 0) + 1, definition: graph.data as Prisma.InputJsonValue } });
    await tx.automation.update({ where: { id: source.id },
      data: { flowPublishedVersionId: version.id, musaScheduledPublicationId: input.publicationId } });
    const bundle = await freezeScheduledMusaFlow(tx, scheduler, version.id);
    for (const node of graph.data.nodes) {
      const fieldKey = node.type === "input" ? node.data.fieldKey : node.type === "action" ? node.data.fieldKey : undefined;
      if (fieldKey && !["email", "phone"].includes(fieldKey)) {
        await tx.contactField.upsert({ where: { workspaceId_key: { workspaceId: source.workspaceId, key: fieldKey } },
          create: { workspaceId: source.workspaceId, key: fieldKey, label: fieldKey }, update: {} });
      }
    }
    return tx.musaScheduledReel.create({ data: { requestId: input.requestId, automationId: source.id,
      connectionId: scheduler.connection.id, accountId: scheduler.account.id, publicationId: input.publicationId,
      flowVersionId: version.id, rootCampaignId: source.id, flowCampaignIds: bundle.flowCampaignIds } });
  });
}

async function sendReservation(scheduler: Scheduler, attempt: MusaScheduledReel) {
  if (attempt.status !== "reserving") return reservationView(attempt);
  try {
    const remote = await reserveScheduledReel(scheduler, { requestId: attempt.requestId, publicationId: attempt.publicationId,
      automationId: attempt.automationId, flowVersionId: attempt.flowVersionId });
    await prisma.musaScheduledReel.updateMany({ where: { requestId: attempt.requestId, status: "reserving" },
      data: { reservationId: remote.reservationId, status: remote.status === "active" ? "waiting" : remote.status, errorCode: null } });
  } catch (error) {
    const code = error instanceof MusaIntegrationError ? error.code : "MUSA_UNAVAILABLE";
    const terminal = code === "MUSA_REEL_UNAVAILABLE";
    await prisma.musaScheduledReel.updateMany({ where: { requestId: attempt.requestId, status: "reserving" },
      data: { errorCode: code, ...(terminal ? { status: "failed" } : {}) } });
  }
  return reservationView(await prisma.musaScheduledReel.findUniqueOrThrow({ where: { requestId: attempt.requestId } }));
}

export async function publishScheduledCampaign(campaign: Automation, input: {
  publicationId: string; requestId?: string; expectedRevision?: number;
}): Promise<ReservationView> {
  if (!campaign.musaScheduledPublicationId)
    throw new MusaIntegrationError(404, "CAMPAIGN_NOT_FOUND", "No encontramos el flujo programado.");
  const current = await findLatestAttempt(campaign.id);
  if (current?.status === "active") {
    if (current.publicationId === input.publicationId) return reservationView(current);
    throw new MusaIntegrationError(409, "MUSA_REEL_ALREADY_ACTIVE", "Este flujo ya está vinculado a un Reel publicado.");
  }
  if (current?.status === "waiting") {
    const status = await readScheduledCampaign(campaign);
    if (current.publicationId === input.publicationId || status.status === "active") return status;
    if (status.status === "waiting")
      throw new MusaIntegrationError(409, "MUSA_REEL_ALREADY_RESERVED", "El flujo ya está esperando un Reel programado.");
  }
  const retry = current?.status === "reserving" && current.publicationId === input.publicationId ? current : null;
  const scheduler = await requireScheduler(campaign.workspaceId, campaign.instagramAccountId, retry?.connectionId);
  const attempt = retry ?? await createAttempt(campaign, scheduler, { ...input, requestId: input.requestId ?? randomUUID() });
  return sendReservation(scheduler, attempt);
}
