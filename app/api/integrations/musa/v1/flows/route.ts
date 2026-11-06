import { requireMusaAccount, requireMusaConnection } from "@/lib/integrations/musa/auth";
import { musaErrorResponse, musaJson } from "@/lib/integrations/musa/errors";
import { listMusaFlows } from "@/lib/integrations/musa/flows";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const context = await requireMusaConnection(request);
    const account = requireMusaAccount(context, new URL(request.url).searchParams.get("accountId"));
    return musaJson(await listMusaFlows(context, account.id));
  } catch (error) { return musaErrorResponse(error); }
}
