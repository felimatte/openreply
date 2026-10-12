import { exchangeMusaPairingCode } from "@/lib/integrations/musa/pairing";
import { MusaIntegrationError, musaErrorResponse, musaJson } from "@/lib/integrations/musa/errors";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => { throw new MusaIntegrationError(400, "INVALID_JSON", "A JSON request body is required."); });
    const businessHeader = request.headers.get("x-musa-business-id");
    if (!businessHeader || businessHeader !== body?.businessId) throw new MusaIntegrationError(400, "BUSINESS_MISMATCH", "The business ID must match the request header.");
    return musaJson(await exchangeMusaPairingCode(body));
  } catch (error) { return musaErrorResponse(error); }
}
