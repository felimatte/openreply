import { z } from "zod";
import { metric } from "./analytics-contract";
import type { AnalyticsIdentity, AnalyticsMedia } from "./analytics-contract";
import { publicMediaUrl } from "./analytics-transport";
import { discoveryAfter, discoveryTargetId, discoveryUsername } from "./discovery-reader-cursor";

const asset = z.object({ id: discoveryTargetId, media_type: z.enum(["IMAGE", "VIDEO", "CAROUSEL_ALBUM"]),
  media_url: z.string().max(8192).nullish(), thumbnail_url: z.string().max(8192).nullish() });
const cursor = z.object({ after: discoveryAfter.optional() });
const paging = z.object({ cursors: cursor.optional(), next: z.string().max(8192).optional() });
export const discoveryRawMedia = asset.extend({ caption: z.string().max(12000).nullish(), timestamp: z.string().max(64)
  .refine(value => Number.isFinite(Date.parse(value))), permalink: z.string().max(8192).nullish(),
  media_product_type: z.string().max(100).nullish(), like_count: z.number().nonnegative().nullish(), comments_count: z.number().nonnegative().nullish(),
  children: z.object({ data: z.array(asset).max(20), paging: paging.optional() }).optional() });
export const discoveryRawTarget = z.object({ id: discoveryTargetId, username: discoveryUsername,
  followers_count: z.number().int().nonnegative().nullish(), media_count: z.number().int().nonnegative().nullish(),
  media: z.object({ data: z.array(discoveryRawMedia).max(5), paging: paging.optional() }).optional() });

export const DISCOVERY_MEDIA_FIELDS = [
  "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,children.limit(20){id,media_type,media_url,thumbnail_url}",
  "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count",
  "id,caption,media_type,permalink,timestamp,like_count,comments_count",
] as const;

/** Public counters only. Missing video/children never become a fabricated asset. */
export function normalizeDiscoveryMedia(item: z.infer<typeof discoveryRawMedia>, identity: AnalyticsIdentity): AnalyticsMedia {
  const format = item.media_type === "CAROUSEL_ALBUM" ? "carousel" : item.media_type === "VIDEO"
    ? item.media_product_type === "REELS" ? "reel" : "video" : "image";
  const assets = (format === "carousel" ? item.children?.data ?? [item] : [item]).map(value => ({ id: value.id,
    type: value.media_type === "VIDEO" ? "video" as const : "image" as const,
    url: publicMediaUrl(value.media_url), poster: publicMediaUrl(value.thumbnail_url ?? (value.media_type !== "VIDEO" ? value.media_url : null)) }));
  return { id: item.id, caption: (item.caption ?? "").slice(0, 2200), publishedAt: new Date(item.timestamp).toISOString(),
    permalink: publicMediaUrl(item.permalink), format, durationSeconds: null, assets,
    assetsComplete: format !== "carousel" || Boolean(item.children?.data.length && !item.children.paging?.next && !item.children.paging?.cursors?.after),
    metrics: { views: metric(null), reach: metric(null), saves: metric(null), shares: metric(null),
      likes: metric(item.like_count), comments: metric(item.comments_count) },
    metricScope: "lifetime", insightsUpdatedAt: identity.observedAt };
}
