import { musaReadWithinDeadline } from "@/lib/integrations/musa/analytics-session";
import { readDiscoveryStatus } from "@/lib/integrations/musa/discovery-status";
import { musaErrorResponse, musaJson } from "@/lib/integrations/musa/errors";

export async function GET(request: Request): Promise<Response> {
  try { return musaJson(await musaReadWithinDeadline(request, readDiscoveryStatus)); }
  catch (error) { return musaErrorResponse(error); }
}
