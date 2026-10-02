import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProcessCommentJob } from "@/lib/queue/client";

const mocks = vi.hoisted(() => ({
  automation: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  account: { findUnique: vi.fn() },
  pending: { upsert: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn(), delete: vi.fn(), update: vi.fn() },
  dmLog: { findFirst: vi.fn() },
  run: { findFirst: vi.fn() },
  credentials: vi.fn(), context: vi.fn(), media: vi.fn(), enqueue: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ prisma: { automation: mocks.automation, instagramAccount: mocks.account, pendingReelComment: mocks.pending, dmLog: mocks.dmLog, flowRun: mocks.run } }));
vi.mock("@/lib/instagram/provider", () => ({ createInstagramContext: mocks.context, hasInstagramCredentials: mocks.credentials, getAllUserMedia: mocks.media }));
vi.mock("@/lib/queue/client", () => ({ getDMQueue: () => ({ add: mocks.enqueue }) }));
import { attachPendingNextReels } from "@/lib/automation/attach-next-reel";
import { deferPendingReelComment, replayPendingReelComments } from "@/lib/automation/pending-comments";

const now = new Date("2026-10-01T16:00:00.000Z");
const account = { id: "connection_a", instagramId: "instagram_a", provider: "META" };
const campaign = {
  id: "campaign_a", instagramAccountId: account.id, instagramAccount: account,
  createdAt: new Date("2026-09-01T12:00:00Z"), nextReelArmedAt: new Date("2026-10-01T12:00:00Z"),
  pendingNextReel: true, isActive: true,
};
const comment: ProcessCommentJob = {
  accountConnectionId: account.id, instagramAccountId: account.instagramId,
  commentId: "comment_a", commenterId: "person_a", commentText: "GUÍA", mediaId: "reel_a",
  timestamp: now.getTime() - 60_000, source: "WEBHOOK",
};
const deferred = { id: "deferred_a", accountId: account.id, commentId: comment.commentId, mediaId: comment.mediaId, payload: comment, createdAt: now, expiresAt: new Date(now.getTime() + 86400000), replayedAt: null };
const reel = (id: string, timestamp: string, product = "REELS") => ({ id, timestamp, media_product_type: product, permalink: `https://www.instagram.com/reel/${id}/` });

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers(); vi.setSystemTime(now);
  mocks.credentials.mockReturnValue(true);
  mocks.context.mockResolvedValue({ provider: "META", accessToken: "not-used" });
  mocks.automation.findMany.mockResolvedValue([campaign]);
  mocks.automation.findFirst.mockResolvedValue({ id: campaign.id });
  mocks.automation.updateMany.mockResolvedValue({ count: 1 });
  mocks.account.findUnique.mockResolvedValue({ id: account.id });
  mocks.media.mockResolvedValue([]);
  mocks.pending.findMany.mockResolvedValue([deferred]);
  mocks.dmLog.findFirst.mockResolvedValue(null);
  mocks.run.findFirst.mockResolvedValue(null);
  mocks.enqueue.mockResolvedValue({ id: "job" });
});
afterEach(() => vi.useRealTimers());

