import { randomUUID } from "node:crypto";
import type { MusaSocialPublication, Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { MusaIntegrationError } from "./errors";
import { MusaProviderError } from "./publications-provider";
import { requireSocialTarget, socialPayloadHash, socialPlatform, targetIdentity,
  type SocialConnection, type SocialPublicationInput, type SocialTarget } from "./social-policy";
import { createSocialPost, getSocialPost, verifySocialPublication } from "./social-zernio";

const LEASE_MS = 30_000;
const CREATE_RETRY_MS = 23 * 60 * 60_000;
const CONFIRMATION_MS = 24 * 60 * 60_000;
const RETRY_DELAY_MS = 30_000;
const RETRY_STATUS = "processing";
type ReceiptStatus = "processing" | "published" | "failed" | "uncertain";
type RemotePost = Awaited<ReturnType<typeof getSocialPost>>;
type Updates = Prisma.MusaSocialPublicationUpdateManyMutationInput;

function publicationScope(connection: SocialConnection, publicationId: string) {
  return { publicationId, businessId: connection.businessId, connectionId: connection.connectionId,
    profileId: connection.profileId };
}

function receipt(row: MusaSocialPublication) {
  const wait = Math.max(row.nextAttemptAt?.getTime() ?? 0, row.leaseUntil?.getTime() ?? 0) - Date.now();
  return { version: 1 as const, publicationId: row.publicationId, status: row.status as ReceiptStatus,
    mediaId: row.mediaId, permalink: row.permalink, errorCode: row.errorCode,
    retryAfterSeconds: row.status === RETRY_STATUS ? Math.max(1, Math.min(3600, Math.ceil(wait / 1000))) : null };
}

function receiptTarget(connection: SocialConnection, row: MusaSocialPublication) {
  const platform = socialPlatform.parse(row.platform);
  const target = requireSocialTarget(connection, platform, row.accountId);
  if (row.targetIdentity !== targetIdentity(target))
    throw new MusaIntegrationError(409, "CONNECTION_CHANGED", "The social account granted to this business has changed.");
  return target;
}

async function findReceipt(connection: SocialConnection, publicationId: string) {
  const row = await prisma.musaSocialPublication.findFirst({ where: publicationScope(connection, publicationId) });
  if (!row) throw new MusaIntegrationError(404, "PUBLICATION_NOT_FOUND", "Publication not found.");
  return { row, target: receiptTarget(connection, row) };
}

async function ensureReceipt(connection: SocialConnection, target: SocialTarget, publicationId: string, input: SocialPublicationInput) {
  const scope = publicationScope(connection, publicationId);
  const payloadHash = socialPayloadHash(input);
  let row = await prisma.musaSocialPublication.findFirst({ where: scope });
  if (!row) {
    if (Date.parse(input.scheduledFor) > Date.now())
      throw new MusaIntegrationError(409, "PUBLICATION_NOT_DUE", "The scheduled time has not arrived.");
    try {
      row = await prisma.musaSocialPublication.create({ data: { ...scope,
        platform: target.platform, accountId: target.accountId, targetIdentity: targetIdentity(target), payloadHash } });
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "P2002")) throw error;
      row = await prisma.musaSocialPublication.findFirst({ where: scope });
      if (!row) throw new MusaIntegrationError(409, "PUBLICATION_CONFLICT", "Publication ID is unavailable.");
    }
  }
  receiptTarget(connection, row);
  if (row.payloadHash !== payloadHash || row.accountId !== target.accountId || row.platform !== target.platform)
    throw new MusaIntegrationError(409, "PUBLICATION_PAYLOAD_CONFLICT", "This publication ID already has different content.");
  return row;
}

