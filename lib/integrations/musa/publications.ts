import { randomUUID } from "node:crypto";
import type { MusaPublication, Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { createInstagramContext } from "@/lib/instagram/context";
import { requireMusaAccount, type MusaConnectionContext } from "./auth";
import { MusaIntegrationError } from "./errors";
import { getMusaPublishingCapability } from "./publications-capabilities";
import { isMusaCampaignAttachable, musaPublicationInputSchema, publicationPayloadHash, type MusaPublicationInput } from "./publications-policy";
import { createMetaContainer, createZernioPublication, getZernioPublication, metaContainerStatus,
  metaMediaPermalink, metaPublishingQuota, MusaProviderError, publishMetaContainer, readZernioPublication } from "./publications-provider";

const LEASE_MS = 30_000;
const transactionOptions = { maxWait: 1000, timeout: 3000 };
const scope = (context: MusaConnectionContext, publicationId: string) => ({
  connectionId: context.connectionId, workspaceId: context.workspaceId, publicationId,
});

export function musaPublicationResult(row: MusaPublication) {
  return { version: 1 as const, publicationId: row.publicationId,
    status: row.status as "processing" | "published" | "failed" | "uncertain",
    mediaId: row.mediaId, permalink: row.permalink, errorCode: row.errorCode,
    ...(row.status === "published" && row.provider === "META" && !row.mediaId && !row.permalink
      && row.confirmationContainerId && /^[a-zA-Z0-9_-]{1,128}$/.test(row.confirmationContainerId)
      && row.confirmationContainerId === row.containerId
      ? { confirmation: { source: "meta_container" as const, containerId: row.confirmationContainerId, status: "PUBLISHED" as const } } : {}),
    retryAfterSeconds: row.status === "processing"
      ? Math.max(1, Math.ceil((Math.max(row.nextAttemptAt?.getTime() ?? 0, row.leaseUntil?.getTime() ?? 0) - Date.now()) / 1000)) : null };
}

async function loadMusaPublication(context: MusaConnectionContext, publicationId: string) {
  const row = await prisma.musaPublication.findFirst({ where: scope(context, publicationId) });
  if (!row) throw new MusaIntegrationError(404, "PUBLICATION_NOT_FOUND", "Publication not found");
  requireMusaAccount(context, row.accountId);
  return row;
}

/** A receipt may read an exact saved container, but can never publish or create one. */
export async function getMusaPublication(context: MusaConnectionContext, publicationId: string) {
  const row = await loadMusaPublication(context, publicationId);
  const unfinished = row.status === "processing" || row.status === "uncertain";
  const finalize = row.stage === "FINALIZE" && Boolean(row.mediaId);
  const container = row.provider === "META" && Boolean(row.containerId && /^[a-zA-Z0-9_-]{1,128}$/.test(row.containerId))
    && (row.stage === "META_PUBLISHING" || row.stage === "META_PROCESSING" && row.status === "uncertain");
  if (unfinished && (finalize || container)) await reconcileMusaPublication(context, row);
  return musaPublicationResult(await loadMusaPublication(context, publicationId));
}

async function confirmMetaContainer(row: MusaPublication, leaseToken: string) {
  await prisma.musaPublication.updateMany({ where: { id: row.id, leaseToken, status: row.status,
    stage: row.stage, provider: "META", containerId: row.containerId, mediaId: null }, data: {
    status: "published", stage: "DONE", confirmationContainerId: row.containerId,
    mediaId: null, permalink: null, publishedAt: new Date(), nextAttemptAt: null,
    errorCode: row.campaignId ? "CAMPAIGN_BINDING_CONFLICT" : null,
  } });
}

async function reconcileMusaPublication(context: MusaConnectionContext, row: MusaPublication) {
  const now = new Date();
  const leaseToken = randomUUID();
  const acquired = await prisma.musaPublication.updateMany({ where: {
    ...scope(context, row.publicationId), id: row.id, accountId: row.accountId, provider: row.provider,
    status: row.status, stage: row.stage, containerId: row.containerId, mediaId: row.mediaId,
    AND: [{ OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
      { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }],
  }, data: { leaseToken, leaseUntil: new Date(now.getTime() + LEASE_MS),
    nextAttemptAt: new Date(now.getTime() + 60_000) } });
  if (!acquired.count) return;
  try {
    if (row.stage === "FINALIZE" && row.mediaId) {
      let permalink = row.permalink;
      if (!permalink && row.provider === "META") {
        try {
          const provider = await createInstagramContext(requireMusaAccount(context, row.accountId));
          permalink = await metaMediaPermalink(provider, row.mediaId);
        } catch { permalink = null; }
      }
      await finishPublication(row, leaseToken, permalink);
    } else {
      const provider = await createInstagramContext(requireMusaAccount(context, row.accountId));
      if (provider.provider !== "META" || !row.containerId) throw new MusaProviderError("PROVIDER_ACCOUNT_MISMATCH");
      const status = await metaContainerStatus(provider, row.containerId);
      if (status === "PUBLISHED") await confirmMetaContainer(row, leaseToken);
      else await prisma.musaPublication.updateMany({ where: { id: row.id, leaseToken, status: { in: ["processing", "uncertain"] } },
        data: { status: "uncertain", errorCode: "PUBLICATION_CONFIRMATION_REQUIRED" } });
    }
  } catch (error) {
    // Losing read access does not prove failure, nor allow another publication.
    await prisma.musaPublication.updateMany({ where: { id: row.id, leaseToken, status: { in: ["processing", "uncertain"] } }, data: {
      status: "uncertain", errorCode: error instanceof MusaProviderError ? error.code : "PUBLICATION_CONFIRMATION_REQUIRED",
    } });
  } finally {
    await prisma.musaPublication.updateMany({ where: { id: row.id, leaseToken }, data: { leaseToken: null, leaseUntil: null } });
  }
}

async function ensurePublication(context: MusaConnectionContext, publicationId: string, payload: MusaPublicationInput) {
  const account = requireMusaAccount(context, payload.accountId);
  const where = scope(context, publicationId);
  const payloadHash = publicationPayloadHash(payload);
  let row = await prisma.musaPublication.findFirst({ where });
  if (!row) {
    try {
      row = await prisma.$transaction(async (tx) => {
        let campaignUpdatedAt: Date | null = null;
        if (payload.campaignId) {
          // The reservation and a competing campaign activation serialize here.
          await tx.$queryRaw`SELECT "id" FROM "Automation" WHERE "id" = ${payload.campaignId} FOR UPDATE`;
          const campaign = await tx.automation.findFirst({ where: {
            id: payload.campaignId, workspaceId: context.workspaceId, instagramAccountId: account.id,
          } });
          if (!campaign || !isMusaCampaignAttachable(campaign))
            throw new MusaIntegrationError(409, "CAMPAIGN_CONFLICT", "Choose a paused campaign without an assigned post");
          campaignUpdatedAt = campaign.updatedAt;
        }
        return tx.musaPublication.create({ data: { ...where, accountId: account.id, provider: account.provider,
          payloadHash, payload, campaignId: payload.campaignId ?? null, campaignUpdatedAt } });
      }, transactionOptions);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "P2002")) throw error;
      // A simultaneous PUT may have won; a different reservation/key is a conflict.
      row = await prisma.musaPublication.findFirst({ where });
      if (!row) throw new MusaIntegrationError(409, "PUBLICATION_CONFLICT", "Publication or campaign is already reserved");
    }
  }
  if (row.payloadHash !== payloadHash || row.accountId !== account.id || row.provider !== account.provider)
    throw new MusaIntegrationError(409, "PUBLICATION_PAYLOAD_CONFLICT", "This publication ID already has different content");
  return row;
}

