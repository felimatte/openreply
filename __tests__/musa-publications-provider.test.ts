import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const contextMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/instagram/context", () => ({ createInstagramContext: contextMock }));
import { getMusaPublishingCapability } from "@/lib/integrations/musa/publications-capabilities";
import { createMetaContainer, createMetaCarouselChild, createMetaCarouselContainer, createZernioPublication, metaContainerStatus, publicationProviderRequest, readZernioPublication } from "@/lib/integrations/musa/publications-provider";

const fetchMock = vi.fn();
const meta = { provider: "META" as const, accessToken: "test-token-never-real" };
const zernio = { provider: "ZERNIO" as const, accountId: "remote-a", instagramId: "ig-a", apiKey: "test-key-never-real" };
const account = { provider: "META" as const, accessToken: "encrypted-fixture", workspaceId: "workspace-a", instagramId: "ig-a", zernioAccountId: null };
const input = { accountId: "account-a", caption: "QA", videoUrl: "https://cdn.example.com/a.mp4", coverUrl: "https://cdn.example.com/cover.jpg" };
beforeEach(() => {
  vi.resetAllMocks(); vi.stubGlobal("fetch", fetchMock); vi.stubEnv("META_GRAPH_API_VERSION", "v25.0");
  contextMock.mockResolvedValue(meta);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("publication provider boundary", () => {
  it("creates a feed image instead of a Reel", async () => {
    fetchMock.mockResolvedValue(Response.json({ id: "image-a" }));
    await createMetaContainer(meta, "ig-a", { accountId: "account-a", caption: "Foto", format: "image",
      mediaItems: [{ type: "image", url: "https://cdn.example.com/a.jpg" }] });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ image_url: "https://cdn.example.com/a.jpg", caption: "Foto" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(["image", "video"] as const)("creates an unpublished carousel child of type %s", async type => {
    fetchMock.mockResolvedValue(Response.json({ id: "child-a" }));
    await createMetaCarouselChild(meta, "ig-a", { type, url: "https://cdn.example.com/media" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(type === "video"
      ? { media_type: "VIDEO", video_url: "https://cdn.example.com/media", is_carousel_item: true }
      : { image_url: "https://cdn.example.com/media", is_carousel_item: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("creates the parent with the exact child order and no publish call", async () => {
    fetchMock.mockResolvedValue(Response.json({ id: "parent-a" }));
    expect(await createMetaCarouselContainer(meta, "ig-a", "Caption", ["photo-a", "video-a"])).toBe("parent-a");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ media_type: "CAROUSEL", children: ["photo-a", "video-a"], caption: "Caption" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects a child ID masquerading as the parent", async () => {
    fetchMock.mockResolvedValue(Response.json({ id: "child-a" }));
    await expect(createMetaCarouselContainer(meta, "ig-a", "Caption", ["child-a", "child-b"]))
      .rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE", ambiguous: true });
  });
  it("preserves Zernio mixed media order, key and asynchronous scheduling", async () => {
    fetchMock.mockResolvedValue(Response.json({ post: { _id: "post-a" } }));
    const mediaItems = [{ type: "image" as const, url: "https://cdn.example.com/a.jpg" }, { type: "video" as const, url: input.videoUrl }];
    await createZernioPublication(zernio, { accountId: "account-a", caption: "Mixto", format: "carousel", mediaItems },
      "publication-uuid", new Date("2026-10-25T19:00:30Z"));
    const [, options] = fetchMock.mock.calls[0]; const body = JSON.parse(options.body);
    expect(body.mediaItems).toEqual(mediaItems); expect(body.publishNow).toBeUndefined();
    expect(body.scheduledFor).toBe("2026-10-25T19:00:30.000Z");
    expect(options.headers["Idempotency-Key"]).toBe("publication-uuid");
    expect(body.platforms).toEqual([{ platform: "instagram", accountId: "remote-a" }]);
  });
  it("sends Meta credentials only in the header and creates a Reel container", async () => {
    fetchMock.mockResolvedValue(Response.json({ id: "container-a" }));
    expect(await createMetaContainer(meta, "ig-a", input)).toBe("container-a");
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).not.toContain(meta.accessToken);
    expect(url).toContain("/ig-a/media");
    expect(JSON.parse(options.body)).toMatchObject({ media_type: "REELS", video_url: input.videoUrl, cover_url: input.coverUrl });
    expect(options.headers.Authorization).toBe(`Bearer ${meta.accessToken}`);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
  it("marks ambiguous write responses without exposing provider error content", async () => {
    fetchMock.mockResolvedValue(Response.json({ message: "secret test-token-never-real" }, { status: 502 }));
    await expect(publicationProviderRequest(meta, "/ig-a/media_publish", { method: "POST" })).rejects.toMatchObject({
      code: "PROVIDER_REJECTED", ambiguous: true, message: "PROVIDER_REJECTED",
    });
  });
  it("marks a timeout ambiguous only for a write", async () => {
    fetchMock.mockRejectedValue(new Error("timeout"));
    await expect(publicationProviderRequest(meta, "/container")).rejects.toMatchObject({ ambiguous: false, retryable: true });
    await expect(publicationProviderRequest(meta, "/ig-a/media_publish", { method: "POST" })).rejects.toMatchObject({ ambiguous: true, retryable: true });
  });
  it("uses Zernio durable idempotency and asynchronous schedule", async () => {
    fetchMock.mockResolvedValue(Response.json({ post: { _id: "post-a" } }));
    const when = new Date("2026-10-11T19:00:30Z");
    await createZernioPublication(zernio, input, "publication-uuid", when);
    const options = fetchMock.mock.calls[0][1];
    const body = JSON.parse(options.body);
    expect(options.headers["Idempotency-Key"]).toBe("publication-uuid");
    expect(body.scheduledFor).toBe(when.toISOString()); expect(body.publishNow).toBeUndefined();
    expect(body.platforms).toEqual([{ platform: "instagram", accountId: "remote-a", platformSpecificData: { instagramThumbnail: input.coverUrl } }]);
  });
  it("rejects a post result belonging to another Zernio account", () => {
    expect(() => readZernioPublication({ post: { _id: "post-a", status: "published", platforms: [{
      platform: "instagram", accountId: "other-account", status: "published", platformPostId: "media-a",
    }] } }, "remote-a")).toThrow("PROVIDER_ACCOUNT_MISMATCH");
  });
  it("extracts an exact ID from the requested Zernio account only", () => {
    expect(readZernioPublication({ post: { _id: "post-a", status: "published", platforms: [{
      platform: "instagram", accountId: { _id: "remote-a" }, status: "published", platformPostId: "media-a",
    }] } }, "remote-a")).toMatchObject({ mediaId: "media-a", postId: "post-a", status: "published" });
  });
});

describe("real publishing capability", () => {
  it("probes the account's documented scope-protected quota endpoint using one GET", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    fetchMock.mockResolvedValue(Response.json({ data: [{ quota_usage: 2, config: { quota_total: 50, quota_duration: 86400 } }] }));
    expect(await getMusaPublishingCapability(account)).toEqual({ canPublish: true, publishUnavailableReason: null, supportedFormats: ["reel", "image", "carousel"] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.instagram.com/v25.0/ig-a/content_publishing_limit?fields=quota_usage,config");
    expect(url).not.toContain(meta.accessToken);
    expect(options).toMatchObject({ method: "GET", cache: "no-store", redirect: "error",
      headers: { Authorization: `Bearer ${meta.accessToken}` } });
    expect(options.body).toBeUndefined();
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(timeout).toHaveBeenCalledExactlyOnceWith(2000);
  });
  it("encodes the stored account ID without accepting a different endpoint", async () => {
    fetchMock.mockResolvedValue(Response.json({ data: [{ quota_usage: 0, config: { quota_total: 100 } }] }));
    expect((await getMusaPublishingCapability({ ...account, instagramId: "ig/a?fields=private" })).canPublish).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("https://graph.instagram.com/v25.0/ig%2Fa%3Ffields%3Dprivate/content_publishing_limit?fields=quota_usage,config");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([[50, 50], [51, 50], [0, 0]])("keeps authorization separate from exhausted quota (%i of %i)", async (usage, total) => {
    fetchMock.mockResolvedValue(Response.json({ data: [{ quota_usage: usage, config: { quota_total: total } }] }));
    expect(await getMusaPublishingCapability(account)).toEqual({ canPublish: true, publishUnavailableReason: null, supportedFormats: ["reel", "image", "carousel"] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBe("GET");
  });
  it.each([400, 401, 403, 429, 500, 503])("keeps HTTP %i closed without retrying or leaking provider content", async (status) => {
    fetchMock.mockResolvedValue(Response.json({ error: { message: `private ${meta.accessToken}`, code: 190 } }, { status }));
    const result = await getMusaPublishingCapability(account);
    expect(result).toEqual({ canPublish: false, publishUnavailableReason: "PERMISSIONS_UNAVAILABLE", supportedFormats: [] });
    expect(JSON.stringify(result)).not.toContain(meta.accessToken);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBe("GET");
  });
  it.each([
    {}, { data: [] }, { data: null },
    { data: [{ permission: "instagram_business_content_publish", status: "granted" }] },
    { data: [{ quota_usage: "2", config: { quota_total: 50 } }] },
    { data: [{ quota_usage: -1, config: { quota_total: 50 } }] },
    { data: [{ quota_usage: 0.5, config: { quota_total: 50 } }] },
    { data: [{ quota_usage: 2 }] },
    { data: [{ quota_usage: 2, config: {} }] },
    { data: [{ quota_usage: 2, config: { quota_total: "50" } }] },
    { data: [{ quota_usage: 2, config: { quota_total: -1 } }] },
    { data: [{ quota_usage: 2, config: { quota_total: 1.5 } }] },
  ])("rejects an invalid or missing quota response: %j", async (body) => {
    fetchMock.mockResolvedValue(Response.json(body));
    expect(await getMusaPublishingCapability(account)).toEqual({ canPublish: false, publishUnavailableReason: "PERMISSIONS_UNAVAILABLE", supportedFormats: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects an unreadable provider response", async () => {
    fetchMock.mockResolvedValue(new Response("not JSON", { status: 200 }));
    expect(await getMusaPublishingCapability(account)).toEqual({ canPublish: false, publishUnavailableReason: "PERMISSIONS_UNAVAILABLE", supportedFormats: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...account, accessToken: "" },
    { ...account, tokenExpiresAt: new Date(0) },
  ])("requires live stored credentials before any provider read", async (unavailableAccount) => {
    expect(await getMusaPublishingCapability(unavailableAccount)).toEqual({ canPublish: false, publishUnavailableReason: "RECONNECT_REQUIRED", supportedFormats: [] });
    expect(contextMock).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not call a provider if the stored credential cannot be decrypted", async () => {
    contextMock.mockRejectedValue(new Error(`private ${meta.accessToken}`));
    expect(await getMusaPublishingCapability(account)).toEqual({ canPublish: false, publishUnavailableReason: "PERMISSIONS_UNAVAILABLE", supportedFormats: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not advertise unavailable permissions as working", async () => {
    fetchMock.mockRejectedValue(new Error("upstream unavailable"));
    expect(await getMusaPublishingCapability(account)).toEqual({ canPublish: false, publishUnavailableReason: "PERMISSIONS_UNAVAILABLE", supportedFormats: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("stays closed when its two-second signal aborts without retrying", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    let started!: () => void;
    const fetching = new Promise<void>((resolve) => { started = resolve; });
    fetchMock.mockImplementation((_url: string, options: RequestInit) => {
      started();
      return new Promise((_resolve, reject) => {
        options.signal!.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
      });
    });
    const capability = getMusaPublishingCapability(account);
    await fetching;
    controller.abort(new DOMException("private timeout", "TimeoutError"));
    expect(await capability).toEqual({ canPublish: false, publishUnavailableReason: "PERMISSIONS_UNAVAILABLE", supportedFormats: [] });
    expect(timeout).toHaveBeenCalledExactlyOnceWith(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("uses Zernio's token validity and canPost capability", async () => {
    contextMock.mockResolvedValue(zernio);
    fetchMock.mockResolvedValue(Response.json({ tokenStatus: { valid: true }, permissions: { canPost: false } }));
    expect(await getMusaPublishingCapability({ ...account, provider: "ZERNIO", zernioAccountId: "remote-a" })).toEqual({ canPublish: false, publishUnavailableReason: "PUBLISH_PERMISSION_REQUIRED", supportedFormats: [] });
  });
});

describe("exact Meta container confirmation", () => {
  it("queries the saved container once with GET and no body", async () => {
    fetchMock.mockResolvedValue(Response.json({ id: "container-a", status_code: "PUBLISHED" }));
    expect(await metaContainerStatus(meta, "container-a")).toBe("PUBLISHED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://graph.instagram.com/v25.0/container-a?fields=status_code");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "GET", cache: "no-store" });
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  });
  it.each([
    { id: "other-container", status_code: "PUBLISHED" },
    { status_code: "PUBLISHED" },
    { id: "container-a", status_code: "UNKNOWN" },
  ])("rejects an unknown status or a different/missing container ID: %j", async body => {
    fetchMock.mockResolvedValue(Response.json(body));
    await expect(metaContainerStatus(meta, "container-a")).rejects.toMatchObject({
      code: "PROVIDER_INVALID_RESPONSE", ambiguous: false,
    });
  });
  it("keeps the same deadline while reading the response body", async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    let reading!: () => void;
    const started = new Promise<void>(resolve => { reading = resolve; });
    fetchMock.mockResolvedValue({ ok: true, json: () => { reading(); return new Promise(() => {}); } });
    const request = publicationProviderRequest(meta, "/ig-a/media_publish", { method: "POST" });
    await started;
    controller.abort(new DOMException("private body timeout", "TimeoutError"));
    await expect(request).rejects.toMatchObject({ code: "PROVIDER_UNREACHABLE", ambiguous: true });
  });
});
