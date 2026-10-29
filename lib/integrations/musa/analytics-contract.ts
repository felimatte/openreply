import { z } from "zod";

export const analyticsState = z.enum(["available", "unsupported", "permission_required", "insufficient_history", "partial", "temporarily_unavailable", "pending_validation"]);
export type AnalyticsState = z.infer<typeof analyticsState>;
export const analyticsMetric = z.object({ value: z.number().nonnegative().nullable(), state: analyticsState })
  .refine(m => m.value === null ? m.state !== "available" : m.state === "available" || m.state === "partial", "Inconsistent metric");
export type AnalyticsMetric = z.infer<typeof analyticsMetric>;
const externalId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const instant = z.iso.datetime({ offset: true });
export const analyticsRange = z.object({ from: instant, to: instant, timezone: z.string().min(1).max(64) });
export const analyticsQuery = analyticsRange.extend({ accountId: externalId, cursor: z.string().max(4096).optional() })
  .refine(({ from, to }) => Date.parse(to) > Date.parse(from) && Date.parse(to) - Date.parse(from) <= 91 * 86400000, "Invalid range")
  .refine(({ timezone }) => { try { new Intl.DateTimeFormat("en", { timeZone: timezone }); return true; } catch { return false; } }, "Invalid timezone");
export type AnalyticsQuery = z.infer<typeof analyticsQuery>;
export const analyticsIdentity = z.object({
  version: z.literal(1), connectionId: externalId, generation: z.string().regex(/^[a-f0-9]{64}$/),
  accountId: externalId, instagramId: externalId, provider: z.enum(["META", "ZERNIO"]),
  apiVersion: z.string().max(32), observedAt: instant, range: analyticsRange,
});
export type AnalyticsIdentity = z.infer<typeof analyticsIdentity>;
const mediaUrl = z.string().url().max(4000).refine(value => { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; });
export const analyticsAsset = z.object({ id: externalId, type: z.enum(["image", "video"]), url: mediaUrl.nullable(), poster: mediaUrl.nullable() });
export const analyticsMedia = z.object({
  id: externalId, caption: z.string().max(2200), publishedAt: instant, permalink: mediaUrl.nullable(),
  format: z.enum(["reel", "video", "image", "carousel"]), durationSeconds: z.number().nonnegative().nullable(),
  assets: z.array(analyticsAsset).max(20), assetsComplete: z.boolean(),
  metrics: z.object({ views: analyticsMetric, reach: analyticsMetric, likes: analyticsMetric, comments: analyticsMetric, saves: analyticsMetric, shares: analyticsMetric }),
  metricScope: z.literal("lifetime"),
  insightsUpdatedAt: instant.nullable(),
});
export type AnalyticsMedia = z.infer<typeof analyticsMedia>;
export const analyticsMediaResponse = analyticsIdentity.extend({
  state: analyticsState, media: z.array(analyticsMedia).max(5), nextCursor: z.string().max(4096).nullable(),
  coverage: z.enum(["complete", "page", "sample", "unavailable"]),
});
export const analyticsAccountResponse = analyticsIdentity.extend({
  username: z.string().max(100), followers: analyticsMetric,
  metrics: z.object({ views: analyticsMetric, reach: analyticsMetric, interactions: analyticsMetric }),
  metricScope: z.literal("account_period"),
  observations: z.array(z.object({ date: z.iso.date(), value: z.number().int().nonnegative(), observedAt: instant.nullable(), precision: z.literal("utc_day"), source: z.literal("observed") })).max(92),
});
export const analyticsCapabilitiesResponse = analyticsIdentity.extend({
  discoveryGeneration: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
  capabilities: z.object({ accountInsights: analyticsState, mediaInsights: analyticsState, followerObservations: analyticsState, competitorDiscovery: analyticsState }),
});
export const analyticsDiscoveryTarget = z.object({
  instagramId: externalId, username: z.string().regex(/^[a-zA-Z0-9._]{1,30}$/),
  followers: analyticsMetric, mediaCount: analyticsMetric,
});
export const analyticsDiscoveryResponse = analyticsIdentity.extend({
  state: analyticsState, target: analyticsDiscoveryTarget.nullable(), media: z.array(analyticsMedia).max(5),
  nextCursor: z.string().max(4096).nullable(), coverage: z.enum(["complete", "page", "sample", "unavailable"]),
  discoveryGeneration: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
});
export type AnalyticsDiscoveryResponse = z.infer<typeof analyticsDiscoveryResponse>;
export function metric(value: unknown, fallback: AnalyticsState = "unsupported"): AnalyticsMetric {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? { value, state: "available" } : { value: null, state: fallback };
}
