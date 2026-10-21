import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { MusaPublication } from "@/app/generated/prisma/client";
import type { MusaConnectionContext } from "@/lib/integrations/musa/auth";

const mocks = vi.hoisted(() => ({
  receipt: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  campaign: { findFirst: vi.fn(), updateMany: vi.fn() }, transaction: vi.fn(), context: vi.fn(), capability: vi.fn(),
  createMeta: vi.fn(), pollMeta: vi.fn(), quota: vi.fn(), publishMeta: vi.fn(), permalink: vi.fn(),
  createZernio: vi.fn(), pollZernio: vi.fn(), readZernio: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ prisma: { musaPublication: mocks.receipt, automation: mocks.campaign, $transaction: mocks.transaction } }));
vi.mock("@/lib/instagram/context", () => ({ createInstagramContext: mocks.context }));
vi.mock("@/lib/integrations/musa/publications-capabilities", () => ({ getMusaPublishingCapability: mocks.capability }));
vi.mock("@/lib/integrations/musa/publications-provider", async (original) => ({
  ...await original<typeof import("@/lib/integrations/musa/publications-provider")>(),
  createMetaContainer: mocks.createMeta, metaContainerStatus: mocks.pollMeta, metaPublishingQuota: mocks.quota,
  publishMetaContainer: mocks.publishMeta, metaMediaPermalink: mocks.permalink,
  createZernioPublication: mocks.createZernio, getZernioPublication: mocks.pollZernio, readZernioPublication: mocks.readZernio,
}));
import { advanceMusaPublication, getMusaPublication } from "@/lib/integrations/musa/publications";
import { MusaProviderError } from "@/lib/integrations/musa/publications-provider";
import { isMusaCampaignAttachable, musaPublicationInputSchema, publicationPayloadHash } from "@/lib/integrations/musa/publications-policy";

const publicationId = "320c1b61-061c-4d0b-8dac-e0be8a51b5fb";
const input = { accountId: "account-a", caption: "Video del cliente", videoUrl: "https://cdn.example.com/video.mp4" };
const baseTime = new Date("2026-10-11T15:00:00Z");
const context = { connectionId: "grant-a", workspaceId: "workspace-a", allowedInstagramAccountIds: ["account-a"],
  connection: { businessId: "business-a" }, accounts: [{ id: "account-a", workspaceId: "workspace-a",
    instagramId: "ig-a", provider: "META", accessToken: "encrypted", zernioAccountId: null }],
} as unknown as MusaConnectionContext;
let stored: MusaPublication | null;
function record(extra: Partial<MusaPublication> = {}): MusaPublication {
  return { id: "receipt-a", connectionId: context.connectionId, workspaceId: context.workspaceId, publicationId,
    accountId: input.accountId, provider: "META", payloadHash: publicationPayloadHash(input), payload: input,
    status: "processing", stage: "READY", campaignId: null, campaignUpdatedAt: null, containerId: null, confirmationContainerId: null,
    providerPostId: null, providerScheduledAt: null, mediaId: null, permalink: null, errorCode: null,
    leaseToken: null, leaseUntil: null, nextAttemptAt: null, attemptStartedAt: null,
    publishedAt: null, createdAt: baseTime, updatedAt: baseTime, ...extra };
}
function matches(where: Record<string, unknown>, row: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "AND") return (value as Record<string, unknown>[]).every((part) => matches(part, row));
    if (key === "OR") return (value as Record<string, unknown>[]).some((part) => matches(part, row));
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if ("lte" in value) return row[key] instanceof Date && row[key] <= (value.lte as Date);
      if ("in" in value) return (value.in as unknown[]).includes(row[key]);
    }
    return value === undefined || (value instanceof Date && row[key] instanceof Date
      ? value.getTime() === row[key].getTime() : row[key] === value);
  });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(baseTime); stored = null;
  mocks.receipt.findFirst.mockImplementation(async ({ where }) => stored && matches(where, stored) ? { ...stored } : null);
  mocks.receipt.findUnique.mockImplementation(async () => stored && { ...stored });
  mocks.receipt.create.mockImplementation(async ({ data }) => {
    if (stored) throw { code: "P2002" };
    stored = record({ stage: "PREPARE", ...data }); return { ...stored };
  });
  mocks.receipt.updateMany.mockImplementation(async ({ where, data }) => {
    if (!stored || !matches(where, stored)) return { count: 0 };
    stored = { ...stored, ...data }; return { count: 1 };
  });
  mocks.transaction.mockImplementation(async (run) => run({ musaPublication: mocks.receipt, automation: mocks.campaign, $queryRaw: vi.fn() }));
  mocks.context.mockResolvedValue({ provider: "META", accessToken: "never-sent" });
  mocks.capability.mockResolvedValue({ canPublish: true, publishUnavailableReason: null });
  mocks.createMeta.mockResolvedValue("container-a"); mocks.pollMeta.mockResolvedValue("FINISHED");
  mocks.quota.mockResolvedValue(true); mocks.publishMeta.mockResolvedValue("media-a");
  mocks.permalink.mockResolvedValue("https://www.instagram.com/reel/confirmed/");
  mocks.campaign.updateMany.mockResolvedValue({ count: 1 });
});
afterEach(() => vi.useRealTimers());

