import { describe, expect, it } from "vitest";
import { musaPublicationInputSchema, publicationFormat, publicationMedia, publicationPayloadHash } from "@/lib/integrations/musa/publications-policy";

const image = { type: "image" as const, url: "https://cdn.example.com/a.jpg" };
const video = { type: "video" as const, url: "https://cdn.example.com/a.mp4" };
const legacy = { accountId: "account-a", caption: "QA", videoUrl: video.url };
const modern = { accountId: "account-a", caption: "QA", format: "carousel" as const, mediaItems: [image, video] };

describe("compatible multiformat publication policy", () => {
  it("preserves the exact historical legacy payload hash", () => {
    expect(publicationPayloadHash(legacy)).toBe("c6fc5c572c3157ec91e3d762a116f4df60d90316bb56796ffd47865be89c2460");
    expect(musaPublicationInputSchema.parse(legacy)).toEqual(legacy);
    expect(publicationFormat(legacy)).toBe("reel"); expect(publicationMedia(legacy)).toEqual([video]);
  });
  it.each([
    { ...modern, format: "reel", mediaItems: [video] },
    { ...modern, format: "image", mediaItems: [image] }, modern,
    { ...modern, mediaItems: [video, image, video] },
    { ...modern, mediaItems: Array.from({ length: 10 }, () => image) },
  ])("accepts a complete format and ordered mixed media: %j", input => {
    expect(musaPublicationInputSchema.parse(input)).toEqual(input);
  });
  it.each([
    { ...modern, format: "reel", mediaItems: [image] },
    { ...modern, format: "image", mediaItems: [video] },
    { ...modern, format: "image", mediaItems: [image, image] },
    { ...modern, mediaItems: [image] }, { ...modern, mediaItems: [] },
    { ...modern, mediaItems: Array.from({ length: 11 }, () => image) },
    { ...modern, mediaItems: [{ ...video, type: "audio" }] },
    { ...modern, mediaItems: [{ ...image, url: "http://cdn.example.com/a.jpg" }, video] },
    { ...modern, mediaItems: [{ ...image, url: "https://127.0.0.1/a.jpg" }, video] },
    { ...modern, mediaItems: [{ ...image, ignored: "field" }, video] },
    { ...modern, videoUrl: video.url }, { ...legacy, mediaItems: [video] },
    { ...modern, coverUrl: image.url }, { ...modern, format: "story" },
    { ...modern, caption: "a".repeat(2201) }, { ...modern, extra: true },
  ])("rejects invalid/ambiguous payloads without silently discarding fields: %j", input => {
    expect(musaPublicationInputSchema.safeParse(input).success).toBe(false);
  });
  it("preserves the legacy URL limit and bounds modern URLs to 2000 characters", () => {
    const url = "https://cdn.example.com/" + "a".repeat(2020);
    expect(musaPublicationInputSchema.safeParse({ ...legacy, videoUrl: url }).success).toBe(true);
    expect(musaPublicationInputSchema.safeParse({ ...modern, mediaItems: [{ ...image, url }, video] }).success).toBe(false);
  });
  it.each(["https://machine.local./a.jpg", "https://machine.internal./a.jpg", "https://machine.localhost./a.jpg"])(
    "rejects private suffixes with a trailing DNS dot: %s", url => {
      expect(musaPublicationInputSchema.safeParse({ ...legacy, videoUrl: url }).success).toBe(false);
      expect(musaPublicationInputSchema.safeParse({ ...modern, mediaItems: [{ ...image, url }, video] }).success).toBe(false);
    });
  it("hashes format, account, caption, media type, media order, URL and campaign", () => {
    const hash = publicationPayloadHash(modern);
    for (const changed of [
      { ...modern, caption: "Changed" }, { ...modern, accountId: "other" },
      { ...modern, campaignId: "campaign-a" }, { ...modern, mediaItems: [video, image] },
      { ...modern, mediaItems: [{ ...image, url: image.url + "?v=2" }, video] },
      { ...modern, mediaItems: [image, { ...video, type: "image" as const }] },
    ]) expect(publicationPayloadHash(changed)).not.toBe(hash);
    expect(publicationPayloadHash({ ...legacy })).toBe(publicationPayloadHash(legacy));
    expect(publicationPayloadHash({ ...modern, format: "reel", mediaItems: [video] })).not.toBe(publicationPayloadHash(legacy));
  });
});
