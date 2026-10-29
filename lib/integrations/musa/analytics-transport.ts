import { isIP } from "node:net";
import { getMetaGraphApiVersion } from "@/lib/env";
import type { InstagramContext } from "@/lib/instagram/context";
import type { AnalyticsState } from "./analytics-contract";
import { AnalyticsQuotaError, reserveAnalyticsRead } from "./analytics-quota";

const budgets = new WeakMap<InstagramContext, { connectionId: string; remaining: number }>();
export function bindAnalyticsBudget(context: InstagramContext, connectionId: string): void {
  budgets.set(context, { connectionId, remaining: 24 });
}

function providerWait(response: Response): number {
  const header = response.headers.get("Retry-After") ?? "";
  const seconds = /^\d+$/.test(header) ? Number(header) : (Date.parse(header) - Date.now()) / 1000;
  return Number.isFinite(seconds) ? Math.max(3600, Math.ceil(seconds)) : 3600;
}

export class AnalyticsReadError extends Error {
  constructor(public readonly state: AnalyticsState) { super("Analytics read unavailable"); }
}

export function publicMediaUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443")) return null;
    if (isIP(url.hostname) || !url.hostname.includes(".") || /\.(local|localhost|internal)$/i.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new AnalyticsReadError("temporarily_unavailable");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 230000) { await reader.cancel(); throw new AnalyticsReadError("temporarily_unavailable"); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

/** Only closed error categories cross this boundary; neither URLs nor provider errors are logged. */
export async function readAnalytics(context: InstagramContext, path: string, query: URLSearchParams, signal: AbortSignal): Promise<unknown> {
  if (!/^\/[a-zA-Z0-9_/-]+$/.test(path) || path.includes("..") || path.startsWith("//")) throw new AnalyticsReadError("unsupported");
  const origin = context.provider === "META" ? `https://graph.instagram.com/${getMetaGraphApiVersion()}` : "https://zernio.com/api/v1";
  const token = context.provider === "META" ? context.accessToken : context.apiKey;
  return readProvider(context, origin, token, path, query, signal);
}

/** Only the independent Facebook grant may read Discovery; origin is never caller supplied. */
export async function readFacebookAnalytics(context: InstagramContext, token: string, path: string,
  query: URLSearchParams, signal: AbortSignal): Promise<unknown> {
  if (context.provider !== "META" || !/^\/[a-zA-Z0-9_/-]+$/.test(path) || path.includes("..") || path.startsWith("//"))
    throw new AnalyticsReadError("unsupported");
  return readProvider(context, `https://graph.facebook.com/${getMetaGraphApiVersion()}`, token, path, query, signal);
}

async function readProvider(context: InstagramContext, origin: string, token: string, path: string,
  query: URLSearchParams, signal: AbortSignal): Promise<unknown> {
  try {
    signal.throwIfAborted();
    const budget = budgets.get(context);
    if (!budget || budget.remaining-- <= 0) throw new AnalyticsQuotaError();
    await reserveAnalyticsRead(budget.connectionId, signal);
    signal.throwIfAborted();
    const response = await fetch(`${origin}${path}?${query}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error", signal,
    });
    if (response.status === 429) { await response.body?.cancel(); throw new AnalyticsQuotaError(true, providerWait(response)); }
    const body = await boundedJson(response);
    if (!response.ok) {
      const code = typeof body === "object" && body !== null && "error" in body
        ? (body.error as { code?: number } | undefined)?.code : undefined;
      if (code === 4 || code === 17 || code === 368) throw new AnalyticsQuotaError(true, providerWait(response));
      if (response.status === 401 || response.status === 403 || code === 190 || code === 10 || code === 200) throw new AnalyticsReadError("permission_required");
      if (code === 100 || response.status === 404) throw new AnalyticsReadError("unsupported");
      throw new AnalyticsReadError("temporarily_unavailable");
    }
    return body;
  } catch (error) {
    if (error instanceof AnalyticsReadError || error instanceof AnalyticsQuotaError) throw error;
    throw new AnalyticsReadError("temporarily_unavailable");
  }
}

export function readState(error: unknown): AnalyticsState {
  if (error instanceof AnalyticsQuotaError) throw error;
  return error instanceof AnalyticsReadError ? error.state : "temporarily_unavailable";
}
