import { analyticsWithinDeadline } from "@/lib/integrations/musa/analytics-session";
import { readAnalyticsAccount } from "@/lib/integrations/musa/analytics-account";
import { readAnalyticsMedia } from "@/lib/integrations/musa/analytics-media";
import { analyticsCapabilitiesResponse } from "@/lib/integrations/musa/analytics-contract";
import { musaErrorResponse, musaJson } from "@/lib/integrations/musa/errors";

export async function GET(request: Request): Promise<Response> {
  try {
    return musaJson(await analyticsWithinDeadline(request, async session => {
    const [account, media] = await Promise.all([readAnalyticsAccount(session), readAnalyticsMedia(session)]);
    return analyticsCapabilitiesResponse.parse({ ...session.identity, capabilities: {
      accountInsights: account.metrics.views.state, followerObservations: account.followers.state,
      mediaInsights: media.media[0]?.metrics.reach.state ?? (media.state === "available" ? "insufficient_history" : media.state),
      // Instagram Login does not grant Facebook Login Business Discovery access.
      competitorDiscovery: "permission_required",
    } });
    }));
  } catch (error) { return musaErrorResponse(error); }
}