describe("next Reel publication binding", () => {
  it("uses the arming date rather than the draft creation date and chooses the earliest later Reel", async () => {
    mocks.media.mockResolvedValue([
      reel("later", "2026-10-01T14:00:00Z"),
      reel("draft-era", "2026-09-15T15:00:00Z"),
      reel("equal-to-arm", "2026-10-01T12:00:00Z"),
      reel("photo", "2026-10-01T12:01:00Z", "FEED"),
      reel("first", "2026-10-01T12:05:00Z"),
    ]);
    expect(await attachPendingNextReels()).toEqual({ checked: 1, bound: 1, failedAccounts: 0 });
    expect(mocks.automation.updateMany).toHaveBeenCalledWith({
      where: { id: campaign.id, pendingNextReel: true, isActive: true, nextReelArmedAt: campaign.nextReelArmedAt },
      data: { postId: "first", postUrl: "https://www.instagram.com/reel/first/", pendingNextReel: false },
    });
  });
  it("does not bind an already published Reel or a photo", async () => {
    mocks.media.mockResolvedValue([reel("old", "2026-10-01T11:59:59Z"), reel("photo", "2026-10-01T12:05:00Z", "FEED")]);
    expect((await attachPendingNextReels()).bound).toBe(0);
    expect(mocks.automation.updateMany).not.toHaveBeenCalled();
  });
  it("preserves legacy waiting campaigns without an arming timestamp", async () => {
    mocks.automation.findMany.mockResolvedValue([{ ...campaign, nextReelArmedAt: null }]);
    mocks.media.mockResolvedValue([reel("legacy-first", "2026-09-01T12:01:00Z"), reel("later", "2026-09-02T12:00:00Z")]);
    await attachPendingNextReels();
    expect(mocks.automation.updateMany.mock.calls[0][0]).toMatchObject({ where: { nextReelArmedAt: null }, data: { postId: "legacy-first" } });
  });
  it("fetches a shared account once while honoring each campaign's arming date", async () => {
    mocks.automation.findMany.mockResolvedValue([campaign, { ...campaign, id: "campaign_b", nextReelArmedAt: new Date("2026-10-01T13:00:00Z") }]);
    mocks.media.mockResolvedValue([reel("first", "2026-10-01T12:05:00Z"), reel("second", "2026-10-01T13:05:00Z")]);
    expect((await attachPendingNextReels({ accountConnectionId: account.id })).bound).toBe(2);
    expect(mocks.media).toHaveBeenCalledTimes(1);
    expect(mocks.automation.findMany.mock.calls[0][0].where.instagramAccountId).toBe(account.id);
    expect(mocks.automation.updateMany.mock.calls.map(([query]) => query.data.postId)).toEqual(["first", "second"]);
  });
  it("cannot overwrite a campaign that was rearmed during the media fetch", async () => {
    mocks.media.mockResolvedValue([reel("old-selection", "2026-10-01T12:05:00Z")]);
    mocks.automation.updateMany.mockResolvedValue({ count: 0 });
    expect((await attachPendingNextReels()).bound).toBe(0);
    expect(mocks.automation.updateMany.mock.calls[0][0].where.nextReelArmedAt).toEqual(campaign.nextReelArmedAt);
  });
  it("two concurrent checks only bind the campaign once", async () => {
    mocks.media.mockResolvedValue([reel("first", "2026-10-01T12:05:00Z")]);
    let isPending = true;
    mocks.automation.updateMany.mockImplementation(async ({ where }) => {
      const canBind = isPending && where.pendingNextReel && where.nextReelArmedAt.getTime() === campaign.nextReelArmedAt.getTime();
      if (canBind) isPending = false;
      return { count: canBind ? 1 : 0 };
    });
    const results = await Promise.all([attachPendingNextReels(), attachPendingNextReels()]);
    expect(results.reduce((sum, result) => sum + result.bound, 0)).toBe(1);
  });
});