describe("durable MUSA publication", () => {
  it("never accepts an account outside the grant", async () => {
    await expect(advanceMusaPublication(context, publicationId, { ...input, accountId: "other" })).rejects.toMatchObject({ status: 403 });
    expect(mocks.receipt.create).not.toHaveBeenCalled();
  });
  it("reserves once and rejects changed content under the same UUID", async () => {
    await advanceMusaPublication(context, publicationId, input);
    await expect(advanceMusaPublication(context, publicationId, { ...input, caption: "Changed" })).rejects.toMatchObject({ status: 409 });
    expect(mocks.createMeta).not.toHaveBeenCalled();
  });
  it("two overlapping calls allow only one remote write", async () => {
    stored = record();
    let release!: (id: string) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    mocks.createMeta.mockImplementation(() => { entered(); return new Promise<string>((resolve) => { release = resolve; }); });
    const first = advanceMusaPublication(context, publicationId, input);
    await started;
    const second = await advanceMusaPublication(context, publicationId, input);
    expect(second.status).toBe("processing"); expect(mocks.createMeta).toHaveBeenCalledTimes(1);
    release("container-a"); await first;
    expect(stored?.containerId).toBe("container-a");
  });
  it("a worker crash after a publication marker cannot repeat media_publish", async () => {
    stored = record({ stage: "META_PUBLISHING", containerId: "container-a", leaseUntil: new Date(baseTime.getTime() - 1) });
    expect((await advanceMusaPublication(context, publicationId, input)).status).toBe("uncertain");
    await advanceMusaPublication(context, publicationId, input);
    expect(mocks.publishMeta).not.toHaveBeenCalled();
  });
  it("a lost publication response remains uncertain on repeated calls", async () => {
    stored = record({ stage: "META_READY", containerId: "container-a" });
    mocks.publishMeta.mockRejectedValue(new MusaProviderError("PROVIDER_UNREACHABLE", true, true));
    expect((await advanceMusaPublication(context, publicationId, input)).status).toBe("uncertain");
    await advanceMusaPublication(context, publicationId, input);
    expect(mocks.publishMeta).toHaveBeenCalledTimes(1);
  });
  it("does not publish before media is ready or before retry time", async () => {
    stored = record({ stage: "META_PROCESSING", containerId: "container-a" });
    mocks.pollMeta.mockResolvedValue("IN_PROGRESS");
    expect((await advanceMusaPublication(context, publicationId, input)).retryAfterSeconds).toBe(60);
    await advanceMusaPublication(context, publicationId, input);
    expect(mocks.pollMeta).toHaveBeenCalledTimes(1); expect(mocks.publishMeta).not.toHaveBeenCalled();
  });
  it("polls quota instead of assuming a fixed daily allowance", async () => {
    stored = record({ stage: "META_QUOTA", containerId: "container-a" }); mocks.quota.mockResolvedValue(false);
    expect(await advanceMusaPublication(context, publicationId, input)).toMatchObject({ status: "processing", errorCode: "PUBLISHING_QUOTA_REACHED", retryAfterSeconds: 300 });
    expect(mocks.publishMeta).not.toHaveBeenCalled();
  });
  it("keeps a confirmed post published when campaign binding conflicts", async () => {
    stored = record({ stage: "FINALIZE", mediaId: "media-a", campaignId: "campaign-a", campaignUpdatedAt: baseTime });
    mocks.campaign.updateMany.mockResolvedValue({ count: 0 });
    const result = await advanceMusaPublication(context, publicationId, input);
    expect(result).toMatchObject({ status: "published", mediaId: "media-a", errorCode: "CAMPAIGN_BINDING_CONFLICT" });
    await advanceMusaPublication(context, publicationId, input);
    expect(mocks.publishMeta).not.toHaveBeenCalled();
  });
  it("binds only the confirmed exact ID, clears next-reel and preserves pause", async () => {
    stored = record({ stage: "FINALIZE", mediaId: "media-a", campaignId: "campaign-a", campaignUpdatedAt: baseTime });
    await advanceMusaPublication(context, publicationId, input);
    expect(mocks.campaign.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ isActive: false, postId: null, workspaceId: "workspace-a", instagramAccountId: "account-a", updatedAt: baseTime }),
      data: { postId: "media-a", postUrl: "https://www.instagram.com/reel/confirmed/", pendingNextReel: false, nextReelArmedAt: null },
    }));
  });
  it("rejects active next-reel campaigns before making an external write", async () => {
    mocks.campaign.findFirst.mockResolvedValue({ isActive: true, postId: null, matchAnyPost: false, dmTriggerEnabled: false });
    await expect(advanceMusaPublication(context, publicationId, { ...input, campaignId: "campaign-a" })).rejects.toMatchObject({ status: 409 });
    expect(mocks.createMeta).not.toHaveBeenCalled();
  });
  it("GET reads the receipt without advancing or publishing", async () => {
    stored = record({ stage: "META_READY", containerId: "container-a" });
    expect((await getMusaPublication(context, publicationId)).status).toBe("processing");
    expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.publishMeta).not.toHaveBeenCalled();
  });
  it("GET cannot cross a connection boundary", async () => {
    stored = record();
    await expect(getMusaPublication({ ...context, connectionId: "other" }, publicationId)).rejects.toMatchObject({ status: 404 });
  });
  it("retries Zernio with the same durable key and schedule within its idempotency window", async () => {
    const zernioContext = { ...context, accounts: context.accounts.map((a) => ({ ...a, provider: "ZERNIO" as const, zernioAccountId: "remote-a" })) };
    stored = record({ provider: "ZERNIO" });
    mocks.context.mockResolvedValue({ provider: "ZERNIO", accountId: "remote-a", apiKey: "never-sent", instagramId: "ig-a" });
    mocks.createZernio.mockRejectedValueOnce(new MusaProviderError("PROVIDER_UNREACHABLE", true, true)).mockResolvedValueOnce({ post: { _id: "remote-post-a" } });
    expect((await advanceMusaPublication(zernioContext, publicationId, input)).status).toBe("processing");
    vi.setSystemTime(new Date(baseTime.getTime() + 61_000));
    await advanceMusaPublication(zernioContext, publicationId, input);
    expect(mocks.createZernio.mock.calls[0][2]).toBe(publicationId);
    expect(mocks.createZernio.mock.calls[1][2]).toBe(publicationId);
    expect(mocks.createZernio.mock.calls[0][3]).toEqual(mocks.createZernio.mock.calls[1][3]);
    expect(stored?.providerPostId).toBe("remote-post-a");
  });
  it("never retries Zernio creation after its idempotency guarantee expires", async () => {
    const zernioContext = { ...context, accounts: context.accounts.map((a) => ({ ...a, provider: "ZERNIO" as const })) };
    stored = record({ provider: "ZERNIO", stage: "ZERNIO_CREATING", attemptStartedAt: new Date(baseTime.getTime() - 24 * 3600_000) });
    mocks.context.mockResolvedValue({ provider: "ZERNIO", accountId: "remote-a" });
    expect((await advanceMusaPublication(zernioContext, publicationId, input)).status).toBe("uncertain");
    expect(mocks.createZernio).not.toHaveBeenCalled();
  });
  it("keeps Zernio outcome uncertain when access to a dispatched post is lost", async () => {
    const zernioContext = { ...context, accounts: context.accounts.map((a) => ({ ...a, provider: "ZERNIO" as const })) };
    stored = record({ provider: "ZERNIO", stage: "ZERNIO_PROCESSING", providerPostId: "remote-post-a", campaignId: "campaign-a" });
    mocks.context.mockResolvedValue({ provider: "ZERNIO", accountId: "remote-a" });
    mocks.pollZernio.mockRejectedValue(new MusaProviderError("RECONNECT_REQUIRED"));
    expect((await advanceMusaPublication(zernioContext, publicationId, input)).status).toBe("uncertain");
    expect(stored?.campaignId).toBe("campaign-a");
    expect(mocks.createZernio).not.toHaveBeenCalled();
  });
  it("releases a campaign reservation only after a definite pre-publication failure", async () => {
    stored = record({ stage: "META_PROCESSING", containerId: "container-a", campaignId: "campaign-a" });
    mocks.pollMeta.mockResolvedValue("ERROR");
    expect((await advanceMusaPublication(context, publicationId, input)).status).toBe("failed");
    expect(stored?.campaignId).toBeNull();
    expect(mocks.publishMeta).not.toHaveBeenCalled();
  });
});

