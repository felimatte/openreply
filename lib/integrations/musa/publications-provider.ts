import { z } from "zod";
import { getMetaGraphApiVersion } from "@/lib/env";
import type { InstagramContext } from "@/lib/instagram/context";
import type { MusaPublicationInput } from "./publications-policy";

export class MusaProviderError extends Error {
  constructor(public readonly code: string, public readonly ambiguous = false, public readonly retryable = false) {
    super(code);
  }
}

export async function publicationProviderRequest(
  context: InstagramContext, path: string,
  options: { method?: "GET" | "POST"; body?: unknown; idempotencyKey?: string; timeoutMs?: number } = {},
): Promise<unknown> {
  const method = options.method ?? "GET";
  const base = context.provider === "META"
    ? `https://graph.instagram.com/${getMetaGraphApiVersion()}` : "https://zernio.com/api/v1";
  const credential = context.provider === "META" ? context.accessToken : context.apiKey;
  let response: Response;
  let body: unknown;
  const signal = AbortSignal.timeout(options.timeoutMs ?? 3500);
  try {
    response = await fetch(`${base}${path}`, {
      method, headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json",
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      cache: "no-store", redirect: "error", signal,
    });
    body = await providerJson(response, signal);
  } catch { throw new MusaProviderError("PROVIDER_UNREACHABLE", method === "POST", true); }
  // Provider errors can contain credentials and request URLs. Never persist them.
  if (!response.ok) {
    if (response.status === 429) throw new MusaProviderError("PROVIDER_RATE_LIMIT", false, true);
    if (response.status === 401 || response.status === 403) throw new MusaProviderError("RECONNECT_REQUIRED");
    if (response.status === 409 && context.provider === "ZERNIO") {
      const result = z.object({ code: z.string().optional() }).safeParse(body);
      if (result.success && result.data.code === "idempotency_conflict")
        throw new MusaProviderError("PROVIDER_PROCESSING", false, true);
      throw new MusaProviderError("PROVIDER_DUPLICATE_CONTENT");
    }
    throw new MusaProviderError("PROVIDER_REJECTED", method === "POST" && response.status >= 500, response.status >= 500);
  }
  if (!body) throw new MusaProviderError("PROVIDER_INVALID_RESPONSE", method === "POST", true);
  return body;
}

async function providerJson(response: Response, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  let abort!: () => void;
  const interrupted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    const body: unknown = await Promise.race([response.json().catch(() => null), interrupted]);
    signal.throwIfAborted();
    return body;
  } finally { signal.removeEventListener("abort", abort); }
}

const remoteId = z.object({ id: z.string().min(1) });
export async function createMetaContainer(context: InstagramContext, instagramId: string, input: MusaPublicationInput) {
  const raw = await publicationProviderRequest(context, `/${encodeURIComponent(instagramId)}/media`, {
    method: "POST", body: { media_type: "REELS", video_url: input.videoUrl, caption: input.caption,
      ...(input.coverUrl ? { cover_url: input.coverUrl } : {}) },
  });
  const parsed = remoteId.safeParse(raw);
  if (!parsed.success) throw new MusaProviderError("PROVIDER_INVALID_RESPONSE", true);
  return parsed.data.id;
}

export async function metaContainerStatus(context: InstagramContext, containerId: string) {
  const raw = await publicationProviderRequest(context, `/${encodeURIComponent(containerId)}?fields=status_code`);
  const parsed = z.object({ id: z.string(), status_code: z.enum(["IN_PROGRESS", "FINISHED", "ERROR", "EXPIRED", "PUBLISHED"]) }).safeParse(raw);
  if (!parsed.success || parsed.data.id !== containerId) throw new MusaProviderError("PROVIDER_INVALID_RESPONSE", false, true);
  return parsed.data.status_code;
}

export async function metaPublishingQuota(context: InstagramContext, instagramId: string) {
  const raw = await publicationProviderRequest(context, `/${encodeURIComponent(instagramId)}/content_publishing_limit?fields=quota_usage,config`);
  const parsed = z.object({ data: z.array(z.object({ quota_usage: z.number(), config: z.object({ quota_total: z.number() }) })) }).safeParse(raw);
  if (!parsed.success || !parsed.data.data.length) throw new MusaProviderError("PUBLISHING_QUOTA_UNAVAILABLE", false, true);
  return parsed.data.data[0].quota_usage < parsed.data.data[0].config.quota_total;
}

export async function publishMetaContainer(context: InstagramContext, instagramId: string, containerId: string) {
  const raw = await publicationProviderRequest(context, `/${encodeURIComponent(instagramId)}/media_publish`, {
    method: "POST", body: { creation_id: containerId },
  });
  const parsed = remoteId.safeParse(raw);
  if (!parsed.success) throw new MusaProviderError("PROVIDER_INVALID_RESPONSE", true);
  return parsed.data.id;
}

export async function metaMediaPermalink(context: InstagramContext, mediaId: string) {
  const raw = await publicationProviderRequest(context, `/${encodeURIComponent(mediaId)}?fields=id,permalink`);
  const parsed = z.object({ id: z.string(), permalink: z.string().url().optional() }).safeParse(raw);
  if (!parsed.success || parsed.data.id !== mediaId) throw new MusaProviderError("PROVIDER_INVALID_RESPONSE", false, true);
  return parsed.data.permalink ?? null;
}

const zernioPost = z.object({ post: z.object({
  _id: z.string().min(1), status: z.string(),
  platforms: z.array(z.object({ platform: z.string(), accountId: z.union([z.string(), z.object({ _id: z.string() })]),
    status: z.string(), platformPostId: z.string().optional().nullable(), platformPostUrl: z.string().url().optional().nullable(),
  })),
}) });
export function readZernioPublication(raw: unknown, accountId: string) {
  const parsed = zernioPost.safeParse(raw);
  if (!parsed.success) throw new MusaProviderError("PROVIDER_INVALID_RESPONSE", false, true);
  const target = parsed.data.post.platforms.find((p) => p.platform === "instagram" &&
    (typeof p.accountId === "string" ? p.accountId : p.accountId._id) === accountId);
  if (!target) throw new MusaProviderError("PROVIDER_ACCOUNT_MISMATCH");
  return { postId: parsed.data.post._id, status: target.status, mediaId: target.platformPostId ?? null,
    permalink: target.platformPostUrl ?? null };
}

export async function createZernioPublication(context: Extract<InstagramContext, { provider: "ZERNIO" }>,
  input: MusaPublicationInput, publicationId: string, scheduledAt: Date) {
  return publicationProviderRequest(context, "/posts", { method: "POST", idempotencyKey: publicationId,
    body: { content: input.caption, mediaItems: [{ type: "video", url: input.videoUrl }],
      // A near-future schedule delegates video processing to Zernio's worker.
      // publishNow is synchronous and can exceed a serverless request lifetime.
      scheduledFor: scheduledAt.toISOString(), timezone: "UTC",
      platforms: [{ platform: "instagram", accountId: context.accountId,
        ...(input.coverUrl ? { platformSpecificData: { instagramThumbnail: input.coverUrl } } : {}) }],
      metadata: { musaPublicationId: publicationId } },
  });
}

export async function getZernioPublication(context: InstagramContext, postId: string) {
  return publicationProviderRequest(context, `/posts/${encodeURIComponent(postId)}`);
}
