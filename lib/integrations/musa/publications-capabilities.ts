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
      const raw = await publicationProviderRequest(context, "/me/permissions", { timeoutMs: 2000 });
      const result = z.object({ data: z.array(z.object({ permission: z.string(), status: z.string() })) }).safeParse(raw);
      if (!result.success) return unavailable("PERMISSIONS_UNAVAILABLE");
      const granted = new Set(result.data.data.filter((p) => p.status === "granted").map((p) => p.permission));
      if (!granted.has("instagram_business_content_publish") || !granted.has("instagram_business_basic"))
        return unavailable("PUBLISH_PERMISSION_REQUIRED");
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