describe("publication policy", () => {
  it("allows a paused next-reel draft without activating it", () => {
    expect(isMusaCampaignAttachable({ isActive: false, postId: null, matchAnyPost: false, dmTriggerEnabled: false })).toBe(true);
  });
  it.each(["http://cdn.example.com/a.mp4", "https://localhost/a.mp4", "https://127.0.0.1/a.mp4", "https://[::1]/a.mp4", "https://user:pass@cdn.example.com/a.mp4"])("rejects unsafe media URL %s", (videoUrl) => {
    expect(musaPublicationInputSchema.safeParse({ ...input, videoUrl }).success).toBe(false);
  });
});

describe("safe receipt reconciliation", () => {
  it("recovers a lost publish response from the exact container, with one POST total", async () => {
    stored = record({ stage: "META_READY", containerId: "container-a" });
    mocks.publishMeta.mockRejectedValue(new MusaProviderError("PROVIDER_UNREACHABLE", true, true));
    expect(await advanceMusaPublication(context, publicationId, input)).toMatchObject({ status: "uncertain" });
    mocks.pollMeta.mockResolvedValue("PUBLISHED");
    const result = await getMusaPublication(context, publicationId);
    expect(result).toMatchObject({ status: "published", mediaId: null, permalink: null, errorCode: null,
      confirmation: { source: "meta_container", containerId: "container-a", status: "PUBLISHED" } });
    await getMusaPublication(context, publicationId);
    await advanceMusaPublication(context, publicationId, input);
    expect(mocks.publishMeta).toHaveBeenCalledTimes(1);
    expect(mocks.createMeta).not.toHaveBeenCalled();
    expect(mocks.pollMeta).toHaveBeenCalledExactlyOnceWith(expect.anything(), "container-a");
  });
  it("does not query or steal an active publishing lease", async () => {
    stored = record({ stage: "META_PUBLISHING", containerId: "container-a", leaseToken: "active",
      leaseUntil: new Date(baseTime.getTime() + 30_000) });
    expect((await getMusaPublication(context, publicationId)).status).toBe("processing");
    expect(mocks.pollMeta).not.toHaveBeenCalled();
    expect(stored?.leaseToken).toBe("active");
    vi.setSystemTime(new Date(baseTime.getTime() + 31_000));
    mocks.pollMeta.mockResolvedValue("PUBLISHED");
    expect((await getMusaPublication(context, publicationId)).status).toBe("published");
    expect(mocks.publishMeta).not.toHaveBeenCalled();
  });
  it("a receipt cannot interfere with a PUT actively awaiting its publish response", async () => {
    stored = record({ stage: "META_READY", containerId: "container-a" });
    let release!: (id: string) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    mocks.publishMeta.mockImplementation(() => { entered(); return new Promise<string>(resolve => { release = resolve; }); });
    const publishing = advanceMusaPublication(context, publicationId, input);
    await started;
    expect((await getMusaPublication(context, publicationId)).status).toBe("processing");
    await advanceMusaPublication(context, publicationId, input);
    expect(mocks.pollMeta).not.toHaveBeenCalled();
    expect(mocks.publishMeta).toHaveBeenCalledTimes(1);
    release("media-a");
    expect((await publishing).status).toBe("processing");
    expect(mocks.permalink).not.toHaveBeenCalled();
    expect((await getMusaPublication(context, publicationId)).status).toBe("published");
    expect(mocks.publishMeta).toHaveBeenCalledTimes(1);
  });
  it("overlapping GET and PUT calls only make one remote read, never a publish", async () => {
    stored = record({ status: "uncertain", stage: "META_PUBLISHING", containerId: "container-a" });
    let release!: (status: string) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    mocks.pollMeta.mockImplementation(() => { entered(); return new Promise<string>(resolve => { release = resolve; }); });
    const first = getMusaPublication(context, publicationId);
    await started;
    expect((await getMusaPublication(context, publicationId)).status).toBe("uncertain");
    expect((await advanceMusaPublication(context, publicationId, input)).status).toBe("uncertain");
    release("PUBLISHED");
    expect((await first).status).toBe("published");
    expect(mocks.pollMeta).toHaveBeenCalledTimes(1);
    expect(mocks.publishMeta).not.toHaveBeenCalled();
    expect(mocks.createMeta).not.toHaveBeenCalled();
  });
  it("keeps campaign pause and reservation when its exact media ID is unavailable", async () => {
    stored = record({ status: "uncertain", stage: "META_PUBLISHING", containerId: "container-a",
      campaignId: "campaign-a", campaignUpdatedAt: baseTime });
    mocks.pollMeta.mockResolvedValue("PUBLISHED");
    expect(await getMusaPublication(context, publicationId)).toMatchObject({
      status: "published", mediaId: null, errorCode: "CAMPAIGN_BINDING_CONFLICT",
    });
    expect(stored?.campaignId).toBe("campaign-a");
    expect(mocks.campaign.updateMany).not.toHaveBeenCalled();
  });
  it.each(["FINISHED", "IN_PROGRESS", "ERROR", "EXPIRED"])("does not infer a publication from %s and respects cooldown", async status => {
    stored = record({ status: "uncertain", stage: "META_PUBLISHING", containerId: "container-a" });
    mocks.pollMeta.mockResolvedValue(status);
    expect((await getMusaPublication(context, publicationId)).status).toBe("uncertain");
    await getMusaPublication(context, publicationId);
    expect(mocks.pollMeta).toHaveBeenCalledTimes(1);
    expect(stored?.confirmationContainerId).toBeNull();
    expect(mocks.publishMeta).not.toHaveBeenCalled();
  });
  it("does not turn a failed or malformed read into published or failed", async () => {
    stored = record({ status: "uncertain", stage: "META_PUBLISHING", containerId: "container-a" });
    mocks.pollMeta.mockRejectedValue(new MusaProviderError("PROVIDER_INVALID_RESPONSE", false, true));
    expect(await getMusaPublication(context, publicationId)).toMatchObject({ status: "uncertain", errorCode: "PROVIDER_INVALID_RESPONSE" });
    expect(stored?.confirmationContainerId).toBeNull();
    vi.setSystemTime(new Date(baseTime.getTime() + 61_000));
    mocks.pollMeta.mockResolvedValue("PUBLISHED");
    expect((await getMusaPublication(context, publicationId)).status).toBe("published");
  });
  it("recovers an uncertain META_PROCESSING container without creating another", async () => {
    stored = record({ status: "uncertain", stage: "META_PROCESSING", containerId: "container-a" });
    mocks.pollMeta.mockResolvedValue("PUBLISHED");
    expect((await getMusaPublication(context, publicationId)).status).toBe("published");
    expect(mocks.createMeta).not.toHaveBeenCalled();
    expect(mocks.publishMeta).not.toHaveBeenCalled();
  });
  it("can finish a known media ID from GET without a publish", async () => {
    stored = record({ stage: "FINALIZE", mediaId: "media-a" });
    expect(await getMusaPublication(context, publicationId)).toMatchObject({
      status: "published", mediaId: "media-a", permalink: "https://www.instagram.com/reel/confirmed/",
    });
    expect(mocks.publishMeta).not.toHaveBeenCalled();
    expect(mocks.pollMeta).not.toHaveBeenCalled();
    expect(stored?.confirmationContainerId).toBeNull();
  });
  it("finishes a known exact media ID even if its optional permalink cannot be read", async () => {
    stored = record({ stage: "FINALIZE", mediaId: "media-a" });
    mocks.context.mockRejectedValue(new Error("credential unavailable"));
    expect(await getMusaPublication(context, publicationId)).toMatchObject({
      status: "published", mediaId: "media-a", permalink: null,
    });
    expect(mocks.publishMeta).not.toHaveBeenCalled();
  });
  it.each([
    { containerId: null }, { containerId: "../container" }, { stage: "META_CREATING" }, { status: "failed" },
  ])("never invents a missing or ineligible saved container: %j", async extra => {
    stored = record({ status: "uncertain", stage: "META_PUBLISHING", containerId: "container-a", ...extra });
    await getMusaPublication(context, publicationId);
    expect(mocks.pollMeta).not.toHaveBeenCalled();
    expect(mocks.publishMeta).not.toHaveBeenCalled();
  });
  it.each(["container", "known-media"])("preserves a committed publication if its DB response is lost: %s", async kind => {
    stored = kind === "container"
      ? record({ status: "uncertain", stage: "META_PUBLISHING", containerId: "container-a" })
      : record({ stage: "FINALIZE", mediaId: "media-a" });
    mocks.pollMeta.mockResolvedValue("PUBLISHED");
    const update = mocks.receipt.updateMany.getMockImplementation()!;
    mocks.receipt.updateMany.mockImplementation(async args => {
      const result = await update(args);
      if (args.data.status === "published") throw new Error("Lost DB commit response");
      return result;
    });
    expect((await getMusaPublication(context, publicationId)).status).toBe("published");
    expect(stored?.stage).toBe("DONE");
    expect(mocks.publishMeta).not.toHaveBeenCalled();
  });
  it("requires both workspace scope and granted account before reconciliation", async () => {
    stored = record({ status: "uncertain", stage: "META_PUBLISHING", containerId: "container-a" });
    await expect(getMusaPublication({ ...context, workspaceId: "other" }, publicationId)).rejects.toMatchObject({ status: 404 });
    await expect(getMusaPublication({ ...context, accounts: [] }, publicationId)).rejects.toMatchObject({ status: 403 });
    expect(mocks.pollMeta).not.toHaveBeenCalled();
  });
});
