import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { MusaIntegrationError } from "./errors";
import { musaPublicMediaUrl } from "./publications-policy";

export const socialId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const zernioId = z.string().regex(/^[0-9a-f]{24}$/);
const facebookPageId = z.string().regex(/^[1-9][0-9]{0,29}$/);
export const socialPlatform = z.enum(["facebook", "tiktok"]);
export type SocialPlatform = z.infer<typeof socialPlatform>;
export const tiktokPrivacy = z.enum(["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]);
export const tiktokCommercialContent = z.enum(["none", "brand_organic", "brand_content"]);
const socialContent = {
  connectionId: socialId,
  accountId: zernioId,
  caption: z.string().max(2200),
  videoUrl: musaPublicMediaUrl,
  scheduledFor: z.iso.datetime({ offset: true }).transform(value => new Date(value).toISOString()),
};
export const socialPublicationInput = z.discriminatedUnion("platform", [
  z.strictObject({ ...socialContent, platform: z.literal("facebook") }),
  z.strictObject({ ...socialContent, platform: z.literal("tiktok"), tiktok: z.strictObject({
    privacyLevel: tiktokPrivacy, allowComment: z.boolean(), allowDuet: z.boolean(), allowStitch: z.boolean(),
    contentPreviewConfirmed: z.literal(true), expressConsentGiven: z.literal(true),
    commercialContentType: tiktokCommercialContent,
  }) }),
]);
export type SocialPublicationInput = z.infer<typeof socialPublicationInput>;

const pilotConfig = z.object({
  MUSA_SOCIAL_BUSINESS_ID: z.uuid(),
  MUSA_SOCIAL_CONNECTION_ID: socialId,
  MUSA_SOCIAL_BRIDGE_TOKEN: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
  MUSA_SOCIAL_PROFILE_ID: zernioId,
  ZERNIO_API_KEY: z.string().min(15).max(512),
  MUSA_SOCIAL_FACEBOOK_ACCOUNT_ID: zernioId.optional(),
  MUSA_SOCIAL_FACEBOOK_PAGE_ID: facebookPageId.optional(),
  MUSA_SOCIAL_TIKTOK_ACCOUNT_ID: zernioId.optional(),
  MUSA_SOCIAL_TIKTOK_PLATFORM_USER_ID: socialId.optional(),
}).refine(env => Boolean(env.MUSA_SOCIAL_FACEBOOK_ACCOUNT_ID) === Boolean(env.MUSA_SOCIAL_FACEBOOK_PAGE_ID)
  && Boolean(env.MUSA_SOCIAL_TIKTOK_ACCOUNT_ID) === Boolean(env.MUSA_SOCIAL_TIKTOK_PLATFORM_USER_ID)
  && Boolean(env.MUSA_SOCIAL_FACEBOOK_ACCOUNT_ID || env.MUSA_SOCIAL_TIKTOK_ACCOUNT_ID)
  && env.MUSA_SOCIAL_FACEBOOK_ACCOUNT_ID !== env.MUSA_SOCIAL_TIKTOK_ACCOUNT_ID);

export type SocialTarget =
  | { platform: "facebook"; accountId: string; pageId: string }
  | { platform: "tiktok"; accountId: string; platformUserId: string };
export type SocialConnection = {
  businessId: string;
  connectionId: string;
  profileId: string;
  apiKey: string;
  targets: SocialTarget[];
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest();
}

export function requireSocialConnection(request: Request, env = process.env): SocialConnection {
  const bearer = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(request.headers.get("authorization") ?? "")?.[1];
  const businessId = request.headers.get("x-musa-business-id");
  const config = pilotConfig.safeParse(Object.fromEntries(Object.keys(pilotConfig.shape).map(key => [key, env[key] || undefined])));
  if (!config.success || !bearer || businessId !== config.data.MUSA_SOCIAL_BUSINESS_ID ||
    !timingSafeEqual(sha256(bearer), sha256(config.data.MUSA_SOCIAL_BRIDGE_TOKEN))) {
    throw new MusaIntegrationError(401, "UNAUTHORIZED", "This social publishing connection is not available to the business.");
  }
  const {
    MUSA_SOCIAL_CONNECTION_ID, MUSA_SOCIAL_PROFILE_ID, ZERNIO_API_KEY,
    MUSA_SOCIAL_FACEBOOK_ACCOUNT_ID, MUSA_SOCIAL_FACEBOOK_PAGE_ID,
    MUSA_SOCIAL_TIKTOK_ACCOUNT_ID, MUSA_SOCIAL_TIKTOK_PLATFORM_USER_ID,
  } = config.data;
  const targets: SocialTarget[] = [];
  if (MUSA_SOCIAL_FACEBOOK_ACCOUNT_ID && MUSA_SOCIAL_FACEBOOK_PAGE_ID) {
    targets.push({ platform: "facebook", accountId: MUSA_SOCIAL_FACEBOOK_ACCOUNT_ID, pageId: MUSA_SOCIAL_FACEBOOK_PAGE_ID });
  }
  if (MUSA_SOCIAL_TIKTOK_ACCOUNT_ID && MUSA_SOCIAL_TIKTOK_PLATFORM_USER_ID) {
    targets.push({ platform: "tiktok", accountId: MUSA_SOCIAL_TIKTOK_ACCOUNT_ID, platformUserId: MUSA_SOCIAL_TIKTOK_PLATFORM_USER_ID });
  }
  return { businessId, connectionId: MUSA_SOCIAL_CONNECTION_ID,
    profileId: MUSA_SOCIAL_PROFILE_ID, apiKey: ZERNIO_API_KEY, targets };
}

export function requireSocialTarget(connection: SocialConnection, platform: SocialPlatform, accountId: string) {
  const target = connection.targets.find(account => account.platform === platform && account.accountId === accountId);
  if (!target) throw new MusaIntegrationError(403, "ACCOUNT_NOT_ALLOWED", "This social account is not granted to the business.");
  return target;
}

export function targetIdentity(target: SocialTarget) {
  return target.platform === "facebook" ? target.pageId : target.platformUserId;
}

export function socialPayloadHash(input: SocialPublicationInput) {
  return sha256(JSON.stringify(input)).toString("hex");
}
