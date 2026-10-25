import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { MusaPublication } from "@/app/generated/prisma/client";
import type { MusaConnectionContext } from "@/lib/integrations/musa/auth";
import type { MusaPublicationInput } from "@/lib/integrations/musa/publications-policy";

const mocks = vi.hoisted(() => ({
  receipt: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  transaction: vi.fn(), context: vi.fn(), capability: vi.fn(), child: vi.fn(), parent: vi.fn(),
  single: vi.fn(), poll: vi.fn(), quota: vi.fn(), publish: vi.fn(), permalink: vi.fn(),
  zernio: vi.fn(), zernioGet: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ prisma: { musaPublication: mocks.receipt, $transaction: mocks.transaction } }));
vi.mock("@/lib/instagram/context", () => ({ createInstagramContext: mocks.context }));
vi.mock("@/lib/integrations/musa/publications-capabilities", () => ({ getMusaPublishingCapability: mocks.capability }));
vi.mock("@/lib/integrations/musa/publications-provider", async original => ({
  ...await original<typeof import("@/lib/integrations/musa/publications-provider")>(),
  createMetaContainer: mocks.single, createMetaCarouselChild: mocks.child, createMetaCarouselContainer: mocks.parent,
  metaContainerStatus: mocks.poll, metaPublishingQuota: mocks.quota, publishMetaContainer: mocks.publish,
  metaMediaPermalink: mocks.permalink, createZernioPublication: mocks.zernio, getZernioPublication: mocks.zernioGet,
}));
import { advanceMusaPublication, getMusaPublication } from "@/lib/integrations/musa/publications";
import { MusaProviderError } from "@/lib/integrations/musa/publications-provider";
import { publicationPayloadHash } from "@/lib/integrations/musa/publications-policy";

const id = "320c1b61-061c-4d0b-8dac-e0be8a51b5fb", now = new Date("2026-10-25T15:00:00Z");
const mediaItems = [
  { type: "image" as const, url: "https://cdn.example.com/first.jpg" },
  { type: "video" as const, url: "https://cdn.example.com/middle.mp4" },
  { type: "image" as const, url: "https://cdn.example.com/last.jpg" },
];
const carousel = { accountId: "account-a", caption: "Mixto", format: "carousel" as const, mediaItems };
const image = { ...carousel, format: "image" as const, mediaItems: [mediaItems[0]] };
const context = { connectionId: "grant-a", workspaceId: "workspace-a", allowedInstagramAccountIds: ["account-a"],
  connection: { businessId: "business-a" }, accounts: [{ id: "account-a", workspaceId: "workspace-a",
    instagramId: "ig-a", provider: "META", accessToken: "fixture", zernioAccountId: null }],
} as unknown as MusaConnectionContext;
let row: MusaPublication;
function seed(payload: MusaPublicationInput = carousel, extra: Partial<MusaPublication> = {}) {
  row = { id: "receipt-a", connectionId: context.connectionId, workspaceId: context.workspaceId, publicationId: id,
    accountId: "account-a", provider: "META", payloadHash: publicationPayloadHash(payload), payload,
    status: "processing", stage: "PREPARE", campaignId: null, campaignUpdatedAt: null, containerId: null,
    childContainerIds: [], confirmationContainerId: null, providerPostId: null, providerScheduledAt: null,
    mediaId: null, permalink: null, errorCode: null, leaseToken: null, leaseUntil: null, nextAttemptAt: null,
    attemptStartedAt: null, publishedAt: null, createdAt: now, updatedAt: now, ...extra };
}
function matches(where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "AND") return (value as Record<string, unknown>[]).every(matches);
    if (key === "OR") return (value as Record<string, unknown>[]).some(matches);
    const saved = row[key as keyof MusaPublication];
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if ("lte" in value) return saved instanceof Date && saved <= (value.lte as Date);
      if ("in" in value) return (value.in as unknown[]).includes(saved);
    }
    return value === undefined || (value instanceof Date && saved instanceof Date ? +value === +saved : value === saved);
  });
}
const providerCalls = () => [mocks.capability, mocks.child, mocks.parent, mocks.single, mocks.poll,
  mocks.quota, mocks.publish, mocks.permalink, mocks.zernio, mocks.zernioGet].reduce((n, mock) => n + mock.mock.calls.length, 0);
