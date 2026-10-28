import { createHash } from "node:crypto";
import { getMetaGraphApiVersion } from "@/lib/env";
import { createInstagramContext } from "@/lib/instagram/context";
import { requireMusaAccount, requireMusaConnection } from "./auth";
import { analyticsQuery } from "./analytics-contract";
import type { AnalyticsIdentity } from "./analytics-contract";
import { MusaIntegrationError } from "./errors";
import { bindAnalyticsBudget } from "./analytics-transport";

export async function analyticsSession(request: Request) {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(8000)]);
  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) if (params.getAll(key).length !== 1) throw new MusaIntegrationError(400, "INVALID_QUERY", "Select a valid analytics period.");
  const parsed = analyticsQuery.safeParse(Object.fromEntries(params));
  if (!parsed.success) throw new MusaIntegrationError(400, "INVALID_QUERY", "Select a valid analytics period.");
  const grant = await requireMusaConnection(request);
  signal.throwIfAborted();
  const account = requireMusaAccount(grant, parsed.data.accountId);
  const generation = createHash("sha256").update(JSON.stringify([grant.connectionId, account.id, account.instagramId, account.provider, account.connectedAt.toISOString()])).digest("hex");
  const { from, to, timezone } = parsed.data;
  const identity: AnalyticsIdentity = { version: 1, connectionId: grant.connectionId, generation,
    accountId: account.id, instagramId: account.instagramId, provider: account.provider,
    apiVersion: account.provider === "META" ? getMetaGraphApiVersion() : "zernio-v1",
    observedAt: new Date().toISOString(), range: { from, to, timezone } };
  const context = await createInstagramContext(account);
  signal.throwIfAborted();
  bindAnalyticsBudget(context, grant.connectionId);
  return { identity, account, query: parsed.data, context, signal };
}
export type AnalyticsSession = Awaited<ReturnType<typeof analyticsSession>>;

/** Bounds authentication, provider reads and read-only DB work together. No late write can occur. */
export async function analyticsWithinDeadline<T>(request: Request, read: (session: AnalyticsSession) => Promise<T>): Promise<T> {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), 8200);
  const signal = AbortSignal.any([request.signal, control.signal]);
  // Next/Vercel may supply a Request from another Web API implementation.
  // These readers are GET-only; copy its public fields, not its constructor identity.
  const scoped = new Request(request.url, { method: request.method, headers: request.headers, signal });
  let rejectOnAbort: () => void = () => undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = () => reject(new MusaIntegrationError(503, "ANALYTICS_UNAVAILABLE", "Analytics are temporarily unavailable."));
    signal.addEventListener("abort", rejectOnAbort, { once: true });
    if (signal.aborted) rejectOnAbort();
  });
  try { return await Promise.race([analyticsSession(scoped).then(read), expired]); }
  finally { clearTimeout(timer); signal.removeEventListener("abort", rejectOnAbort); control.abort(); }
}
