import { z } from "zod";
import { MusaIntegrationError } from "./errors";
import { MusaProviderError, publicationProviderRequest } from "./publications-provider";
import { requireSocialTarget, socialId, tiktokCommercialContent, tiktokPrivacy, zernioId,
  type SocialConnection, type SocialPublicationInput, type SocialTarget } from "./social-policy";
import { musaPublicMediaUrl } from "./publications-policy";

const idOrAccount = z.union([zernioId, z.object({ _id: zernioId }).transform(value => value._id)]);
const accountItem = z.object({
  _id: zernioId, platform: z.string(), profileId: idOrAccount, isActive: z.boolean(),
  username: z.string().min(1).max(100).nullish(), displayName: z.string().min(1).max(100).nullish(),
  platformUserId: socialId.nullish(),
});
const accountsResponse = z.object({ accounts: z.array(z.unknown()) });
const healthResponse = z.object({
  accountId: zernioId, platform: z.string(), status: z.enum(["healthy", "warning", "error"]),
  tokenStatus: z.object({ valid: z.boolean() }),
  permissions: z.object({ canPost: z.boolean() }),
});
const pagesResponse = z.object({
  pages: z.array(z.object({ id: z.string(), name: z.string().min(1).max(100).nullish() })),
});

function zernio(connection: SocialConnection, accountId: string, path: string,
  options?: Parameters<typeof publicationProviderRequest>[2]) {
  return publicationProviderRequest({ provider: "ZERNIO", accountId, apiKey: connection.apiKey }, path, options);
}

function validated<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const result = schema.safeParse(raw);
  if (!result.success) throw new MusaProviderError("PROVIDER_INVALID_RESPONSE", false, true);
  return result.data;
}

export function handleSocialReadError(error: unknown) {
  if (!(error instanceof MusaProviderError)) return error;
  const status = error.retryable ? 503 : error.code === "RECONNECT_REQUIRED" ? 403 : 502;
  return new MusaIntegrationError(status, error.code, "Zernio could not verify this social connection.");
}

async function findSocialAccount(connection: SocialConnection, target: SocialTarget, account: z.infer<typeof accountItem> | undefined) {
  if (!account || account.profileId !== connection.profileId || account._id !== target.accountId || account.platform !== target.platform ||
    (target.platform === "tiktok" && account.platformUserId !== target.platformUserId)) return null;
  const path = "/accounts/" + target.accountId;
  const [healthRaw, pagesRaw] = await Promise.all([
    zernio(connection, target.accountId, path + "/health"),
    target.platform === "facebook" ? zernio(connection, target.accountId, path + "/facebook-page") : null,
  ]);
  const health = validated(healthResponse, healthRaw);
  if (health.accountId !== target.accountId || health.platform !== target.platform)
    throw new MusaProviderError("PROVIDER_ACCOUNT_MISMATCH");
  const page = target.platform === "facebook" ? validated(pagesResponse, pagesRaw).pages.find(item => item.id === target.pageId) : null;
  if (target.platform === "facebook" && !page) return null;
  const username = page?.name ?? account.username ?? account.displayName;
  if (!username) throw new MusaProviderError("PROVIDER_INVALID_RESPONSE", false, true);
  return { id: target.accountId, platform: target.platform, username,
    ...(target.platform === "facebook" ? { pageId: target.pageId } : {}),
    canPublish: account.isActive && health.status !== "error" && health.tokenStatus.valid && health.permissions.canPost };
}

async function profileAccounts(connection: SocialConnection) {
  const { accounts } = validated(accountsResponse, await zernio(connection, connection.targets[0].accountId,
    "/accounts?profileId=" + connection.profileId));
  const chosen = new Set(connection.targets.map(target => target.accountId));
  return accounts.flatMap(raw => {
    const account = accountItem.safeParse(raw);
    return account.success && chosen.has(account.data._id) ? [account.data] : [];
  });
}

export async function listSocialAccounts(connection: SocialConnection) {
  const available = await profileAccounts(connection);
  const checks = await Promise.allSettled(connection.targets.map(target =>
    findSocialAccount(connection, target, available.find(item => item._id === target.accountId))));
  const accounts = checks.flatMap(check => check.status === "fulfilled" && check.value ? [check.value] : []);
  const failure = checks.find(check => check.status === "rejected");
  if (!accounts.length && failure) throw failure.reason;
  return { version: 1 as const, connectionId: connection.connectionId, accounts };
}

const creatorToggle = z.object({ enabled: z.boolean() });
const creatorResponse = z.object({
  creator: z.object({ canPostMore: z.boolean() }),
  privacyLevels: z.array(z.object({ value: tiktokPrivacy })),
  postingLimits: z.object({
    maxVideoDurationSec: z.number().int().positive(),
    interactionSettings: z.object({ allow_comment: creatorToggle, allow_duet: creatorToggle, allow_stitch: creatorToggle }),
  }),
  commercialContentTypes: z.array(z.object({ value: tiktokCommercialContent })),
});

