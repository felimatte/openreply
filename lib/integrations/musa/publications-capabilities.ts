import { z } from "zod";
import { createInstagramContext, type InstagramContext, type ProviderAccount } from "@/lib/instagram/context";
import { publicationProviderRequest } from "./publications-provider";
import { MUSA_PUBLICATION_FORMATS, type MusaPublicationFormat } from "./publications-policy";

const zernioScopes = z.array(z.object({ scope: z.string(), granted: z.boolean() })).optional().catch(undefined);
const zernioHealth = z.object({
  tokenStatus: z.object({ valid: z.boolean() }),
  permissions: z.object({
    canPost: z.boolean(),
    scopeAreas: z.object({ messaging: z.string().optional() }).optional().catch(undefined),
    required: zernioScopes,
    optional: zernioScopes,
  }),
  messagingRestriction: z.unknown().optional(),
});

async function metaCanReadMessages(context: InstagramContext, instagramId: string) {
  try {
    const raw = await publicationProviderRequest(context,
      `/${encodeURIComponent(instagramId)}/conversations?platform=instagram&fields=id&limit=1`, { timeoutMs: 2000 });
    return z.object({ data: z.array(z.object({ id: z.string().min(1) })) }).safeParse(raw).success;
  } catch { return false; }
}

export async function getMusaPublishingCapability(
  account: ProviderAccount & { tokenExpiresAt?: Date | null; webhookSubscribed?: boolean },
  checkStoryFlow = false,
): Promise<{ canPublish: boolean; publishUnavailableReason: string | null; supportedFormats: MusaPublicationFormat[];
  canAttachStoryFlowOnPublish: boolean }> {
  const unavailable = (publishUnavailableReason: string) => ({
    canPublish: false, publishUnavailableReason, supportedFormats: [], canAttachStoryFlowOnPublish: false,
  });
  if (account.provider === "META" && (!account.accessToken ||
    (account.tokenExpiresAt && account.tokenExpiresAt <= new Date()))) return unavailable("RECONNECT_REQUIRED");
  if (account.provider === "ZERNIO" && !account.zernioAccountId) return unavailable("RECONNECT_REQUIRED");
  try {
    const context = await createInstagramContext(account);
    const checkMessages = checkStoryFlow && account.webhookSubscribed === true;
    let canAttachStoryFlowOnPublish = false;
    if (context.provider === "META") {
      // Instagram Login requires both basic and content_publish for this read-only endpoint.
      const raw = await publicationProviderRequest(context,
        `/${encodeURIComponent(account.instagramId)}/content_publishing_limit?fields=quota_usage,config`, { timeoutMs: 2000 });
      const result = z.object({ data: z.array(z.object({
        quota_usage: z.number().int().nonnegative(),
        config: z.object({ quota_total: z.number().int().nonnegative() }),
      })).min(1) }).safeParse(raw);
      if (!result.success) return unavailable("PERMISSIONS_UNAVAILABLE");
      // Exhausted quota still proves authorization; the publication pipeline checks capacity.
      if (checkMessages) canAttachStoryFlowOnPublish = await metaCanReadMessages(context, account.instagramId);
    } else {
      const raw = await publicationProviderRequest(context, `/accounts/${encodeURIComponent(context.accountId)}/health`, { timeoutMs: 2000 });
      const result = zernioHealth.safeParse(raw);
      if (!result.success) return unavailable("PERMISSIONS_UNAVAILABLE");
      if (!result.data.tokenStatus.valid) return unavailable("RECONNECT_REQUIRED");
      if (!result.data.permissions.canPost) return unavailable("PUBLISH_PERMISSION_REQUIRED");
      const { scopeAreas, required, optional } = result.data.permissions;
      const messagingGranted = scopeAreas?.messaging === "granted" || (scopeAreas?.messaging === undefined &&
        [...(required ?? []), ...(optional ?? [])].some(({ scope, granted }) => granted &&
          ["instagram_manage_messages", "instagram_business_manage_messages"].includes(scope)));
      canAttachStoryFlowOnPublish = checkMessages && !result.data.messagingRestriction && messagingGranted;
    }
    return { canPublish: true, publishUnavailableReason: null, supportedFormats: [...MUSA_PUBLICATION_FORMATS],
      canAttachStoryFlowOnPublish };
  } catch { return unavailable("PERMISSIONS_UNAVAILABLE"); }
}
