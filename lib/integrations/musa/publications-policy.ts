import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";

// URLs go to the provider; this server never downloads caller-controlled media.
function publicHttps(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
    return url.protocol === "https:" && !url.username && !url.password &&
      (!url.port || url.port === "443") && !url.hash && !isIP(host) &&
      host.includes(".") && !host.endsWith(".localhost") &&
      !host.endsWith(".local") && !host.endsWith(".internal");
  } catch { return false; }
}

const mediaUrl = z.string().max(4096).url().refine(publicHttps, "A public HTTPS media URL is required");
const publicationOptions = {
  trialReel: z.strictObject({ graduationStrategy: z.enum(["MANUAL", "SS_PERFORMANCE"]) }).optional(),
  flowId: z.string().min(1).max(128).optional(),
  flowRevision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  activateOnPublish: z.literal(true).optional(),
};
const legacyPublicationInputSchema = z.object({
  accountId: z.string().min(1).max(128),
  caption: z.string().max(2200),
  videoUrl: mediaUrl,
  coverUrl: mediaUrl.optional(),
  campaignId: z.string().min(1).max(128).optional(),
  ...publicationOptions,
}).strict();
export const MUSA_PUBLICATION_FORMATS = ["reel", "image", "carousel", "story"] as const;
export type MusaPublicationFormat = typeof MUSA_PUBLICATION_FORMATS[number];
const mediaItem = z.object({
  type: z.enum(["image", "video"]),
  url: z.string().max(2000).url().refine(publicHttps, "A public HTTPS media URL is required"),
}).strict();
export type MusaMediaItem = z.infer<typeof mediaItem>;
const modernPublicationInputSchema = z.object({
  accountId: z.string().min(1).max(128), caption: z.string().max(2200),
  format: z.enum(MUSA_PUBLICATION_FORMATS), mediaItems: z.array(mediaItem).min(1).max(10),
  campaignId: z.string().min(1).max(128).optional(),
  ...publicationOptions,
}).strict().superRefine((input, ctx) => {
  const valid = input.format === "carousel" ? input.mediaItems.length >= 2
    : input.mediaItems.length === 1 && (input.format === "story" || input.mediaItems[0].type === (input.format === "reel" ? "video" : "image"));
  if (!valid) ctx.addIssue({ code: "custom", path: ["mediaItems"], message: "Media must match the selected format" });
  if (input.format === "story" && input.campaignId)
    ctx.addIssue({ code: "custom", path: ["campaignId"], message: "Stories require a versioned flow instead of a comment campaign" });
});
export const musaPublicationInputSchema = z.union([legacyPublicationInputSchema, modernPublicationInputSchema]).superRefine((input, ctx) => {
  const flowFields = [input.flowId, input.flowRevision, input.activateOnPublish].filter(value => value !== undefined).length;
  if (flowFields !== 0 && flowFields !== 3 || flowFields && input.campaignId)
    ctx.addIssue({ code: "custom", message: "Choose one complete flow or one existing campaign" });
  if (input.trialReel && "format" in input && input.format !== "reel")
    ctx.addIssue({ code: "custom", path: ["trialReel"], message: "Trial publishing requires a Reel" });
});
export type MusaPublicationInput = z.infer<typeof musaPublicationInputSchema>;

export const publicationFormat = (input: MusaPublicationInput): MusaPublicationFormat => "format" in input ? input.format : "reel";
export const publicationMedia = (input: MusaPublicationInput): MusaMediaItem[] => "mediaItems" in input
  ? input.mediaItems : [{ type: "video", url: input.videoUrl }];
export const publicationCover = (input: MusaPublicationInput) => "coverUrl" in input ? input.coverUrl : undefined;

export function publicationPayloadHash(payload: MusaPublicationInput): string {
  if (payload.trialReel || payload.flowId) {
    const { trialReel, flowId, flowRevision, activateOnPublish, ...original } = payload;
    return createHash("sha256").update(JSON.stringify({ version: 3, originalHash: publicationPayloadHash(original),
      trialReel: trialReel ?? null, flowId: flowId ?? null, flowRevision: flowRevision ?? null, activateOnPublish: activateOnPublish ?? null,
    })).digest("hex");
  }
  if ("format" in payload) return createHash("sha256").update(JSON.stringify({
    version: 2, accountId: payload.accountId, caption: payload.caption, format: payload.format,
    mediaItems: payload.mediaItems.map(({ type, url }) => ({ type, url })), campaignId: payload.campaignId ?? null,
  })).digest("hex");
  // Keep this legacy serialization byte-for-byte: persisted UUIDs retain their original hash.
  return createHash("sha256").update(JSON.stringify({
    accountId: payload.accountId, caption: payload.caption,
    videoUrl: payload.videoUrl, coverUrl: payload.coverUrl ?? null,
    campaignId: payload.campaignId ?? null,
  })).digest("hex");
}

export function isMusaCampaignAttachable(campaign: {
  id?: string; isActive: boolean; postId: string | null; matchAnyPost: boolean; dmTriggerEnabled: boolean;
}, allowPrivate = false): boolean {
  return (allowPrivate || !campaign.id?.startsWith("musa_flow_")) && !campaign.isActive && !campaign.postId && !campaign.matchAnyPost && !campaign.dmTriggerEnabled;
}
