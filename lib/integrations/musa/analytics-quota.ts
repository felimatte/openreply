import { createHash } from "node:crypto";
import Redis from "ioredis";
import { MusaIntegrationError } from "./errors";

export class AnalyticsQuotaError extends MusaIntegrationError {
  constructor(limited = false, retryAfterSeconds = 3600) {
    super(limited ? 429 : 503, limited ? "ANALYTICS_RATE_LIMITED" : "ANALYTICS_UNAVAILABLE", "Analytics are temporarily unavailable.");
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// Product budgets, not a claim about Meta's provider limits. Each outgoing GET costs one.
export const ANALYTICS_GRANT_HOURLY = 1200;
export const ANALYTICS_GLOBAL_HOURLY = 12000;
export const reserveAnalyticsScript = `
local grant = tonumber(redis.call('GET', KEYS[1]) or '0')
local global = tonumber(redis.call('GET', KEYS[2]) or '0')
if grant >= tonumber(ARGV[1]) or global >= tonumber(ARGV[2]) then return 0 end
for i=1,2 do
  redis.call('INCR', KEYS[i])
  redis.call('EXPIRE', KEYS[i], 7200)
end
return 1`;

let client: Redis | null = null;
let connecting: Promise<void> | null = null;
function quotaClient(): Redis {
  if (!process.env.REDIS_URL) throw new AnalyticsQuotaError();
  if (!client || client.status === "end") {
    client = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 0,
      connectTimeout: 800, commandTimeout: 800, enableOfflineQueue: false, retryStrategy: () => null });
    client.on("error", () => undefined);
    connecting = null;
  }
  return client;
}

export function analyticsQuotaKeys(connectionId: string, now = Date.now()): [string, string] {
  const grant = createHash("sha256").update(connectionId).digest("hex");
  const window = Math.floor(now / 3600000);
  return [`{musa-analytics}:grant:${grant}:${window}`, `{musa-analytics}:global:${window}`];
}

export async function reserveAnalyticsRead(connectionId: string, signal: AbortSignal, redis?: Redis): Promise<void> {
  try {
    signal.throwIfAborted();
    const active = redis ?? quotaClient();
    if (!redis && active.status !== "ready") {
      connecting ??= active.connect();
      await connecting;
    }
    signal.throwIfAborted();
    const allowed = await active.eval(reserveAnalyticsScript, 2, ...analyticsQuotaKeys(connectionId), ANALYTICS_GRANT_HOURLY, ANALYTICS_GLOBAL_HOURLY);
    signal.throwIfAborted();
    if (allowed === 0) throw new AnalyticsQuotaError(true);
    if (allowed !== 1) throw new AnalyticsQuotaError();
  } catch (error) {
    if (error instanceof AnalyticsQuotaError) throw error;
    throw new AnalyticsQuotaError();
  }
}
