import { z } from "zod";
import { prisma } from "@/lib/db/client";
import type { ProviderAccount } from "@/lib/instagram/context";
import { decryptToken } from "@/lib/meta/oauth";
import { META_REEL_AUDIO_SCOPES } from "./meta-reel-audio-config";

const grantCredentials = z.object({
  workspaceId: z.string(),
  accountId: z.string(),
  facebookAppId: z.string(),
  instagramId: z.string(),
  facebookInstagramId: z.string(),
  pageId: z.string(),
  accessToken: z.string().min(1),
  pageAccessToken: z.string().min(1),
});

export type MetaReelAudioGrant = {
  instagramId: string;
  accessToken: string;
  pageAccessToken: string;
};

/** Reads the workspace's independent Facebook grant, bound to its Meta account. */
export async function getMetaReelAudioGrant(account: ProviderAccount & { id: string }): Promise<MetaReelAudioGrant | null> {
  const facebookAppId = process.env.FACEBOOK_APP_ID;
  if (account.provider !== "META" || !account.accessToken || !facebookAppId) return null;

  const grant = await prisma.metaReelAudioGrant.findUnique({ where: { accountId: account.id } });
  if (!grant || grant.workspaceId !== account.workspaceId || grant.instagramId !== account.instagramId
    || grant.facebookAppId !== facebookAppId || grant.expiresAt.getTime() <= Date.now()
    || !META_REEL_AUDIO_SCOPES.every((scope) => grant.scopes.includes(scope))) return null;

  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: account.workspaceId, userId: grant.grantedByUserId } },
    select: { role: true },
  });
  if (membership?.role !== "OWNER" && membership?.role !== "ADMIN") return null;

  try {
    const tokens = grantCredentials.parse(JSON.parse(decryptToken(grant.encryptedTokens)));
    if (tokens.workspaceId !== grant.workspaceId || tokens.accountId !== grant.accountId
      || tokens.facebookAppId !== grant.facebookAppId || tokens.instagramId !== grant.instagramId
      || tokens.facebookInstagramId !== grant.facebookInstagramId || tokens.pageId !== grant.pageId) return null;
    return { instagramId: grant.facebookInstagramId, accessToken: tokens.accessToken, pageAccessToken: tokens.pageAccessToken };
  } catch {
    return null;
  }
}
