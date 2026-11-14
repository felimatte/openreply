import { MusaIntegrationError, musaErrorResponse, musaJson } from "@/lib/integrations/musa/errors";
import { requireSocialConnection, zernioId } from "@/lib/integrations/musa/social-policy";
import { getSocialCreatorInfo, handleSocialReadError } from "@/lib/integrations/musa/social-zernio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(request: Request, context: { params: Promise<{ accountId: string }> }) {
  try {
    const connection = requireSocialConnection(request);
    const accountId = zernioId.safeParse((await context.params).accountId);
    if (!accountId.success) throw new MusaIntegrationError(400, "INVALID_ACCOUNT_ID", "A valid account ID is required.");
    return musaJson(await getSocialCreatorInfo(connection, accountId.data));
  } catch (error) {
    return musaErrorResponse(handleSocialReadError(error));
  }
}
