import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { analyticsQuotaKeys, reserveAnalyticsRead, ANALYTICS_GRANT_HOURLY, ANALYTICS_GLOBAL_HOURLY } from "@/lib/integrations/musa/analytics-quota";

const disposable = process.env.MUSA_TEST_REDIS_URL;
it.skipIf(!disposable)("reserves both budgets atomically under concurrent requests and keeps grant failures isolated", async () => {
  const url = new URL(disposable!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Disposable local Redis required");
  const redis = new Redis(disposable!, { maxRetriesPerRequest: 0 });
  const grant = randomUUID(), other = randomUUID(), keys = analyticsQuotaKeys(grant), otherKeys = analyticsQuotaKeys(other);
  const signal = new AbortController().signal;
  try {
    await redis.mset(keys[0], ANALYTICS_GRANT_HOURLY - 1, keys[1], ANALYTICS_GLOBAL_HOURLY - 1);
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => reserveAnalyticsRead(grant, signal, redis)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await redis.mget(...keys)).toEqual([String(ANALYTICS_GRANT_HOURLY), String(ANALYTICS_GLOBAL_HOURLY)]);
    await redis.set(keys[1], 0);
    await expect(reserveAnalyticsRead(grant, signal, redis)).rejects.toThrow();
    expect(await redis.get(keys[1])).toBe("0");
    await expect(reserveAnalyticsRead(other, signal, redis)).resolves.toBeUndefined();
    expect(await redis.ttl(otherKeys[0])).toBeGreaterThan(0);
    const abort = new AbortController(); abort.abort();
    await expect(reserveAnalyticsRead(other, abort.signal, redis)).rejects.toThrow();
    expect(await redis.get(otherKeys[0])).toBe("1");
  } finally { await redis.del(...new Set([...keys, ...otherKeys])); await redis.quit(); }
});
