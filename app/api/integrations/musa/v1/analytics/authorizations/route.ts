import { issueDiscoveryTicket } from "@/lib/integrations/musa/discovery-authorization";
import { MusaIntegrationError, musaErrorResponse, musaJson } from "@/lib/integrations/musa/errors";

export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  try {
    const text = await request.text();
    if (text.length > 4096) throw new MusaIntegrationError(400, "INVALID_REQUEST", "Select a valid account.");
    return musaJson(await issueDiscoveryTicket(request, JSON.parse(text) as unknown), 201);
  } catch (error) { return musaErrorResponse(error); }
}
