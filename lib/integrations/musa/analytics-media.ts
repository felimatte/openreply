import { z } from "zod";
import { analyticsMediaResponse, metric } from "./analytics-contract";
import type { AnalyticsMedia, AnalyticsMetric } from "./analytics-contract";
import type { AnalyticsSession } from "./analytics-session";
import { decodeAnalyticsCursor, encodeAnalyticsCursor } from "./analytics-cursor";
import { publicMediaUrl, readAnalytics, readState } from "./analytics-transport";
import { readZernioMedia } from "./analytics-zernio";
import { readOwnProfile } from "./analytics-account";

const child = z.object({ id: z.string(), media_type: z.string(), media_url: z.string().optional(), thumbnail_url: z.string().optional() });
const rawMedia = child.extend({ caption: z.string().optional(), timestamp: z.string(), permalink: z.string().optional(), media_product_type: z.string().optional(),
  like_count: z.number().nullable().optional(), comments_count: z.number().nullable().optional(),
  children: z.object({ data: z.array(child).max(20), paging: z.object({ next: z.string().optional() }).optional() }).optional() });
const page = z.object({ data: z.array(rawMedia).max(5), paging: z.object({ cursors: z.object({ after: z.string().max(2000).optional() }).optional(), next: z.string().optional() }).optional() });
const insights = z.object({ data: z.array(z.object({ name: z.string(), period: z.string().optional(), values: z.array(z.object({ value: z.number().nullable() })).optional() })) });
const fields = "id,caption,media_type,media_product_type,media_url,thumbnail_url,timestamp,permalink,like_count,comments_count,children.limit(20){id,media_type,media_url,thumbnail_url}";

async function lifetimeMetric(session: AnalyticsSession, mediaId: string, name: string): Promise<AnalyticsMetric> {
  try {
    const result = insights.parse(await readAnalytics(session.context, `/${mediaId}/insights`, new URLSearchParams({ metric: name, period: "lifetime" }), session.signal));
    const found = result.data.find(item => item.name === name);
    if (found?.period !== "lifetime" || found.values?.length !== 1) return metric(null);
    return metric(found.values[0].value);
  } catch (error) { return metric(null, readState(error)); }
}

async function normalizeMedia(session: AnalyticsSession, item: z.infer<typeof rawMedia>): Promise<AnalyticsMedia> {
  const [views, reach, saves, shares] = await Promise.all(["views", "reach", "saved", "shares"].map(name => lifetimeMetric(session, item.id, name)));
  const format = item.media_type === "CAROUSEL_ALBUM" ? "carousel" : item.media_type === "VIDEO" ? item.media_product_type === "REELS" ? "reel" : "video" : "image";
  const assets = (format === "carousel" ? item.children?.data ?? [] : [item]).map(asset => ({ id: asset.id,
    type: asset.media_type === "VIDEO" ? "video" as const : "image" as const,
    url: publicMediaUrl(asset.media_url), poster: publicMediaUrl(asset.thumbnail_url ?? (asset.media_type === "IMAGE" ? asset.media_url : null)) }));
  return { id: item.id, caption: (item.caption ?? "").slice(0, 2200), publishedAt: new Date(item.timestamp).toISOString(),
    permalink: publicMediaUrl(item.permalink), format, durationSeconds: null, assets,
    assetsComplete: format !== "carousel" || Boolean(item.children?.data.length && !item.children.paging?.next),
    metrics: { views, reach, saves, shares, likes: metric(item.like_count), comments: metric(item.comments_count) }, metricScope: "lifetime", insightsUpdatedAt: session.identity.observedAt };
}

export async function readAnalyticsMedia(session: AnalyticsSession) {
  const after = decodeAnalyticsCursor(session.identity, session.query.cursor);
  try {
    await readOwnProfile(session);
    if (session.context.provider === "ZERNIO") return readZernioMedia(session, after);
    const query = new URLSearchParams({ fields, limit: "2", ...(after ? { after } : {}) });
    const result = page.parse(await readAnalytics(session.context, `/${session.identity.instagramId}/media`, query, session.signal));
    const from = Date.parse(session.identity.range.from), to = Date.parse(session.identity.range.to);
    const selected = result.data.filter(item => Date.parse(item.timestamp) >= from && Date.parse(item.timestamp) < to);
    const reachedStart = result.data.some(item => Date.parse(item.timestamp) < from);
    const next = !reachedStart && result.paging?.next ? result.paging.cursors?.after : undefined;
    const incomplete = !reachedStart && Boolean(result.paging?.next) && !next;
    const media = await Promise.all(selected.map(item => normalizeMedia(session, item)));
    return analyticsMediaResponse.parse({ ...session.identity, state: incomplete ? "partial" : "available", media,
      nextCursor: next ? encodeAnalyticsCursor(session.identity, next) : null, coverage: next ? "page" : incomplete ? "sample" : "complete" });
  } catch (error) {
    return analyticsMediaResponse.parse({ ...session.identity, state: readState(error), media: [], nextCursor: null, coverage: "unavailable" });
  }
}
