import { Worker } from "bullmq";
import {
  CONTACT_SYNC_QUEUE_NAME,
  getRedisConnection,
  type ContactSyncJob,
} from "@/lib/queue/client";
import { processContactSyncJob } from "./sync";

/** Sends queued contact changes to the workspace's sheet. */
export function createContactSyncWorker(): Worker<ContactSyncJob> {
  const worker = new Worker<ContactSyncJob>(
    CONTACT_SYNC_QUEUE_NAME,
    (job) => processContactSyncJob(job.data),
    { connection: getRedisConnection(), concurrency: 2 }
  );

  worker.on("failed", (job, error) => {
    console.error(
      `[Contact Sync] Job ${job?.id} failed (attempt ${job?.attemptsMade}):`,
      error.message
    );
  });

  worker.on("error", (error) => {
    console.error("[Contact Sync] Worker error:", error.message);
  });

  return worker;
}
