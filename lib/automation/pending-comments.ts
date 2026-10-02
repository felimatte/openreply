import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { getDMQueue, type ProcessCommentJob } from "@/lib/queue/client";

export async function deferPendingReelComment(data: ProcessCommentJob): Promise<boolean> {
  const account = data.accountConnectionId
    ? await prisma.instagramAccount.findUnique({ where: { id: data.accountConnectionId }, select: { id: true } })
    : await prisma.instagramAccount.findUnique({ where: { instagramId: data.instagramAccountId }, select: { id: true } });
  if (!account) return false;
  const pending = await prisma.automation.findFirst({ where: { instagramAccountId: account.id, pendingNextReel: true, isActive: true }, select: { id: true } });
  if (!pending) return false;
  if (!data.timestamp || !Number.isFinite(data.timestamp)) return false;
  const originalTime = data.timestamp;
  if (Date.now() - originalTime >= 7 * 86400000) return false;
  await prisma.pendingReelComment.upsert({
    where: { accountId_commentId: { accountId: account.id, commentId: data.commentId } },
    create: { accountId: account.id, commentId: data.commentId, mediaId: data.originalMediaId ?? data.mediaId, payload: JSON.parse(JSON.stringify({ ...data, accountConnectionId: account.id, timestamp: originalTime })) as Prisma.InputJsonValue, expiresAt: new Date(originalTime + 7 * 86400000) },
    update: {},
  });
  return true;
}

export async function replayPendingReelComments(): Promise<number> {
  await prisma.pendingReelComment.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  // Only bound Reels are eligible. Unrelated older comments must not starve
  // comments on the Reel that was just attached to an automation.
  const bound = await prisma.automation.findMany({ where: { postId: { not: null }, pendingNextReel: false, isActive: true }, select: { instagramAccountId: true, postId: true } });
  if (!bound.length) return 0;
  const pending = await prisma.pendingReelComment.findMany({
    where: { OR: bound.map((campaign) => ({ accountId: campaign.instagramAccountId, mediaId: campaign.postId! })) },
    take: 200, orderBy: [{ replayedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
  });
  let enqueued = 0;
  for (const comment of pending) {
    const campaigns = await prisma.automation.findMany({ where: { instagramAccountId: comment.accountId, postId: comment.mediaId, isActive: true, pendingNextReel: false }, select: { id: true } });
    if (!campaigns.length) continue;
    const processed = await prisma.dmLog.findFirst({ where: { commentId: comment.commentId, automationId: { in: campaigns.map((c) => c.id) }, status: "SENT" }, select: { id: true } });
    const run = await prisma.flowRun.findFirst({ where: { commentId: comment.commentId, automationId: { in: campaigns.map((c) => c.id) } }, select: { id: true } });
    if (processed || run) { await prisma.pendingReelComment.delete({ where: { id: comment.id } }); continue; }
    const data = comment.payload as unknown as ProcessCommentJob;
    await getDMQueue().add("process-comment", data, { jobId: `pending_reel_${comment.id}`, removeOnComplete: true, removeOnFail: true });
    await prisma.pendingReelComment.update({ where: { id: comment.id }, data: { replayedAt: new Date() } });
    enqueued++;
  }
  return enqueued;
}
