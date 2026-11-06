import { prisma } from "@/lib/db/client";

export async function isCampaignReservedForMusaPublication(campaignId: string, workspaceId: string) {
  return Boolean(await prisma.musaPublication.findFirst({ where: {
    workspaceId, AND: [{ OR: [{ campaignId }, { flowCampaignIds: { has: campaignId } }] }], OR: [
      { status: { in: ["processing", "uncertain"] } },
      { status: "published", mediaId: null },
    ],
  }, select: { id: true } }));
}
