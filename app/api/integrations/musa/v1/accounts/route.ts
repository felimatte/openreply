import { publicMusaAccount, requireMusaConnection } from "@/lib/integrations/musa/auth";
import { musaErrorResponse, musaJson } from "@/lib/integrations/musa/errors";
import { getMusaPublishingCapability } from "@/lib/integrations/musa/publications-capabilities";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const context = await requireMusaConnection(request);
    const includeStory = new URL(request.url).searchParams.get("includeStory") === "1";
    const accounts = await Promise.all(context.accounts.map(async (account) => {
      const { canAttachStoryFlowOnPublish, supportedFormats, ...capability } = await getMusaPublishingCapability(account, includeStory);
      return { ...publicMusaAccount(account), ...capability,
        supportedFormats: includeStory ? supportedFormats : supportedFormats.filter(format => format !== "story"),
        canPublishTrialReels: capability.canPublish, trialUnavailableReason: capability.publishUnavailableReason,
        canAttachFlowOnPublish: true, ...(includeStory ? { canAttachStoryFlowOnPublish } : {}) };
    }));
    return musaJson({ version: 1, accounts });
  } catch (error) { return musaErrorResponse(error); }
}