async function step(payload: MusaPublicationInput = carousel, currentContext = context) {
  vi.setSystemTime(Date.now() + 61_000); const before = providerCalls();
  const result = await advanceMusaPublication(currentContext, id, payload);
  expect(providerCalls() - before).toBeLessThanOrEqual(1);
  return result;
}
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); seed();
  mocks.receipt.findFirst.mockImplementation(async ({ where }) => matches(where) ? { ...row } : null);
  mocks.receipt.findUnique.mockImplementation(async () => ({ ...row }));
  mocks.receipt.updateMany.mockImplementation(async ({ where, data }) => {
    if (!matches(where)) return { count: 0 }; row = { ...row, ...data }; return { count: 1 };
  });
  mocks.transaction.mockImplementation(async run => run({ musaPublication: mocks.receipt }));
  mocks.context.mockResolvedValue({ provider: "META", accessToken: "fixture" });
  mocks.capability.mockResolvedValue({ canPublish: true, publishUnavailableReason: null, supportedFormats: ["reel", "image", "carousel"] });
  mocks.child.mockImplementation(async () => `child-${row.childContainerIds.length + 1}`);
  mocks.parent.mockResolvedValue("parent-a"); mocks.single.mockResolvedValue("image-a"); mocks.poll.mockResolvedValue("FINISHED");
  mocks.quota.mockResolvedValue(true); mocks.publish.mockResolvedValue("media-a"); mocks.permalink.mockResolvedValue("https://www.instagram.com/p/confirmed/");
});
afterEach(() => vi.useRealTimers());

