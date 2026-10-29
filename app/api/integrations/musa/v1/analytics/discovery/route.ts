import { analyticsWithinDeadline } from "@/lib/integrations/musa/analytics-session";
import { discoveryInput, readAnalyticsDiscovery } from "@/lib/integrations/musa/analytics-discovery";
import { MusaIntegrationError, musaErrorResponse, musaJson } from "@/lib/integrations/musa/errors";

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const input = discoveryInput.safeParse({ username: params.get("username"), ...(params.has("targetId") ? { targetId: params.get("targetId") } : {}) });
    if (!input.success) throw new MusaIntegrationError(400, "INVALID_PROFILE", "Enter an Instagram username.");
    return musaJson(await analyticsWithinDeadline(request, session => readAnalyticsDiscovery(session, input.data)));
  } catch (error) { return musaErrorResponse(error); }
}
