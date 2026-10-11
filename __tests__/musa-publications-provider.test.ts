import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const contextMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/instagram/context", () => ({ createInstagramContext: contextMock }));
import { getMusaPublishingCapability } from "@/lib/integrations/musa/publications-capabilities";
import { createMetaContainer, createZernioPublication, publicationProviderRequest, readZernioPublication } from "@/lib/integrations/musa/publications-provider";

const fetchMock = vi.fn();
const meta = { provider: "META" as const, accessToken: "test-token-never-real" };
const zernio = { provider: "ZERNIO" as const, accountId: "remote-a", instagramId: "ig-a", apiKey: "test-key-never-real" };
const account = { provider: "META" as const, accessToken: "encrypted-fixture", workspaceId: "workspace-a", instagramId: "ig-a", zernioAccountId: null };
const input = { accountId: "account-a", caption: "QA", videoUrl: "https://cdn.example.com/a.mp4", coverUrl: "https://cdn.example.com/cover.jpg" };
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", fetchMock); contextMock.mockResolvedValue(meta); });
afterEach(() => vi.unstubAllGlobals());

describe("publication provider boundary", () => {
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
  it("requires a granted publication scope, not just a connected token", async () => {
    fetchMock.mockResolvedValue(Response.json({ data: [{ permission: "instagram_business_basic", status: "granted" }] }));
    expect(await getMusaPublishingCapability(account)).toEqual({ canPublish: false, publishUnavailableReason: "PUBLISH_PERMISSION_REQUIRED" });
  });
  it("accepts both granted Meta scopes", async () => {
    fetchMock.mockResolvedValue(Response.json({ data: ["instagram_business_basic", "instagram_business_content_publish"].map((permission) => ({ permission, status: "granted" })) }));
    expect(await getMusaPublishingCapability(account)).toEqual({ canPublish: true, publishUnavailableReason: null });
  });
  it("does not advertise unavailable permissions as working", async () => {
    fetchMock.mockRejectedValue(new Error("upstream unavailable"));
    expect(await getMusaPublishingCapability(account)).toEqual({ canPublish: false, publishUnavailableReason: "PERMISSIONS_UNAVAILABLE" });
  });
  it("uses Zernio's token validity and canPost capability", async () => {
    contextMock.mockResolvedValue(zernio);
    fetchMock.mockResolvedValue(Response.json({ tokenStatus: { valid: true }, permissions: { canPost: false } }));
    expect(await getMusaPublishingCapability({ ...account, provider: "ZERNIO", zernioAccountId: "remote-a" })).toEqual({ canPublish: false, publishUnavailableReason: "PUBLISH_PERMISSION_REQUIRED" });
  });
});
