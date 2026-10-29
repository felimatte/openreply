import { analyticsWithinDeadline } from "@/lib/integrations/musa/analytics-session";
import { readDiscoveryCapability } from "@/lib/integrations/musa/analytics-discovery";
import { readAnalyticsAccount } from "@/lib/integrations/musa/analytics-account";
import { readAnalyticsMedia } from "@/lib/integrations/musa/analytics-media";
import { analyticsCapabilitiesResponse } from "@/lib/integrations/musa/analytics-contract";
import { musaErrorResponse, musaJson } from "@/lib/integrations/musa/errors";

export async function GET(request: Request): Promise<Response> {
  try {
    return musaJson(await analyticsWithinDeadline(request, async session => {
    const [account, media, discovery] = await Promise.all([readAnalyticsAccount(session), readAnalyticsMedia(session), readDiscoveryCapability(session)]);
    return analyticsCapabilitiesResponse.parse({ ...session.identity, discoveryGeneration: discovery.discoveryGeneration, capabilities: {
      accountInsights: account.metrics.views.state, followerObservations: account.followers.state,
      mediaInsights: media.media[0]?.metrics.reach.state ?? (media.state === "available" ? "insufficient_history" : media.state),
      competitorDiscovery: discovery.state,
    } });
    }));
  } catch (error) { return musaErrorResponse(error); }
}
