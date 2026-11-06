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