describe("durable comments received before Reel binding", () => {
  it("stores the original timestamp and connected account so retries cannot extend the private-reply window", async () => {
    expect(await deferPendingReelComment(comment)).toBe(true);
    expect(mocks.pending.upsert).toHaveBeenCalledWith({
      where: { accountId_commentId: { accountId: account.id, commentId: comment.commentId } },
      create: expect.objectContaining({ accountId: account.id, mediaId: comment.mediaId, payload: comment, expiresAt: new Date(comment.timestamp! + 7 * 86400000) }),
      update: {},
    });
  });
  it("uses the organic post id for comments on promoted content", async () => {
    await deferPendingReelComment({ ...comment, originalMediaId: "organic_reel", mediaId: "ad_media" });
    expect(mocks.pending.upsert.mock.calls[0][0].create.mediaId).toBe("organic_reel");
  });
  it("does not retain an expired comment or a comment without a waiting campaign", async () => {
    expect(await deferPendingReelComment({ ...comment, timestamp: now.getTime() - 7 * 86400000 })).toBe(false);
    mocks.automation.findFirst.mockResolvedValue(null);
    expect(await deferPendingReelComment(comment)).toBe(false);
    expect(mocks.pending.upsert).not.toHaveBeenCalled();
  });
  it("does not invent a new seven day allowance when the source timestamp is missing", async () => {
    const withoutTimestamp = { ...comment, timestamp: undefined };
    expect(await deferPendingReelComment(withoutTimestamp)).toBe(false);
    vi.setSystemTime(new Date(now.getTime() + 86400000));
    expect(await deferPendingReelComment(withoutTimestamp)).toBe(false);
    expect(mocks.pending.upsert).not.toHaveBeenCalled();
  });
  it("replays after binding while preserving the original payload and a stable queue id", async () => {
    mocks.automation.findMany.mockResolvedValue([{ id: campaign.id, instagramAccountId: account.id, postId: comment.mediaId }]);
    const queueIds = new Set<string>();
    mocks.enqueue.mockImplementation(async (_name, _data, { jobId }) => { queueIds.add(jobId); return { id: jobId }; });
    expect(await replayPendingReelComments()).toBe(1);
    expect(await replayPendingReelComments()).toBe(1);
    expect(queueIds.size).toBe(1);
    expect(mocks.enqueue).toHaveBeenCalledWith("process-comment", comment, { jobId: `pending_reel_${deferred.id}`, removeOnComplete: true, removeOnFail: true });
    expect(mocks.pending.delete).not.toHaveBeenCalled();
    expect(mocks.pending.update).toHaveBeenCalledWith({ where: { id: deferred.id }, data: { replayedAt: now } });
  });
  it("does not replay a comment for a different or still pending Reel", async () => {
    mocks.automation.findMany.mockResolvedValueOnce([{ instagramAccountId: account.id, postId: "other_reel" }]).mockResolvedValue([]);
    expect(await replayPendingReelComments()).toBe(0);
    expect(mocks.automation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { instagramAccountId: account.id, postId: comment.mediaId, isActive: true, pendingNextReel: false } }));
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.pending.delete).not.toHaveBeenCalled();
  });
  it.each(["sent", "flow"])("deletes the deferred record once a %s delivery exists without enqueuing again", async (kind) => {
    mocks.automation.findMany.mockResolvedValue([{ id: campaign.id, instagramAccountId: account.id, postId: comment.mediaId }]);
    if (kind === "sent") mocks.dmLog.findFirst.mockResolvedValue({ id: "sent_log" });
    else mocks.run.findFirst.mockResolvedValue({ id: "flow_run" });
    expect(await replayPendingReelComments()).toBe(0);
    expect(mocks.pending.delete).toHaveBeenCalledWith({ where: { id: deferred.id } });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("keeps the durable record recoverable if adding to Redis fails", async () => {
    mocks.automation.findMany.mockResolvedValue([{ id: campaign.id, instagramAccountId: account.id, postId: comment.mediaId }]);
    mocks.enqueue.mockRejectedValue(new Error("Redis unavailable"));
    await expect(replayPendingReelComments()).rejects.toThrow("Redis unavailable");
    expect(mocks.pending.delete).not.toHaveBeenCalled();
    expect(mocks.pending.update).not.toHaveBeenCalled();
  });
  it("filters bound media before limiting the backlog and prioritizes never replayed comments", async () => {
    mocks.automation.findMany.mockResolvedValue([{ id: campaign.id, instagramAccountId: account.id, postId: comment.mediaId }]);
    mocks.pending.findMany.mockImplementation(async ({ where, orderBy }) => {
      // More than one batch of old unrelated comments must not consume the
      // retrieval limit ahead of the newly bound Reel's first comments.
      const unrelated = Array.from({ length: 201 }, (_, index) => ({ ...deferred, id: `old_${index}`, mediaId: "unbound_reel" }));
      const rows = [...unrelated, deferred];
      const eligible = rows.filter((row) => where.OR.some((binding: { accountId: string; mediaId: string }) => binding.accountId === row.accountId && binding.mediaId === row.mediaId));
      expect(orderBy[0]).toEqual({ replayedAt: { sort: "asc", nulls: "first" } });
      return eligible.slice(0, 200);
    });
    expect(await replayPendingReelComments()).toBe(1);
    expect(mocks.enqueue).toHaveBeenCalledWith("process-comment", comment, { jobId: `pending_reel_${deferred.id}`, removeOnComplete: true, removeOnFail: true });
  });
});
