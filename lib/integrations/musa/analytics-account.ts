import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { analyticsAccountResponse, metric } from "./analytics-contract";
import { AnalyticsReadError, readAnalytics, readState } from "./analytics-transport";
import type { AnalyticsSession } from "./analytics-session";

const insight = z.object({ data: z.array(z.object({ name: z.string(), total_value: z.object({ value: z.number().nullable() }).optional() })) });
const profile = z.object({ id: z.string(), user_id: z.string().optional(), username: z.string(), followers_count: z.number().nullable().optional() });
const zernioProfiles = z.object({ accounts: z.array(z.object({ _id: z.string(), platformUserId: z.string(), username: z.string(), followersCount: z.number().nullable().optional() })) });

export async function readOwnProfile(session: AnalyticsSession) {
  const { context, signal, identity } = session;
  if (context.provider === "META") {
    const result = profile.parse(await readAnalytics(context, "/me", new URLSearchParams({ fields: "id,user_id,username,followers_count" }), signal));
    if ((result.user_id ?? result.id) !== identity.instagramId) throw new AnalyticsReadError("permission_required");
    return { username: result.username, followers: metric(result.followers_count) };
  }
  const result = zernioProfiles.parse(await readAnalytics(context, "/accounts", new URLSearchParams({ platform: "instagram" }), signal));
  const found = result.accounts.find(item => item._id === context.accountId && item.platformUserId === identity.instagramId);
  if (!found) throw new AnalyticsReadError("permission_required");
  return { username: found.username, followers: metric(found.followersCount) };
}

/** Native range aggregates only. Daily or per-publication reach must never be summed. */
export async function readAccountMetric(session: AnalyticsSession, name: "views" | "reach" | "total_interactions") {
  if (session.context.provider !== "META") return metric(null);
  try {
    const query = new URLSearchParams({ metric: name, period: "day", metric_type: "total_value",
      since: String(Math.floor(Date.parse(session.identity.range.from) / 1000)),
      until: String(Math.floor(Date.parse(session.identity.range.to) / 1000)) });
    const result = insight.parse(await readAnalytics(session.context, `/${session.identity.instagramId}/insights`, query, session.signal));
    return metric(result.data.find(item => item.name === name)?.total_value?.value, "insufficient_history");
  } catch (error) { return metric(null, readState(error)); }
}

export async function readAnalyticsAccount(session: AnalyticsSession) {
  let own: Awaited<ReturnType<typeof readOwnProfile>>;
  try { own = await readOwnProfile(session); }
  catch (error) {
    const unavailable = metric(null, readState(error));
    return analyticsAccountResponse.parse({ ...session.identity, username: session.account.username,
      followers: unavailable, metrics: { views: unavailable, reach: unavailable, interactions: unavailable }, metricScope: "account_period", observations: [] });
  }
  const [views, reach, interactions, observations] = await Promise.all([
    readAccountMetric(session, "views"), readAccountMetric(session, "reach"), readAccountMetric(session, "total_interactions"),
    prisma.followerSnapshot.findMany({ where: { instagramAccountId: session.account.id, backfilled: false,
      date: { gte: new Date(session.identity.range.from.slice(0, 10)), lt: new Date(session.identity.range.to.slice(0, 10)) } },
      orderBy: { date: "asc" }, take: 92, select: { date: true, followersCount: true } }),
  ]);
  return analyticsAccountResponse.parse({ ...session.identity, ...own, metrics: { views, reach, interactions }, metricScope: "account_period",
    observations: observations.map(row => ({ date: row.date.toISOString().slice(0, 10), value: row.followersCount,
      observedAt: null, precision: "utc_day", source: "observed" })) });
}
