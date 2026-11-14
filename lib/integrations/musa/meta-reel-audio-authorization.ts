import { randomBytes } from "node:crypto";
import type { MetaReelAudioFlow, Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { encryptToken } from "@/lib/meta/oauth";
import { canManageWorkspace, type WorkspaceContext } from "@/lib/workspace-access";
import { hashMusaCredential } from "./auth";
import { exchangeMetaReelAudioGrant } from "./discovery-provider";
import { META_REEL_AUDIO_SCOPES, META_REEL_AUDIO_TTL_MS, metaReelAudioConfig } from "./meta-reel-audio-config";

const opaquePattern = /^[A-Za-z0-9_-]{43}$/;
export const metaReelAudioAccountIdPattern = /^[a-zA-Z0-9_-]{1,128}$/;
type ScopeDb = Pick<Prisma.TransactionClient, "instagramAccount" | "workspaceMember">;

function unavailable() {
  return new Error("META_REEL_AUDIO_AUTH_UNAVAILABLE");
}

async function validateFlowScope(flow: MetaReelAudioFlow, db: ScopeDb) {
  const membership = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: flow.workspaceId, userId: flow.actorUserId } },
    select: { role: true },
  });
  if (!membership || !canManageWorkspace(membership.role)) throw unavailable();
  const account = await db.instagramAccount.findFirst({
    where: { id: flow.accountId, workspaceId: flow.workspaceId, provider: "META", instagramId: flow.instagramId },
  });
  if (!account?.accessToken || hashMusaCredential(account.accessToken) !== flow.accountTokenHash) throw unavailable();
  return account;
}

export async function beginMetaReelAudio(context: WorkspaceContext, accountId: string) {
  if (!canManageWorkspace(context.role) || !metaReelAudioAccountIdPattern.test(accountId)) throw unavailable();
  const account = await prisma.instagramAccount.findFirst({
    where: { id: accountId, workspaceId: context.workspaceId, provider: "META" },
  });
  if (!account?.accessToken) throw unavailable();

  const config = metaReelAudioConfig();
  const state = randomBytes(32).toString("base64url");
  const browser = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({
    client_id: config.appId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    state,
    scope: META_REEL_AUDIO_SCOPES.join(","),
    auth_type: "rerequest",
  });
  const data = {
    workspaceId: context.workspaceId,
    actorUserId: context.userId,
    facebookAppId: config.appId,
    stateHash: hashMusaCredential(state),
    browserHash: hashMusaCredential(browser),
    accountTokenHash: hashMusaCredential(account.accessToken),
    instagramId: account.instagramId,
    expiresAt: new Date(Date.now() + META_REEL_AUDIO_TTL_MS),
    consumedAt: null,
  };
  await prisma.metaReelAudioFlow.upsert({
    where: { accountId },
    create: { accountId, ...data },
    update: data,
  });
  return { url: `https://www.facebook.com/${config.version}/dialog/oauth?${query}`, browser };
}

export async function claimMetaReelAudio(state: string | null, browser: string | null, userId: string) {
  if (!state || !browser || !opaquePattern.test(state) || !opaquePattern.test(browser)) throw unavailable();
  const where = {
    stateHash: hashMusaCredential(state),
    browserHash: hashMusaCredential(browser),
    actorUserId: userId,
    facebookAppId: metaReelAudioConfig().appId,
    expiresAt: { gt: new Date() },
    consumedAt: null,
  };
  return prisma.$transaction(async (tx) => {
    const flow = await tx.metaReelAudioFlow.findFirst({ where });
    if (!flow) throw unavailable();
    const account = await validateFlowScope(flow, tx);
    const claimed = await tx.metaReelAudioFlow.updateMany({
      where,
      data: { consumedAt: new Date() },
    });
    if (claimed.count !== 1) throw unavailable();
    return { flow, account };
  });
}

export async function finishMetaReelAudio(claim: Awaited<ReturnType<typeof claimMetaReelAudio>>, code: string, signal: AbortSignal) {
  const { flow, account } = claim;
  const config = metaReelAudioConfig();
  if (config.appId !== flow.facebookAppId) throw unavailable();
  const result = await exchangeMetaReelAudioGrant(code, account, signal, config, META_REEL_AUDIO_SCOPES);
  signal.throwIfAborted();
  await prisma.$transaction(async (tx) => {
    // The update locks this attempt against a new consent or account removal.
    const locked = await tx.metaReelAudioFlow.updateMany({
      where: { accountId: flow.accountId, stateHash: flow.stateHash, consumedAt: { not: null }, expiresAt: { gt: new Date() } },
      data: { stateHash: flow.stateHash },
    });
    if (locked.count !== 1) throw unavailable();
    await validateFlowScope(flow, tx);
    signal.throwIfAborted();
    const encryptedTokens = encryptToken(JSON.stringify({
      workspaceId: flow.workspaceId,
      accountId: flow.accountId,
      facebookAppId: result.facebookAppId,
      instagramId: flow.instagramId,
      facebookInstagramId: result.facebookInstagramId,
      pageId: result.pageId,
      accessToken: result.token,
    }));
    const data = {
      workspaceId: flow.workspaceId,
      grantedByUserId: flow.actorUserId,
      facebookAppId: result.facebookAppId,
      instagramId: flow.instagramId,
      instagramUserId: result.instagramUserId,
      facebookUserId: result.facebookUserId,
      facebookInstagramId: result.facebookInstagramId,
      pageId: result.pageId,
      encryptedTokens,
      expiresAt: result.expiresAt,
      scopes: result.scopes,
    };
    await tx.metaReelAudioGrant.upsert({
      where: { accountId: flow.accountId },
      create: { accountId: flow.accountId, ...data },
      update: data,
    });
  });
}
