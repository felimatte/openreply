import { analyticsWithinDeadline } from "@/lib/integrations/musa/analytics-session";
import { readAnalyticsMedia } from "@/lib/integrations/musa/analytics-media";
import { musaErrorResponse, musaJson } from "@/lib/integrations/musa/errors";

export async function GET(request: Request): Promise<Response> {
  try { return musaJson(await analyticsWithinDeadline(request, readAnalyticsMedia)); }
  catch (error) { return musaErrorResponse(error); }
}
