import { analyticsWithinDeadline } from "@/lib/integrations/musa/analytics-session";
import { readAnalyticsAccount } from "@/lib/integrations/musa/analytics-account";
import { musaErrorResponse, musaJson } from "@/lib/integrations/musa/errors";

export async function GET(request: Request): Promise<Response> {
  try { return musaJson(await analyticsWithinDeadline(request, readAnalyticsAccount)); }
  catch (error) { return musaErrorResponse(error); }
}