async function acquireLease(row: MusaSocialPublication, now: Date) {
  const token = randomUUID();
  const result = await prisma.musaSocialPublication.updateMany({
    where: { publicationId: row.publicationId, businessId: row.businessId, connectionId: row.connectionId,
      status: row.status, providerPostId: row.providerPostId, updatedAt: row.updatedAt,
      AND: [{ OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
        { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }] },
    data: { leaseToken: token, leaseUntil: new Date(now.getTime() + LEASE_MS) },
  });
  return result.count ? token : null;
}

async function saveUnderLease(row: MusaSocialPublication, token: string, data: Updates) {
  return prisma.musaSocialPublication.updateMany({
    where: { publicationId: row.publicationId, businessId: row.businessId,
      connectionId: row.connectionId, profileId: row.profileId, leaseToken: token },
    data,
  });
}

function pending(now: Date, errorCode: string | null = null) {
  return { status: RETRY_STATUS, errorCode, nextAttemptAt: new Date(now.getTime() + RETRY_DELAY_MS) };
}

function terminal(status: Exclude<ReceiptStatus, "processing">, errorCode: string | null) {
  return { status, errorCode, nextAttemptAt: null };
}

function postUpdate(remote: RemotePost, now: Date, confirmationSince: Date): Updates {
  const reference = { providerPostId: remote.postId };
  if (remote.isDraft)
    return { ...reference, ...terminal("failed", "PROVIDER_DRAFT_NOT_PUBLISHED") };
  if (remote.status === "published" && remote.mediaId)
    return { ...reference, ...terminal("published", null), mediaId: remote.mediaId, permalink: remote.permalink };
  if (remote.status === "failed" || remote.status === "cancelled")
    return { ...reference, ...terminal("failed", "PROVIDER_PUBLICATION_FAILED") };
  if (now.getTime() - confirmationSince.getTime() >= CONFIRMATION_MS)
    return { ...reference, ...terminal("uncertain", "PUBLICATION_CONFIRMATION_REQUIRED") };
  return { ...reference, ...pending(now) };
}

async function readProviderReceipt(connection: SocialConnection, target: SocialTarget, row: MusaSocialPublication, now: Date): Promise<Updates> {
  const postId = row.providerPostId;
  if (!postId || !row.attemptStartedAt) return terminal("uncertain", "PUBLICATION_CONFIRMATION_REQUIRED");
  try {
    return postUpdate(await getSocialPost(connection, target, postId), now, row.attemptStartedAt);
  } catch (error) {
    if (!(error instanceof MusaProviderError)) throw error;
    if (row.status === "uncertain" || now.getTime() - row.attemptStartedAt.getTime() >= CONFIRMATION_MS)
      return { ...terminal("uncertain", "PUBLICATION_CONFIRMATION_REQUIRED"), nextAttemptAt: pending(now).nextAttemptAt };
    return pending(now, error.code);
  }
}

async function sendToProvider(connection: SocialConnection, target: SocialTarget, row: MusaSocialPublication,
  input: SocialPublicationInput, token: string, now: Date): Promise<Updates | null> {
  if (row.attemptStartedAt && now.getTime() - row.attemptStartedAt.getTime() >= CREATE_RETRY_MS)
    return terminal("uncertain", "PUBLICATION_CONFIRMATION_REQUIRED");
  let started = row.attemptStartedAt;
  let scheduledAt = row.providerScheduledAt;
  try {
    await verifySocialPublication(connection, target, input);
    if (!started || !scheduledAt) {
      started = new Date();
      scheduledAt = new Date(started.getTime() + RETRY_DELAY_MS);
      const marked = await saveUnderLease(row, token, { attemptStartedAt: started, providerScheduledAt: scheduledAt });
      if (!marked.count) return null;
    }
    return postUpdate(await createSocialPost(connection, target, input, row.publicationId, scheduledAt), now, started);
  } catch (error) {
    if (!(error instanceof MusaProviderError)) throw error;
    if (error.ambiguous || error.retryable) return pending(now, error.code);
    // The first call can fail definitively. A rejection on replay cannot erase an earlier unconfirmed attempt.
    return row.attemptStartedAt ? terminal("uncertain", "PUBLICATION_CONFIRMATION_REQUIRED") : terminal("failed", error.code);
  }
}

async function advanceReceipt(connection: SocialConnection, target: SocialTarget, row: MusaSocialPublication, input?: SocialPublicationInput) {
  const now = new Date();
  const mayPoll = Boolean(row.providerPostId) && (row.status === "processing" || row.status === "uncertain" ||
    row.status === "published" && row.permalink === null);
  const mayCreate = row.status === "processing" && !row.providerPostId && input !== undefined;
  if (!mayCreate && !mayPoll) return receipt(row);
  const token = await acquireLease(row, now);
  if (!token) return receipt((await findReceipt(connection, row.publicationId)).row);
  try {
    const changes = mayPoll ? await readProviderReceipt(connection, target, row, now)
      : input ? await sendToProvider(connection, target, row, input, token, now) : null;
    if (row.status === "published") {
      const permalink = changes?.mediaId === row.mediaId && typeof changes?.permalink === "string" ? changes.permalink : null;
      await saveUnderLease(row, token, { permalink, nextAttemptAt: permalink ? null : pending(now).nextAttemptAt });
    } else if (changes) {
      await saveUnderLease(row, token, changes);
    }
  } finally {
    await saveUnderLease(row, token, { leaseToken: null, leaseUntil: null });
  }
  return receipt((await findReceipt(connection, row.publicationId)).row);
}

export async function getSocialPublication(connection: SocialConnection, publicationId: string) {
  const { row, target } = await findReceipt(connection, publicationId);
  return advanceReceipt(connection, target, row);
}

export async function putSocialPublication(connection: SocialConnection, publicationId: string, input: SocialPublicationInput) {
  if (input.connectionId !== connection.connectionId)
    throw new MusaIntegrationError(409, "CONNECTION_CHANGED", "The social publishing connection has changed.");
  const target = requireSocialTarget(connection, input.platform, input.accountId);
  const row = await ensureReceipt(connection, target, publicationId, input);
  return advanceReceipt(connection, target, row, input);
}
