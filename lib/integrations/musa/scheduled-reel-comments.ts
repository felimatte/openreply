import { prisma } from "@/lib/db/client";
import type { MusaScheduledReel, Prisma } from "@/app/generated/prisma/client";
import { PRIVATE_REPLY_WINDOW_MS } from "@/lib/flows/runtime-values";
import { parseCommentEvents } from "@/lib/meta/webhook";
import { getDMQueue } from "@/lib/queue/client";

type WebhookRecord = { id: string; payload: Prisma.JsonValue; createdAt: Date };
const PAGE_SIZE = 25;
const MAX_PAGES = 4;

export function scheduledCommentEvents(payload: Prisma.JsonValue, instagramId: string, mediaId: string, now = Date.now()) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Array.isArray(payload.entry)) return [];
  const events = parseCommentEvents(payload as unknown as Parameters<typeof parseCommentEvents>[0]);
  return events.filter(event => event.instagramAccountId === instagramId &&
    (event.mediaId === mediaId || event.originalMediaId === mediaId) &&
    event.timestamp && event.timestamp <= now && now - event.timestamp < PRIVATE_REPLY_WINDOW_MS);
}

async function earlyWebhooks(attempt: MusaScheduledReel, instagramId: string, mediaId: string, cutoff: Date) {
  const oldest = new Date(Math.max(attempt.createdAt.getTime(), cutoff.getTime() - PRIVATE_REPLY_WINDOW_MS));
  return prisma.$queryRaw<WebhookRecord[]>`
    SELECT w."id", w."payload", w."createdAt"
    FROM "WebhookEvent" w
    WHERE w."object" = 'instagram' AND w."createdAt" >= ${oldest} AND w."createdAt" <= ${cutoff}
      AND (${attempt.replayCursorAt}::timestamp IS NULL OR
        (w."createdAt", w."id") > (${attempt.replayCursorAt}::timestamp, ${attempt.replayCursorId}::text))
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w."payload"->'entry') = 'array'
          THEN w."payload"->'entry' ELSE '[]'::jsonb END) entry
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(entry->'changes') = 'array'
          THEN entry->'changes' ELSE '[]'::jsonb END) change
        WHERE entry->>'id' = ${instagramId} AND change->>'field' = 'comments'
          AND (coalesce(change->'value'->'media'->>'id', change->'value'->>'media_id') = ${mediaId}
            OR change->'value'->'media'->>'original_media_id' = ${mediaId})
      )
    ORDER BY w."createdAt", w."id"
    LIMIT ${PAGE_SIZE}`;
}

async function replayEarlyWebhooks(attempt: MusaScheduledReel, cutoff: Date, now: Date) {
  const { mediaId, activatedAt } = attempt;
  if (!mediaId || !activatedAt || now.getTime() - activatedAt.getTime() >= PRIVATE_REPLY_WINDOW_MS) return null;
  const campaign = await prisma.automation.findFirst({ where: {
    id: attempt.automationId, instagramAccountId: attempt.accountId, postId: mediaId,
  }, select: { instagramAccount: { select: { instagramId: true } } } });
  if (!campaign) return null;
  const { instagramId } = campaign.instagramAccount;
  const webhooks = await earlyWebhooks(attempt, instagramId, mediaId, cutoff);
  for (const webhook of webhooks) {
    for (const event of scheduledCommentEvents(webhook.payload, instagramId, mediaId, now.getTime())) {
      await getDMQueue().add("process-comment", { ...event, accountConnectionId: attempt.accountId, source: "WEBHOOK",
        targetScheduledAutomationId: attempt.automationId }, {
        jobId: `musa_scheduled_${attempt.accountId}_${Buffer.from(event.commentId).toString("base64url")}`,
      });
    }
  }
  if (webhooks.length < PAGE_SIZE) return null;
  const cursor = webhooks[webhooks.length - 1];
  return { replayCursorAt: cursor.createdAt, replayCursorId: cursor.id };
}

/** The activation transaction creates the marker. A crashed worker can retry the same page. */
export async function replayMusaScheduledComments(now = new Date()) {
  const attempts = await prisma.musaScheduledReel.findMany({
    where: { status: "active", replayDueAt: { lte: now } }, orderBy: { replayDueAt: "asc" }, take: 10,
  });
  for (const attempt of attempts) {
    const lease = new Date(Math.max(now.getTime(), Date.now()) + 60_000);
    const scope = { requestId: attempt.requestId, status: "active" };
    // The first claim observes the committed activation. Its DB-clock cutoff also covers
    // events that were stored after activatedAt but processed before the commit.
    const [claim] = await prisma.$queryRaw<{ replayUntil: Date }[]>`
      UPDATE "MusaScheduledReel" SET "replayDueAt" = ${lease},
        "replayUntil" = coalesce("replayUntil", clock_timestamp()), "updatedAt" = clock_timestamp()
      WHERE "requestId" = ${scope.requestId}::uuid AND "status" = 'active'
        AND "replayDueAt" = ${attempt.replayDueAt}
      RETURNING "replayUntil"`;
    if (!claim) continue;
    let cursor = attempt;
    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        const observedAt = new Date(Math.max(Date.now(), now.getTime(), claim.replayUntil.getTime()));
        const next = await replayEarlyWebhooks(cursor, claim.replayUntil, observedAt);
        const due = page + 1 === MAX_PAGES ? new Date(Date.now() + 1000) : lease;
        const saved = await prisma.musaScheduledReel.updateMany({
          where: { ...scope, replayDueAt: lease },
          data: next ? { ...next, replayDueAt: due }
            : { replayDueAt: null, replayCursorAt: null, replayCursorId: null },
        });
        if (!saved.count || !next) break;
        cursor = { ...cursor, ...next };
      }
    } catch {
      // The saved marker is due again when the lease expires. No comment data in logs.
      console.warn("[MUSA] Early Reel comment reconciliation will retry.");
    }
  }
}
