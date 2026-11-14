import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { musaPublicationInputSchema, publicationPayloadHash } from "@/lib/integrations/musa/publications-policy";

const input = { accountId: "account-a", caption: "QA", videoUrl: "https://cdn.example.com/a.mp4" };
const flow = { flowId: "published-version-a", flowRevision: "a".repeat(64), activateOnPublish: true };
describe("MUSA trial and flow publication options", () => {
  it("preserves the exact historical legacy hash when new options are absent", () => {
    const expected = createHash("sha256").update(JSON.stringify({ accountId: input.accountId, caption: input.caption,
      videoUrl: input.videoUrl, coverUrl: null, campaignId: null })).digest("hex");
    expect(publicationPayloadHash(input)).toBe(expected);
  });
  it("preserves legacy hashes with a custom cover and modern hashes without the new options", () => {
    const coverUrl = "https://cdn.example.com/cover.jpg";
    const modern = { accountId: input.accountId, caption: input.caption, format: "reel" as const,
      mediaItems: [{ type: "video" as const, url: input.videoUrl }] };
    const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const legacyCoverHash = digest({ ...input, coverUrl, campaignId: null });
    const trialReel = { graduationStrategy: "MANUAL" as const };
    expect(publicationPayloadHash({ ...input, coverUrl })).toBe(legacyCoverHash);
    expect(publicationPayloadHash({ ...input, coverUrl, trialReel })).toBe(digest({ version: 3,
      originalHash: legacyCoverHash, trialReel, flowId: null, flowRevision: null, activateOnPublish: null }));
    expect(publicationPayloadHash(modern)).toBe(digest({ version: 2, ...modern, campaignId: null }));
  });
  it("includes frame zero, cover and exact catalog audio settings in the modern and legacy hashes", () => {
    const modern = { accountId: input.accountId, caption: input.caption, format: "reel" as const,
      mediaItems: [{ type: "video" as const, url: input.videoUrl }] };
    for (const base of [input, modern]) {
      const audioConfiguration = { audioId: "1234", audioVolume: 90, videoVolume: 0 };
      const payloads = [base, { ...base, thumbOffset: 0 }, { ...base, thumbOffset: 2000 },
        { ...base, coverUrl: "https://cdn.example.com/cover.jpg" },
        { ...base, thumbOffset: 0, audioConfiguration },
        { ...base, thumbOffset: 0, audioConfiguration: { ...audioConfiguration, audioId: "1235" } },
        { ...base, thumbOffset: 0, audioConfiguration: { ...audioConfiguration, audioVolume: 70 } }];
      const hashes = payloads.map((payload) => publicationPayloadHash(musaPublicationInputSchema.parse(payload)));
      expect(new Set(hashes).size).toBe(payloads.length);
    }
  });
  it.each([
    { thumbOffset: 1.5 }, { thumbOffset: -1 }, { thumbOffset: 0, coverUrl: "https://cdn.example.com/cover.jpg" },
    { audioConfiguration: { audioId: "../private", audioVolume: 90, videoVolume: 50 } },
    { audioConfiguration: { audioId: "1234", audioVolume: 90, videoVolume: 101 } },
  ])("rejects invalid frame or audio options: %j", (options) => {
    expect(musaPublicationInputSchema.safeParse({ ...input, ...options }).success).toBe(false);
  });
  it.each(["image", "carousel", "story"])("does not send Reel cover or audio options with a %s", (format) => {
    const image = { type: "image", url: "https://cdn.example.com/a.jpg" };
    const base = { accountId: input.accountId, caption: input.caption, format,
      mediaItems: format === "carousel" ? [image, image] : [image] };
    for (const options of [{ coverUrl: image.url }, { thumbOffset: 0 },
      { audioConfiguration: { audioId: "1234", audioVolume: 90, videoVolume: 0 } }]) {
      expect(musaPublicationInputSchema.safeParse({ ...base, ...options }).success).toBe(false);
    }
  });
  it("accepts trial with either legacy or modern single-Reel inputs", () => {
    expect(musaPublicationInputSchema.safeParse({ ...input, ...flow, trialReel: { graduationStrategy: "MANUAL" } }).success).toBe(true);
    expect(musaPublicationInputSchema.safeParse({ accountId: "a", caption: "", format: "reel",
      mediaItems: [{ type: "video", url: input.videoUrl }], trialReel: { graduationStrategy: "SS_PERFORMANCE" } }).success).toBe(true);
  });
  it.each([
    { flowId: "v" }, { flowRevision: "a".repeat(64) }, { activateOnPublish: true },
    { ...flow, activateOnPublish: false }, { ...flow, flowRevision: "not-a-revision" },
    { ...flow, campaignId: "campaign-a" }, { trialReel: {} }, { trialReel: { graduationStrategy: "AUTO" } },
    { trialReel: { graduationStrategy: "MANUAL", unknown: true } },
  ])("rejects incomplete, mixed or unsupported options: %j", options => {
    expect(musaPublicationInputSchema.safeParse({ ...input, ...options }).success).toBe(false);
  });
  it.each(["image", "carousel"])("does not silently turn trial %s into a normal publication", format => {
    const mediaItems = format === "image" ? [{ type: "image", url: "https://cdn.example.com/a.jpg" }]
      : [{ type: "image", url: "https://cdn.example.com/a.jpg" }, { type: "video", url: input.videoUrl }];
    expect(musaPublicationInputSchema.safeParse({ accountId: "a", caption: "", format, mediaItems,
      trialReel: { graduationStrategy: "MANUAL" } }).success).toBe(false);
  });
  it("changes idempotency hashes for strategy, flow identity and flow revision", () => {
    const manual = { ...input, ...flow, activateOnPublish: true as const, trialReel: { graduationStrategy: "MANUAL" as const } };
    const hashes = [input, manual, { ...manual, flowId: "another-version" }, { ...manual, flowRevision: "b".repeat(64) },
      { ...manual, trialReel: { graduationStrategy: "SS_PERFORMANCE" as const } }].map(publicationPayloadHash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});
