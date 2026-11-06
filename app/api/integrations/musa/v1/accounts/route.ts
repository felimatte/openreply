import { publicMusaAccount, requireMusaConnection } from "@/lib/integrations/musa/auth";
import { musaErrorResponse, musaJson } from "@/lib/integrations/musa/errors";
import { getMusaPublishingCapability } from "@/lib/integrations/musa/publications-capabilities";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const context = await requireMusaConnection(request);
    const accounts = await Promise.all(context.accounts.map(async (account) => {
      const capability = await getMusaPublishingCapability(account);
      return { ...publicMusaAccount(account), ...capability, canPublishTrialReels: capability.canPublish,
        trialUnavailableReason: capability.publishUnavailableReason, canAttachFlowOnPublish: true };
    }));
    return musaJson({ version: 1, accounts });
  } catch (error) { return musaErrorResponse(error); }
}