describe("durable mixed carousel publication", () => {
  it("finishes every ordered child, publishes exactly the parent, and performs at most one provider operation per step", async () => {
    for (let n = 0; n < 20 && row.status === "processing"; n++) await step();
    expect(row).toMatchObject({ status: "published", containerId: "parent-a", childContainerIds: ["child-1", "child-2", "child-3"], mediaId: "media-a" });
    expect(mocks.child.mock.calls.map(call => call[2])).toEqual(mediaItems);
    expect(mocks.poll.mock.calls.map(call => call[1])).toEqual(["child-1", "child-2", "child-3", "parent-a"]);
    expect(mocks.parent).toHaveBeenCalledExactlyOnceWith(expect.anything(), "ig-a", "Mixto", ["child-1", "child-2", "child-3"]);
    expect(mocks.publish).toHaveBeenCalledExactlyOnceWith(expect.anything(), "ig-a", "parent-a");
    await step(); expect(mocks.publish).toHaveBeenCalledTimes(1);
  });
  it("resumes a persisted child after restart and waits without creating the next child", async () => {
    seed(carousel, { stage: "META_CHILD_PROCESSING", childContainerIds: ["child-1", "child-2"] });
    mocks.poll.mockResolvedValueOnce("IN_PROGRESS");
    await step(); await advanceMusaPublication(context, id, carousel);
    expect(mocks.poll).toHaveBeenCalledTimes(1); expect(mocks.child).not.toHaveBeenCalled();
    await step(); expect(row.stage).toBe("READY"); await step();
    expect(mocks.child).toHaveBeenCalledExactlyOnceWith(expect.anything(), "ig-a", mediaItems[2]);
  });
  it("a crash or ambiguous child write never repeats a POST", async () => {
    seed(carousel, { stage: "META_CHILD_CREATING", childContainerIds: ["child-1"] });
    expect((await step()).status).toBe("uncertain"); await step();
    expect(mocks.child).not.toHaveBeenCalled(); expect(mocks.parent).not.toHaveBeenCalled();
  });
  it("a lost child response stays uncertain and retains its known children", async () => {
    seed(carousel, { stage: "READY", childContainerIds: ["child-1"] });
    mocks.child.mockRejectedValue(new MusaProviderError("PROVIDER_UNREACHABLE", true, true));
    expect((await step()).status).toBe("uncertain"); await step();
    expect(row.childContainerIds).toEqual(["child-1"]); expect(mocks.child).toHaveBeenCalledTimes(1);
  });
  it("retries a definite parent rate limit at the parent step without recreating children", async () => {
    seed(carousel, { stage: "META_PARENT_READY", childContainerIds: ["child-1", "child-2", "child-3"] });
    mocks.parent.mockRejectedValueOnce(new MusaProviderError("PROVIDER_RATE_LIMIT", false, true));
    await step(); expect(row.stage).toBe("META_PARENT_READY"); await step();
    expect(mocks.parent).toHaveBeenCalledTimes(2); expect(mocks.child).not.toHaveBeenCalled();
  });
  it.each(["ERROR", "EXPIRED", "PUBLISHED"])("a child with %s cannot publish or confirm the parent", async status => {
    seed(carousel, { stage: "META_CHILD_PROCESSING", childContainerIds: ["child-1"] });
    mocks.poll.mockResolvedValue(status); expect((await step()).status).toBe("failed");
    expect(row.confirmationContainerId).toBeNull(); expect(mocks.publish).not.toHaveBeenCalled(); expect(mocks.parent).not.toHaveBeenCalled();
  });
  it("the exact parent receipt recovers a lost publish response, preserving PR3 proof", async () => {
    seed(carousel, { status: "uncertain", stage: "META_PUBLISHING", containerId: "parent-a", childContainerIds: ["child-1", "child-2", "child-3"] });
    mocks.poll.mockResolvedValue("PUBLISHED");
    expect(await getMusaPublication(context, id)).toMatchObject({ status: "published", mediaId: null,
      confirmation: { source: "meta_container", containerId: "parent-a", status: "PUBLISHED" } });
    expect(mocks.poll).toHaveBeenCalledExactlyOnceWith(expect.anything(), "parent-a"); expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("never reads a saved child masquerading as the publication parent", async () => {
    seed(carousel, { status: "uncertain", stage: "META_PUBLISHING", containerId: "child-1", childContainerIds: ["child-1"] });
    expect((await getMusaPublication(context, id)).status).toBe("uncertain"); expect(mocks.poll).not.toHaveBeenCalled();
  });
  it("leases concurrent child creation so only one request reaches Meta", async () => {
    seed(carousel, { stage: "READY" }); let release!: (value: string) => void; let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    mocks.child.mockImplementation(() => { entered(); return new Promise<string>(resolve => { release = resolve; }); });
    const first = advanceMusaPublication(context, id, carousel); await started;
    await advanceMusaPublication(context, id, carousel); expect(mocks.child).toHaveBeenCalledTimes(1);
    release("child-1"); await first; expect(row.childContainerIds).toEqual(["child-1"]);
  });
  it("rejects changes of order under the same UUID before any provider call", async () => {
    await expect(step({ ...carousel, mediaItems: [...mediaItems].reverse() })).rejects.toMatchObject({ status: 409 });
    expect(providerCalls()).toBe(0);
  });
});

describe("format capabilities and image delivery", () => {
  it("publishes an image through the existing readiness/quota/receipt flow", async () => {
    seed(image); for (let n = 0; n < 10 && row.status === "processing"; n++) await step(image);
    expect(row.status).toBe("published"); expect(mocks.single).toHaveBeenCalledExactlyOnceWith(expect.anything(), "ig-a", image);
    expect(mocks.child).not.toHaveBeenCalled(); expect(mocks.publish).toHaveBeenCalledExactlyOnceWith(expect.anything(), "ig-a", "image-a");
  });
  it("an old capability without supportedFormats never enables a new format", async () => {
    mocks.capability.mockResolvedValue({ canPublish: true, publishUnavailableReason: null });
    expect(await step()).toMatchObject({ status: "failed", errorCode: "FORMAT_UNAVAILABLE" }); expect(mocks.child).not.toHaveBeenCalled();
  });
});
