import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";

// URLs go to the provider; this server never downloads caller-controlled media.
function publicHttps(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password &&
      (!url.port || url.port === "443") && !url.hash && !isIP(host) &&
      host.includes(".") && !host.endsWith(".localhost") &&
      !host.endsWith(".local") && !host.endsWith(".internal");
  } catch { return false; }
}

const mediaUrl = z.string().max(4096).url().refine(publicHttps, "A public HTTPS media URL is required");
export const musaPublicationInputSchema = z.object({
  accountId: z.string().min(1).max(128),
  caption: z.string().max(2200),
  videoUrl: mediaUrl,
  coverUrl: mediaUrl.optional(),
  campaignId: z.string().min(1).max(128).optional(),
}).strict();
export type MusaPublicationInput = z.infer<typeof musaPublicationInputSchema>;

export function publicationPayloadHash(payload: MusaPublicationInput): string {
  return createHash("sha256").update(JSON.stringify({
    accountId: payload.accountId, caption: payload.caption,
    videoUrl: payload.videoUrl, coverUrl: payload.coverUrl ?? null,
    campaignId: payload.campaignId ?? null,
  })).digest("hex");
}

export function isMusaCampaignAttachable(campaign: {
  isActive: boolean; postId: string | null; matchAnyPost: boolean; dmTriggerEnabled: boolean;
}): boolean {
  return !campaign.isActive && !campaign.postId && !campaign.matchAnyPost && !campaign.dmTriggerEnabled;
}
