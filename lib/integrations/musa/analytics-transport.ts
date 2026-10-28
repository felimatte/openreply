import { isIP } from "node:net";
import { getMetaGraphApiVersion } from "@/lib/env";
import type { InstagramContext } from "@/lib/instagram/context";
import type { AnalyticsState } from "./analytics-contract";

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
  try {
    const response = await fetch(`${origin}${path}?${query}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error", signal,
    });
    const body = await boundedJson(response);
    if (!response.ok) {
      const code = typeof body === "object" && body !== null && "error" in body
        ? (body.error as { code?: number } | undefined)?.code : undefined;
      if (response.status === 401 || response.status === 403 || code === 190 || code === 10 || code === 200) throw new AnalyticsReadError("permission_required");
      if (code === 100 || response.status === 404) throw new AnalyticsReadError("unsupported");
      throw new AnalyticsReadError("temporarily_unavailable");
    }
    return body;
  } catch (error) {
    if (error instanceof AnalyticsReadError) throw error;
    throw new AnalyticsReadError("temporarily_unavailable");
  }
}

export function readState(error: unknown): AnalyticsState {
  return error instanceof AnalyticsReadError ? error.state : "temporarily_unavailable";
}
