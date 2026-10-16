import { z } from "zod";
import { createInstagramContext, type ProviderAccount } from "@/lib/instagram/context";
import { publicationProviderRequest } from "./publications-provider";

export async function getMusaPublishingCapability(account: ProviderAccount & { tokenExpiresAt?: Date | null }):
Promise<{ canPublish: boolean; publishUnavailableReason: string | null }> {
  const unavailable = (publishUnavailableReason: string) => ({ canPublish: false, publishUnavailableReason });
  if (account.provider === "META" && (!account.accessToken ||
    (account.tokenExpiresAt && account.tokenExpiresAt <= new Date()))) return unavailable("RECONNECT_REQUIRED");
  if (account.provider === "ZERNIO" && !account.zernioAccountId) return unavailable("RECONNECT_REQUIRED");
  try {
    const context = await createInstagramContext(account);
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
    } else {
      const raw = await publicationProviderRequest(context, `/accounts/${encodeURIComponent(context.accountId)}/health`, { timeoutMs: 2000 });
      const result = z.object({ tokenStatus: z.object({ valid: z.boolean() }), permissions: z.object({ canPost: z.boolean() }) }).safeParse(raw);
      if (!result.success) return unavailable("PERMISSIONS_UNAVAILABLE");
      if (!result.data.tokenStatus.valid) return unavailable("RECONNECT_REQUIRED");
      if (!result.data.permissions.canPost) return unavailable("PUBLISH_PERMISSION_REQUIRED");
    }
    return { canPublish: true, publishUnavailableReason: null };
  } catch { return unavailable("PERMISSIONS_UNAVAILABLE"); }
}