async function assertCampaignUnchanged(row: MusaPublication) {
  if (!row.campaignId) return;
  const campaign = await prisma.automation.findFirst({ where: { id: row.campaignId,
    workspaceId: row.workspaceId, instagramAccountId: row.accountId, updatedAt: row.campaignUpdatedAt ?? undefined } });
  if (!campaign || !isMusaCampaignAttachable(campaign)) throw new MusaProviderError("CAMPAIGN_CONFLICT");
}

async function finishPublication(row: MusaPublication, leaseToken: string, permalink: string | null) {
  return prisma.$transaction(async (tx) => {
    const saved = await tx.musaPublication.updateMany({ where: { id: row.id, leaseToken }, data: {
      status: "published", stage: "DONE", permalink, publishedAt: new Date(), errorCode: null, confirmationContainerId: null, nextAttemptAt: null,
    } });
    if (!saved.count) return;
    if (row.campaignId) {
      const bound = await tx.automation.updateMany({ where: {
        id: row.campaignId, workspaceId: row.workspaceId, instagramAccountId: row.accountId,
        updatedAt: row.campaignUpdatedAt ?? undefined,
        isActive: false, postId: null, matchAnyPost: false, dmTriggerEnabled: false,
      }, data: { postId: row.mediaId, postUrl: permalink, pendingNextReel: false, nextReelArmedAt: null } });
      if (!bound.count) await tx.musaPublication.updateMany({ where: { id: row.id, leaseToken },
        data: { errorCode: "CAMPAIGN_BINDING_CONFLICT" } });
    }
  }, transactionOptions);
}