async function readCreatorInfo(connection: SocialConnection, accountId: string) {
  const raw = await zernio(connection, accountId, "/accounts/" + accountId + "/tiktok/creator-info?mediaType=video");
  const info = validated(creatorResponse, raw);
  const { allow_comment, allow_duet, allow_stitch } = info.postingLimits.interactionSettings;
  return { version: 1 as const, accountId,
    privacyLevels: info.privacyLevels.map(({ value }) => value),
    interactionSettings: { allowComment: allow_comment.enabled, allowDuet: allow_duet.enabled, allowStitch: allow_stitch.enabled },
    canPostMore: info.creator.canPostMore, maxVideoDurationSec: info.postingLimits.maxVideoDurationSec,
    commercialContentTypes: info.commercialContentTypes.map(({ value }) => value),
  };
}

async function verifySocialAccount(connection: SocialConnection, target: SocialTarget) {
  const accounts = await profileAccounts(connection);
  const confirmed = await findSocialAccount(connection, target, accounts.find(account => account._id === target.accountId));
  if (!confirmed?.canPublish) throw new MusaProviderError("RECONNECT_REQUIRED");
}

export async function getSocialCreatorInfo(connection: SocialConnection, accountId: string) {
  const target = requireSocialTarget(connection, "tiktok", accountId);
  await verifySocialAccount(connection, target);
  return readCreatorInfo(connection, accountId);
}

export async function verifySocialPublication(connection: SocialConnection, target: SocialTarget, input: SocialPublicationInput) {
  await verifySocialAccount(connection, target);
  if (input.platform !== "tiktok") return;
  const info = await readCreatorInfo(connection, target.accountId);
  const { privacyLevel, commercialContentType, allowComment, allowDuet, allowStitch } = input.tiktok;
  const available = info.interactionSettings;
  if (!info.canPostMore) throw new MusaProviderError("TIKTOK_CREATOR_POST_LIMIT", false, true);
  if (!info.privacyLevels.includes(privacyLevel) || !info.commercialContentTypes.includes(commercialContentType) ||
    allowComment && !available.allowComment || allowDuet && !available.allowDuet || allowStitch && !available.allowStitch)
    throw new MusaProviderError("TIKTOK_CREATOR_OPTIONS_CHANGED");
}

const socialPost = z.object({ post: z.object({
  _id: zernioId,
  platforms: z.array(z.object({
    platform: z.string(), accountId: idOrAccount, status: z.string(),
    platformPostId: socialId.nullish(), platformPostUrl: musaPublicMediaUrl.nullish(),
    platformSpecificData: z.object({ isDraft: z.boolean().optional(), pageId: z.string().optional() }).optional(),
  })).length(1),
}) });

function readSocialPost(raw: unknown, target: SocialTarget, expectedPostId?: string) {
  const { post } = validated(socialPost, raw);
  const [match] = post.platforms;
  if (expectedPostId && post._id !== expectedPostId || match.platform !== target.platform || match.accountId !== target.accountId ||
    target.platform === "facebook" && match.platformSpecificData?.pageId !== undefined && match.platformSpecificData.pageId !== target.pageId)
    throw new MusaProviderError("PROVIDER_ACCOUNT_MISMATCH", true, true);
  return { postId: post._id, status: match.status, mediaId: match.platformPostId ?? null,
    permalink: match.platformPostUrl ?? null, isDraft: match.platformSpecificData?.isDraft === true };
}

export async function createSocialPost(connection: SocialConnection, target: SocialTarget, input: SocialPublicationInput,
  publicationId: string, scheduledAt: Date) {
  const settings = input.platform === "tiktok" ? input.tiktok : null;
  const raw = await zernio(connection, target.accountId, "/posts", {
    method: "POST", idempotencyKey: publicationId, body: {
      ...(input.caption.length ? { content: input.caption } : {}),
      mediaItems: [{ type: "video", url: input.videoUrl }],
      scheduledFor: scheduledAt.toISOString(), timezone: "UTC",
      platforms: [{ platform: target.platform, accountId: target.accountId,
        ...(target.platform === "facebook" ? { platformSpecificData: { contentType: "reel", pageId: target.pageId } } : {}) }],
      ...(settings ? { tiktokSettings: {
        privacy_level: settings.privacyLevel, allow_comment: settings.allowComment,
        allow_duet: settings.allowDuet, allow_stitch: settings.allowStitch,
        content_preview_confirmed: settings.contentPreviewConfirmed, express_consent_given: settings.expressConsentGiven,
        commercialContentType: settings.commercialContentType,
      } } : {}),
      metadata: { musaPublicationId: publicationId },
    },
  });
  return readSocialPost(raw, target);
}

export async function getSocialPost(connection: SocialConnection, target: SocialTarget, postId: string) {
  return readSocialPost(await zernio(connection, target.accountId, "/posts/" + postId), target, postId);
}
