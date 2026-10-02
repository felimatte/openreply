import { Queue, Worker } from "bullmq";
import { getRedisConnection } from "@/lib/queue/client";

type FlowJob = { runId: string };
let queue: Queue<FlowJob> | undefined;

export function getFlowQueue() {
  return (queue ??= new Queue<FlowJob>("flow-processing", {
    connection: getRedisConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: { count: 1_000 },
      removeOnFail: { count: 1_000 },
    },
  }));
}

/** The database is the schedule; Redis only wakes the executor. Recovery can
 * safely recreate lost jobs without depending on retained queue history. */
export async function enqueueFlowRun(runId: string, dueAt = new Date()) {
  await getFlowQueue().add("execute-flow", { runId }, {
    delay: Math.max(0, dueAt.getTime() - Date.now()),
    jobId: `flow_${runId}_${dueAt.getTime()}`,
  });
}

export function createFlowWorker() {
  const worker = new Worker<FlowJob>("flow-processing", async (job) => {
    const { executeFlowRun } = await import("./engine");
    await executeFlowRun(job.data.runId);
  }, { connection: getRedisConnection(), concurrency: 5 });
  worker.on("error", (error) => console.error("[Flows] Worker error:", error.message));
  worker.on("failed", (job, error) => console.error("[Flows] Job failed:", job?.data.runId, error.message));
  return worker;
}