/** One provider operation per call; MUSA durably schedules the next PUT. */
export async function advanceMusaPublication(context: MusaConnectionContext, publicationId: string, input: MusaPublicationInput) {
  const row = await ensurePublication(context, publicationId, input);
  const account = requireMusaAccount(context, row.accountId);
  if (row.status !== "processing") return musaPublicationResult(row);
  const now = new Date();
  const leaseToken = randomUUID();
  const acquired = await prisma.musaPublication.updateMany({ where: { id: row.id, status: "processing",
    AND: [{ OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
      { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }] },
    data: { leaseToken, leaseUntil: new Date(now.getTime() + LEASE_MS) } });
  if (!acquired.count) return musaPublicationResult(await loadMusaPublication(context, publicationId));
  let current = (await prisma.musaPublication.findUnique({ where: { id: row.id } }))!;
  const save = async (data: Prisma.MusaPublicationUpdateManyMutationInput) => {
    const result = await prisma.musaPublication.updateMany({ where: { id: row.id, leaseToken },
      data: { ...(data.stage ? { errorCode: null } : {}), ...data } });
    if (!result.count) throw new MusaProviderError("PUBLICATION_LEASE_LOST", true);
    current = (await prisma.musaPublication.findUnique({ where: { id: row.id } }))!;
  };
  const wait = (seconds: number, errorCode: string | null = null) => save({
    nextAttemptAt: new Date(Date.now() + seconds * 1000), errorCode,
  });
  try {
    const payload = musaPublicationInputSchema.parse(current.payload);
    if (current.stage === "META_CREATING" || current.stage === "META_PUBLISHING") {
      // A worker died after the write-ahead marker. Never repeat that POST.
      await save({ status: "uncertain", errorCode: "PUBLICATION_CONFIRMATION_REQUIRED" });
    } else if (current.stage === "PREPARE") {
      await assertCampaignUnchanged(current);
      const capability = await getMusaPublishingCapability(account);
      if (!capability.canPublish) throw new MusaProviderError(capability.publishUnavailableReason ?? "PUBLISH_PERMISSION_REQUIRED");
      await save({ stage: "READY", nextAttemptAt: null });
    } else {
      const provider = await createInstagramContext(account);
      if (current.stage === "READY" && provider.provider === "META") {
        await assertCampaignUnchanged(current);
        await save({ stage: "META_CREATING", attemptStartedAt: new Date() });
        const containerId = await createMetaContainer(provider, account.instagramId, payload);
        await save({ stage: "META_PROCESSING", containerId, nextAttemptAt: new Date(Date.now() + 30_000) });
      } else if (current.stage === "META_PROCESSING" && current.containerId) {
        const status = await metaContainerStatus(provider, current.containerId);
        if (status === "FINISHED") await save({ stage: "META_QUOTA", nextAttemptAt: null });
        else if (status === "ERROR" || status === "EXPIRED") throw new MusaProviderError(`MEDIA_${status}`);
        else if (status === "PUBLISHED") await confirmMetaContainer(current, leaseToken);
        else await wait(60);
      } else if (current.stage === "META_QUOTA") {
        if (await metaPublishingQuota(provider, account.instagramId)) await save({ stage: "META_READY", nextAttemptAt: null });
        else await wait(300, "PUBLISHING_QUOTA_REACHED");
      } else if (current.stage === "META_READY" && current.containerId) {
        await assertCampaignUnchanged(current);
        await save({ stage: "META_PUBLISHING", attemptStartedAt: new Date() });
        const mediaId = await publishMetaContainer(provider, account.instagramId, current.containerId);
        await save({ stage: "FINALIZE", mediaId, nextAttemptAt: null });
      } else if ((current.stage === "READY" || current.stage === "ZERNIO_CREATING") && provider.provider === "ZERNIO") {
        await assertCampaignUnchanged(current);
        if (current.attemptStartedAt && Date.now() - current.attemptStartedAt.getTime() >= 23 * 3600_000) {
          await save({ status: "uncertain", errorCode: "PROVIDER_IDEMPOTENCY_WINDOW_EXPIRED" });
        } else {
          if (current.stage === "READY") await save({ stage: "ZERNIO_CREATING", attemptStartedAt: new Date(),
            providerScheduledAt: new Date(Date.now() + 30_000) });
          const raw = await createZernioPublication(provider, payload, publicationId, current.providerScheduledAt!);
          // Save the provider's own post ID before interpreting a target outcome.
          const id = raw && typeof raw === "object" && "post" in raw && raw.post && typeof raw.post === "object" &&
            "_id" in raw.post && typeof raw.post._id === "string" ? raw.post._id : null;
          if (!id) throw new MusaProviderError("PROVIDER_INVALID_RESPONSE", true, true);
          await save({ stage: "ZERNIO_PROCESSING", providerPostId: id, nextAttemptAt: new Date(Date.now() + 30_000) });
        }
      } else if (current.stage === "ZERNIO_PROCESSING" && current.providerPostId && provider.provider === "ZERNIO") {
        const result = readZernioPublication(await getZernioPublication(provider, current.providerPostId), provider.accountId);
        if (result.postId !== current.providerPostId) throw new MusaProviderError("PROVIDER_ACCOUNT_MISMATCH");
        if (result.status === "published") {
          if (!result.mediaId) await save({ status: "uncertain", errorCode: "PUBLICATION_ID_UNAVAILABLE" });
          else await save({ stage: "FINALIZE", mediaId: result.mediaId, permalink: result.permalink, nextAttemptAt: null });
        } else if (["failed", "cancelled"].includes(result.status)) throw new MusaProviderError("PROVIDER_PUBLICATION_FAILED");
        else await wait(30);
      } else if (current.stage === "FINALIZE" && current.mediaId) {
        let permalink = current.permalink;
        if (!permalink && provider.provider === "META") permalink = await metaMediaPermalink(provider, current.mediaId).catch(() => null);
        await finishPublication(current, leaseToken, permalink);
      } else throw new MusaProviderError("PUBLICATION_STATE_INVALID", true);
    }
  } catch (error) {
    if (!(error instanceof MusaProviderError)) throw error;
    const zernioRetry = current.stage === "ZERNIO_CREATING" && (error.ambiguous || error.retryable);
    if (error.ambiguous && !zernioRetry) await save({ status: "uncertain", errorCode: error.code });
    else if (error.retryable || zernioRetry) {
      // A definite rate limit did not create/publish anything; restore its step.
      if (current.stage === "META_CREATING") await save({ stage: "READY" });
      if (current.stage === "META_PUBLISHING") await save({ stage: "META_READY" });
      await wait(60, error.code);
    } else if (["ZERNIO_CREATING", "ZERNIO_PROCESSING"].includes(current.stage) && error.code !== "PROVIDER_PUBLICATION_FAILED") {
      // Losing read/auth access does not cancel a post already handed to Zernio.
      // A previous create response may also have been lost. Do not invite a new UUID.
      await save({ status: "uncertain", errorCode: error.code });
    } else await save({ status: "failed", errorCode: error.code, campaignId: null, campaignUpdatedAt: null });
  } finally {
    await prisma.musaPublication.updateMany({ where: { id: row.id, leaseToken }, data: { leaseToken: null, leaseUntil: null } });
  }
  return musaPublicationResult(await loadMusaPublication(context, publicationId));
}
