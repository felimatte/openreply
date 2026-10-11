import { prisma } from "@/lib/db/client";
import { requireMusaAccount, requireMusaConnection } from "@/lib/integrations/musa/auth";
import { musaErrorResponse, musaJson } from "@/lib/integrations/musa/errors";
import { isMusaCampaignAttachable } from "@/lib/integrations/musa/publications-policy";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const context = await requireMusaConnection(request);
    const account = requireMusaAccount(context, new URL(request.url).searchParams.get("accountId"));
    const campaigns = await prisma.automation.findMany({
      where: { workspaceId: context.workspaceId, instagramAccountId: account.id },
      select: { id: true, name: true, isActive: true, postId: true, pendingNextReel: true, matchAnyPost: true, dmTriggerEnabled: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    const reservations = await prisma.musaPublication.findMany({
      where: { workspaceId: context.workspaceId, accountId: account.id, campaignId: { in: campaigns.map((campaign) => campaign.id) } },
      select: { campaignId: true },
    });
    const reservedIds = new Set(reservations.map((publication) => publication.campaignId));
    return musaJson({ version: 1, campaigns: campaigns.map((campaign) => ({
      id: campaign.id, name: campaign.name,
      status: campaign.isActive ? (campaign.pendingNextReel ? "waiting_for_reel" : "active") : "paused",
      instagramMediaId: campaign.postId,
      canAttach: isMusaCampaignAttachable(campaign) && !reservedIds.has(campaign.id),
    })) });
  } catch (error) { return musaErrorResponse(error); }
}
