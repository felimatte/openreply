import { z } from "zod";
import { analyticsDiscoveryResponse, metric } from "./analytics-contract";
import type { AnalyticsDiscoveryResponse, AnalyticsState } from "./analytics-contract";
import type { AnalyticsSession } from "./analytics-session";
import { AnalyticsReadError, readFacebookAnalytics, readState } from "./analytics-transport";
import { loadDiscoveryGrant, verifyDiscoveryProvider, confirmDiscoveryGrant } from "./discovery-reader-grant";
import type { DiscoveryReaderGrant } from "./discovery-reader-grant";
import { discoveryUsername, discoveryTargetId, decodeDiscoveryCursor, encodeDiscoveryCursor } from "./discovery-reader-cursor";
import { discoveryRawTarget, DISCOVERY_MEDIA_FIELDS, normalizeDiscoveryMedia } from "./discovery-reader-media";
import { MusaIntegrationError } from "./errors";

export const discoveryInput = z.object({ username: discoveryUsername, targetId: discoveryTargetId.optional() });
export type DiscoveryInput = z.infer<typeof discoveryInput>;
const response = z.object({ business_discovery: discoveryRawTarget.optional() });

async function readPage(session: AnalyticsSession, grant: DiscoveryReaderGrant, username: string, after?: string) {
  for (const fields of DISCOVERY_MEDIA_FIELDS) {
    try {
      const expand = `business_discovery.username(${username}){id,username,followers_count,media_count,media.limit(5)${after ? `.after(${after})` : ""}{${fields}}}`;
      return response.parse(await readFacebookAnalytics(session.context, grant.token, `/${grant.facebookInstagramId}`,
        new URLSearchParams({ fields: expand }), session.signal)).business_discovery;
    } catch (error) {
      // Some public media fields are unavailable for a target. Keep a bounded,
      // explicit fallback; permission errors and quota waits must not be retried.
      if (!(error instanceof AnalyticsReadError) || error.state !== "unsupported" || fields === DISCOVERY_MEDIA_FIELDS.at(-1)) throw error;
    }
  }
}

function unavailable(session: AnalyticsSession, state: AnalyticsState): AnalyticsDiscoveryResponse {
  return analyticsDiscoveryResponse.parse({ ...session.identity, state, target: null, media: [],
    nextCursor: null, coverage: "unavailable", discoveryGeneration: null });
}

export async function readAnalyticsDiscovery(session: AnalyticsSession, input: DiscoveryInput): Promise<AnalyticsDiscoveryResponse> {
  try {
    const grant = await loadDiscoveryGrant(session), scope = { identity: session.identity, username: input.username, generation: grant.generation };
    const cursor = decodeDiscoveryCursor(scope, session.query.cursor, input.targetId);
    await verifyDiscoveryProvider(session, grant);
    const target = await readPage(session, grant, input.username, cursor?.after);
    const expectedId = input.targetId ?? cursor?.targetId;
    if (!target || target.username !== input.username || expectedId && target.id !== expectedId) throw new AnalyticsReadError("unsupported");
    if (!target.media) throw new AnalyticsReadError("temporarily_unavailable");
    const after = target.media.paging?.cursors?.after;
    const stuck = Boolean(after && after === cursor?.after);
    const incomplete = stuck || Boolean(target.media.paging?.next && !after) || (!after && target.media.data.length > 0);
    const next = !incomplete ? after : undefined;
    const media = target.media.data.filter(item => Date.parse(item.timestamp) >= Date.parse(session.identity.range.from)
      && Date.parse(item.timestamp) < Date.parse(session.identity.range.to)).map(item => normalizeDiscoveryMedia(item, session.identity));
    await confirmDiscoveryGrant(session, grant);
    return analyticsDiscoveryResponse.parse({ ...session.identity, state: incomplete ? "partial" : "available",
      target: { instagramId: target.id, username: target.username, followers: metric(target.followers_count), mediaCount: metric(target.media_count) },
      media, nextCursor: next ? encodeDiscoveryCursor(scope, next, target.id) : null,
      coverage: next ? "page" : incomplete ? "sample" : "complete", discoveryGeneration: grant.generation });
  } catch (error) {
    if (error instanceof MusaIntegrationError && error.code === "INVALID_CURSOR") throw error;
    return unavailable(session, readState(error));
  }
}

/** Consent alone is insufficient: probe the real Discovery field with this account. */
export async function readDiscoveryCapability(session: AnalyticsSession): Promise<{ state: AnalyticsState; discoveryGeneration: string | null }> {
  try {
    const grant = await loadDiscoveryGrant(session), username = discoveryUsername.parse(session.account.username);
    await verifyDiscoveryProvider(session, grant);
    const raw = response.parse(await readFacebookAnalytics(session.context, grant.token, `/${grant.facebookInstagramId}`,
      new URLSearchParams({ fields: `business_discovery.username(${username}){id,username}` }), session.signal));
    if (raw.business_discovery?.id !== grant.facebookInstagramId || raw.business_discovery.username !== username)
      return { state: "pending_validation", discoveryGeneration: null };
    await confirmDiscoveryGrant(session, grant);
    return { state: "available", discoveryGeneration: grant.generation };
  } catch (error) {
    const state = readState(error);
    return { state: state === "unsupported" && session.account.provider === "META" ? "pending_validation" : state, discoveryGeneration: null };
  }
}
