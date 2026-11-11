import type { Prisma } from "@/app/generated/prisma/client";
import { trackContact } from "@/lib/contacts/store";
import { prisma } from "@/lib/db/client";
import { startFlowRun } from "@/lib/flows/engine";
import { messagingWindowOpen } from "@/lib/flows/runtime-values";
import type { ProcessMessageJob } from "@/lib/queue/client";
import { matchKeywords } from "@/lib/utils/keyword-matcher";

const PENDING_STAGES = ["META_PUBLISHING", "ZERNIO_PROCESSING", "FINALIZE"];
const STORY_PUBLICATION: Prisma.MusaPublicationWhereInput = {
  campaignId: { not: null },
  payload: { path: ["format"], equals: "story" },
};

export async function routeMusaStoryReply(data: ProcessMessageJob, retryUntil: Date): Promise<"handled" | "unmatched" | "pending"> {
  const { accountConnectionId, instagramAccountId, storyId, storyWorkspaceId, timestamp } = data;
  if (!accountConnectionId || !storyId || !storyWorkspaceId || !timestamp || !messagingWindowOpen(new Date(timestamp))) return "unmatched";
  const scope = { ...STORY_PUBLICATION, accountId: accountConnectionId, workspaceId: storyWorkspaceId };
  const publication = await prisma.musaPublication.findFirst({
    where: { ...scope, mediaId: storyId, status: "published", errorCode: null },
    select: { campaignId: true, workspaceId: true },
  });
  if (!publication?.campaignId) return canAwaitStory(scope, storyId, timestamp, retryUntil);

  const campaign = await prisma.automation.findFirst({
    where: { id: publication.campaignId, workspaceId: publication.workspaceId, instagramAccountId: accountConnectionId,
      instagramAccount: { instagramId: instagramAccountId }, isActive: true, flowEnabled: true, postId: null,
      matchAnyPost: false, dmTriggerEnabled: false },
    select: { id: true, workspaceId: true, flowPublishedVersionId: true, contactTags: true,
      keywords: true, matchAnyWord: true, wholeWordMatch: true, excludedKeywords: true },
  });
  if (!campaign?.flowPublishedVersionId) return "unmatched";
  const matches = (keywords: string[]) => matchKeywords(data.messageText, keywords, campaign.wholeWordMatch).matched;
  if (!(campaign.matchAnyWord || matches(campaign.keywords)) || matches(campaign.excludedKeywords)) return "unmatched";

  const contact = await trackContact({ workspaceId: campaign.workspaceId, igAccountId: instagramAccountId, igsid: data.senderId,
    inbound: true, inboundAt: timestamp, automationId: campaign.id, tags: campaign.contactTags });
  if (!contact) throw new Error("Story reply contact could not be saved");
  await startFlowRun({ automationId: campaign.id, versionId: campaign.flowPublishedVersionId, instagramAccountId: accountConnectionId,
    contactId: contact.id, commentId: `story:${data.messageId}`, commentText: data.messageText, commenterId: data.senderId,
    commenterName: contact.username ?? undefined, mediaId: storyId, timestamp, conversationOpen: true,
    inboundEvent: { instagramId: instagramAccountId, messageId: data.messageId } });
  return "handled";
}

async function canAwaitStory(scope: Prisma.MusaPublicationWhereInput, storyId: string, timestamp: number, retryUntil: Date): Promise<"unmatched" | "pending"> {
  if (retryUntil <= new Date()) return "unmatched";
  const pending = await prisma.musaPublication.findFirst({
    where: { ...scope, status: "processing",
      stage: { in: PENDING_STAGES }, attemptStartedAt: { lte: new Date(timestamp) },
      OR: [{ mediaId: null }, { mediaId: storyId }] },
    select: { id: true },
  });
  return pending ? "pending" : "unmatched";
}
