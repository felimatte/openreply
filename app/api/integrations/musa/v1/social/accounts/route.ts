import { musaErrorResponse, musaJson } from "@/lib/integrations/musa/errors";
import { requireSocialConnection } from "@/lib/integrations/musa/social-policy";
import { handleSocialReadError, listSocialAccounts } from "@/lib/integrations/musa/social-zernio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(request: Request) {
  try {
    return musaJson(await listSocialAccounts(requireSocialConnection(request)));
  } catch (error) {
    return musaErrorResponse(handleSocialReadError(error));
  }
}
