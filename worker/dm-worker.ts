import { createDMWorker } from "@/lib/queue/dm-worker";
import { createContactSyncWorker } from "@/lib/contacts/sync-worker";
import { recordWorkerHeartbeat } from "@/lib/ops/worker-health";
import { reconcileComments } from "@/lib/polling/comment-reconciler";
import { attachPendingNextReels } from "@/lib/automation/attach-next-reel";
import { replayPendingReelComments } from "@/lib/automation/pending-comments";
import { createFlowWorker } from "@/lib/flows/queue";
import { recoverFlowRuns } from "@/lib/flows/engine";
import os from "node:os";

const worker = createDMWorker();
const contactSyncWorker = createContactSyncWorker();
const flowWorker = createFlowWorker();
const startedAt = new Date().toISOString();
const HEARTBEAT_INTERVAL_MS = 30_000;
// Polling safety net for comments that webhooks miss. Runs in the worker because
// it must fire every few minutes and Vercel's free crons only run once a day.
const POLL_INTERVAL_MS = Number(
  process.env.COMMENT_POLL_INTERVAL_MS ?? 5 * 60_000
);

console.log("[DM Worker] Started");

async function heartbeat() {
  try {
    await recordWorkerHeartbeat({
      pid: process.pid,
      hostname: os.hostname(),
      startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DM Worker] Heartbeat failed:", message);
  }
}

void heartbeat();
const heartbeatTimer = setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);

async function poll() {
  try {
    const attached = await attachPendingNextReels();
    if (attached.bound > 0 || attached.failedAccounts > 0) {
      console.log("[DM Worker] Next-reel attachment:", attached);
    }
    await replayPendingReelComments();
    await reconcileComments();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DM Worker] Comment reconciliation failed:", message);
  }
}

// Kick off one sweep shortly after boot, then on a fixed interval.
setTimeout(() => void poll(), 10_000);
const pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
// Delays and unanswered questions are durable database schedules. Recovering
// them also repairs a queue outage or a restart between commit and enqueue.
const flowRecoveryTimer = setInterval(() => void recoverFlowRuns().catch((error) => console.error("[Flows] Recovery failed:", error instanceof Error ? error.message : "Unknown error")), 30_000);
void recoverFlowRuns().catch(() => {});

async function shutdown(signal: string) {
  console.log(`[DM Worker] ${signal} received, closing worker`);
  clearInterval(heartbeatTimer);
  clearInterval(pollTimer);
  clearInterval(flowRecoveryTimer);
  await Promise.all([worker.close(), contactSyncWorker.close(), flowWorker.close()]);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
