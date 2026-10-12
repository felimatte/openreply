import { prisma } from "@/lib/db/client";

export async function isCampaignReservedForMusaPublication(campaignId: string, workspaceId: string) {
  return Boolean(await prisma.musaPublication.findFirst({ where: {
    campaignId, workspaceId, status: { in: ["processing", "uncertain"] },
  }, select: { id: true } }));
}
