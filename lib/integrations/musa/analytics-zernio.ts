import { z } from "zod";
import type { AnalyticsSession } from "./analytics-session";
import { analyticsMediaResponse, metric } from "./analytics-contract";
import type { AnalyticsMedia } from "./analytics-contract";
import { publicMediaUrl, readAnalytics, readState } from "./analytics-transport";
import { encodeAnalyticsCursor } from "./analytics-cursor";

const posts = z.object({ posts: z.array(z.object({ id: z.string(), message: z.string().optional(), createdTime: z.string(), picture: z.string().optional(),
  permalink: z.string().optional(), mediaType: z.string(), likeCount: z.number().nullable().optional(), commentCount: z.number().nullable().optional() })).max(1000) });
const analytics = z.object({ platformAnalytics: z.array(z.object({ platformPostId: z.string(), accountId: z.string(),
  analytics: z.record(z.string(), z.unknown()).optional() })).optional() });

async function normalize(session: AnalyticsSession, post: z.infer<typeof posts>["posts"][number]): Promise<AnalyticsMedia> {
  const unavailable = { views: metric(null), reach: metric(null), saves: metric(null), shares: metric(null) };
  let metrics = unavailable;
  let insightsUpdatedAt: string | null = null;
  if (session.context.provider === "ZERNIO") {
    try {
      const query = new URLSearchParams({ postId: post.id, accountId: session.context.accountId, platform: "instagram" });
      const result = analytics.parse(await readAnalytics(session.context, "/analytics", query, session.signal));
      // Match both IDs: other platform/account rows must never enter this business.
      const accountId = session.context.accountId;
      const own = result.platformAnalytics?.find(item => item.platformPostId === post.id && item.accountId === accountId)?.analytics;
      if (typeof own?.lastUpdated === "string" && Number.isFinite(Date.parse(own.lastUpdated))) insightsUpdatedAt = new Date(own.lastUpdated).toISOString();
      metrics = insightsUpdatedAt && own ? { views: metric(own.views), reach: metric(own.reach), saves: metric(own.saves), shares: metric(own.shares) }
        : { views: metric(null, "insufficient_history"), reach: metric(null, "insufficient_history"), saves: metric(null, "insufficient_history"), shares: metric(null, "insufficient_history") };
    } catch (error) { metrics = { views: metric(null, readState(error)), reach: metric(null, readState(error)), saves: metric(null, readState(error)), shares: metric(null, readState(error)) }; }
  }
  const format = post.mediaType === "carousel" ? "carousel" : post.mediaType === "video" ? /\/reel\//.test(post.permalink ?? "") ? "reel" : "video" : "image";
  return { id: post.id, caption: (post.message ?? "").slice(0, 2200), publishedAt: new Date(post.createdTime).toISOString(),
    permalink: publicMediaUrl(post.permalink), format, durationSeconds: null, assetsComplete: format === "image",
    assets: [{ id: post.id, type: format === "video" || format === "reel" ? "video" : "image", url: format === "image" ? publicMediaUrl(post.picture) : null, poster: publicMediaUrl(post.picture) }],
    metrics: { ...metrics, likes: metric(post.likeCount), comments: metric(post.commentCount) }, metricScope: "lifetime", insightsUpdatedAt };
}

/** The provider exposes a recent sample here; never label it complete history. */
export async function readZernioMedia(session: AnalyticsSession, after?: string) {
  try {
    if (session.context.provider !== "ZERNIO") throw new Error();
    const result = posts.parse(await readAnalytics(session.context, `/accounts/${session.context.accountId}/posts`, new URLSearchParams(), session.signal));
    const eligible = result.posts.filter(post => Date.parse(post.createdTime) >= Date.parse(session.identity.range.from) && Date.parse(post.createdTime) < Date.parse(session.identity.range.to));
    const offset = after ? Number(after) : 0;
    if (!Number.isInteger(offset) || offset < 0 || offset > 1000) throw new Error();
    const media = await Promise.all(eligible.slice(offset, offset + 2).map(post => normalize(session, post)));
    return analyticsMediaResponse.parse({ ...session.identity, state: "partial", media, coverage: "sample",
      nextCursor: offset + 2 < eligible.length ? encodeAnalyticsCursor(session.identity, String(offset + 2)) : null });
  } catch (error) { return analyticsMediaResponse.parse({ ...session.identity, state: readState(error), media: [], coverage: "unavailable", nextCursor: null }); }
}
