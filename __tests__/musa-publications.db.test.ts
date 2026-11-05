/** Opt in only against the dedicated local database, after prisma migrate deploy. */
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstagramAccount, Prisma } from "@/app/generated/prisma/client";
import type { MusaConnectionContext } from "@/lib/integrations/musa/auth";

const remote = vi.hoisted(() => ({ create: vi.fn(), child: vi.fn(), parent: vi.fn(), publish: vi.fn(), pollMeta: vi.fn(), capability: vi.fn(), context: vi.fn(), permalink: vi.fn() }));
vi.mock("@/lib/instagram/context", () => ({ createInstagramContext: remote.context }));
vi.mock("@/lib/integrations/musa/publications-capabilities", () => ({ getMusaPublishingCapability: remote.capability }));
vi.mock("@/lib/integrations/musa/publications-provider", async (original) => ({
  ...await original<typeof import("@/lib/integrations/musa/publications-provider")>(),
  createMetaContainer: remote.create, publishMetaContainer: remote.publish, metaContainerStatus: remote.pollMeta, metaMediaPermalink: remote.permalink,
  createMetaCarouselChild: remote.child, createMetaCarouselContainer: remote.parent,
}));
import { prisma } from "@/lib/db/client";
import { advanceMusaPublication, getMusaPublication } from "@/lib/integrations/musa/publications";
import { isCampaignReservedForMusaPublication } from "@/lib/integrations/musa/publications-reservation";
import { listMusaFlows, musaFlowRevision } from "@/lib/integrations/musa/flows";
import { createDefaultFlow } from "@/lib/flows/definition";
import { flowSource } from "./fixtures/musa-flow-source";

const databaseUrl = process.env.MUSA_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("MUSA publication concurrency on local Postgres", () => {
  let userId: string;
  let workspaceId: string;
  let account: InstagramAccount;
  let context: MusaConnectionContext;
  const body = () => ({ accountId: account.id, caption: "QA fixture — never sent", videoUrl: "https://cdn.example.com/qa.mp4" });
  const makeCampaign = () => prisma.automation.create({ data: {
    workspaceId, instagramAccountId: account.id, name: "QA publication draft", keywords: ["qa"],
    dmMessage: "Never sent", isActive: false, pendingNextReel: true,
  } });
  const makeFlow = async (targets: string[] = []) => {
    const source = await makeCampaign();
    const version = await prisma.flowVersion.create({ data: { workspaceId, automationId: source.id,
      version: 1, definition: (targets.length ? flowSource("fixture", targets).definition : createDefaultFlow()) as unknown as Prisma.InputJsonValue } });
    const automation = await prisma.automation.update({ where: { id: source.id },
      data: { flowPublishedVersionId: version.id, flowEnabled: true } });
    return { source: automation, payload: { ...body(), flowId: version.id,
      flowRevision: musaFlowRevision({ ...version, automation }), activateOnPublish: true as const } };
  };
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.hostname !== "127.0.0.1" || url.port !== "57322" || url.pathname !== "/openreply_musa_qa")
      throw new Error("Refusing a database outside the dedicated local MUSA QA instance");
    process.env.DATABASE_URL = databaseUrl;
    const user = await prisma.user.create({ data: { email: `qa-pub-${randomUUID()}@example.invalid` } });
    userId = user.id;
    const workspace = await prisma.workspace.create({ data: { name: "QA publications", ownerId: userId } });
    workspaceId = workspace.id;
    account = await prisma.instagramAccount.create({ data: { workspaceId, instagramId: `qa-${randomUUID()}`,
      username: "qa_never_connected", provider: "META", accessToken: "not-a-real-token" } });
    context = { connectionId: `qa-${randomUUID()}`, workspaceId, allowedInstagramAccountIds: [account.id],
      connection: { businessId: randomUUID() }, workspace, accounts: [account] } as unknown as MusaConnectionContext;
  });
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network is forbidden in publication tests"); }));
    remote.capability.mockResolvedValue({ canPublish: true, publishUnavailableReason: null, supportedFormats: ["reel", "image", "carousel"] });
    remote.context.mockResolvedValue({ provider: "META", accessToken: "not-real" });
    remote.create.mockResolvedValue("qa-container"); remote.publish.mockResolvedValue("qa-media");
    remote.pollMeta.mockResolvedValue("PUBLISHED");
    remote.permalink.mockResolvedValue("https://www.instagram.com/reel/qa-confirmed/");
  });
  afterAll(async () => {
    // Only these tests' rows are removed, releasing campaign guards first.
    if (workspaceId) await prisma.musaPublication.deleteMany({ where: { workspaceId } });
    if (userId) await prisma.user.delete({ where: { id: userId } });
    vi.unstubAllGlobals();
    await prisma.$disconnect();
  });

  it("claims one persistent lease for overlapping provider writes", async () => {
    const id = randomUUID(); await advanceMusaPublication(context, id, body());
    let release!: (value: string) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    remote.create.mockImplementation(() => { entered(); return new Promise<string>((resolve) => { release = resolve; }); });
    const first = advanceMusaPublication(context, id, body());
    await started;
    const second = await advanceMusaPublication(context, id, body());
    expect(second.status).toBe("processing"); expect(remote.create).toHaveBeenCalledTimes(1);
    release("qa-container"); await first;
    const saved = await prisma.musaPublication.findUniqueOrThrow({ where: { publicationId: id } });
    expect(saved.containerId).toBe("qa-container"); expect(saved.leaseToken).toBeNull();
  });
  it("reuses a published flow across independent Reels without retargeting or activating the source", async () => {
    const { source, payload } = await makeFlow();
    const ids = [randomUUID(), randomUUID()];
    await Promise.all(ids.map(id => advanceMusaPublication(context, id, payload)));
    const receipts = await prisma.musaPublication.findMany({ where: { publicationId: { in: ids } } });
    expect(new Set(receipts.map(row => row.campaignId)).size).toBe(2);
    for (const [index, row] of receipts.entries()) {
      expect(row.campaignId).not.toBe(source.id);
      const copy = await prisma.automation.findUniqueOrThrow({ where: { id: row.campaignId! } });
      expect(copy).toMatchObject({ isActive: false, flowEnabled: false, postId: null });
      await prisma.musaPublication.update({ where: { id: row.id }, data: { stage: "FINALIZE", mediaId: `qa-flow-media-${index}` } });
      expect(await advanceMusaPublication(context, row.publicationId, payload)).toMatchObject({ status: "published", automation: { status: "active" } });
      expect(await prisma.automation.findUniqueOrThrow({ where: { id: row.campaignId! } })).toMatchObject({
        isActive: true, flowEnabled: true, postId: `qa-flow-media-${index}`, pendingNextReel: false,
      });
      await advanceMusaPublication(context, row.publicationId, payload);
    }
    expect(await prisma.automation.findUniqueOrThrow({ where: { id: source.id } })).toMatchObject({
      postId: source.postId, isActive: source.isActive, flowPublishedVersionId: source.flowPublishedVersionId,
    });
    const catalog = await listMusaFlows(context, account.id);
    expect(catalog.flows.filter(flow => flow.name === source.name)).toHaveLength(1);
    expect(remote.publish).not.toHaveBeenCalled();
  });
  it("simultaneous retries of one UUID leave exactly one private flow copy", async () => {
    const { payload } = await makeFlow(); const id = randomUUID();
    const before = await prisma.automation.count({ where: { workspaceId } });
    await Promise.all([advanceMusaPublication(context, id, payload), advanceMusaPublication(context, id, payload)]);
    expect(await prisma.automation.count({ where: { workspaceId } })).toBe(before + 1);
    expect(await prisma.musaPublication.count({ where: { publicationId: id } })).toBe(1);
  });
  it("changed source settings cannot publish under a previously confirmed flow revision", async () => {
    const { source, payload } = await makeFlow();
    await prisma.automation.update({ where: { id: source.id }, data: { keywords: ["changed"] } });
    expect(await advanceMusaPublication(context, randomUUID(), payload)).toMatchObject({ status: "failed", errorCode: "FLOW_CHANGED",
      automation: { status: "failed", errorCode: "FLOW_CHANGED" } });
    expect(remote.create).not.toHaveBeenCalled(); expect(remote.publish).not.toHaveBeenCalled();
  });
  it("copies, reserves and activates a complete chain while protecting its private dependencies", async () => {
    const child = await makeFlow(); const root = await makeFlow([child.source.id]);
    const entry = (await listMusaFlows(context, account.id)).flows.find(flow => flow.id === root.payload.flowId)!;
    const payload = { ...root.payload, flowRevision: entry.revision }; const id = randomUUID();
    await advanceMusaPublication(context, id, payload);
    const receipt = await prisma.musaPublication.findUniqueOrThrow({ where: { publicationId: id } });
    expect(receipt.flowCampaignIds).toHaveLength(2);
    expect(receipt.flowCampaignIds).not.toContain(root.source.id); expect(receipt.flowCampaignIds).not.toContain(child.source.id);
    const childCopyId = receipt.flowCampaignIds.find(copyId => copyId !== receipt.campaignId)!;
    expect(await isCampaignReservedForMusaPublication(childCopyId, workspaceId)).toBe(true);
    await expect(prisma.automation.update({ where: { id: childCopyId }, data: { name: "Changed while reserved" } })).rejects.toThrow();
    await expect(prisma.automation.delete({ where: { id: childCopyId } })).rejects.toThrow();
    await expect(prisma.flowVersion.updateMany({ where: { automationId: childCopyId }, data: { definition: {} } })).rejects.toThrow();
    await expect(prisma.musaPublication.update({ where: { id: receipt.id }, data: { flowCampaignIds: [receipt.campaignId!] } })).rejects.toThrow();
    const rootCopy = await prisma.automation.findUniqueOrThrow({ where: { id: receipt.campaignId! } });
    const graph = rootCopy.flowDraft as unknown as { nodes: Array<{ type: string; data: { action?: string; automationId?: string } }> };
    expect(graph.nodes.find(node => node.type === "action" && node.data.action === "start_flow")?.data.automationId).toBe(childCopyId);
    await prisma.musaPublication.update({ where: { id: receipt.id }, data: { stage: "FINALIZE", mediaId: "chain-exact-media" } });
    expect(await advanceMusaPublication(context, id, payload)).toMatchObject({ status: "published", automation: { status: "active" } });
    const copies = await prisma.automation.findMany({ where: { id: { in: receipt.flowCampaignIds } } });
    copies.forEach(copy => expect(copy).toMatchObject({ isActive: true, flowEnabled: true, matchAnyPost: false, dmTriggerEnabled: false }));
    expect(copies.find(copy => copy.id === childCopyId)?.postId).toBeNull();
    expect(copies.find(copy => copy.id === receipt.campaignId)?.postId).toBe("chain-exact-media");
    expect((await prisma.automation.findUniqueOrThrow({ where: { id: root.source.id } })).isActive).toBe(root.source.isActive);
    expect((await prisma.automation.findUniqueOrThrow({ where: { id: child.source.id } })).isActive).toBe(child.source.isActive);
    expect(remote.publish).not.toHaveBeenCalled();
  });
  it("reserves one campaign atomically between different publication UUIDs", async () => {
    const campaign = await makeCampaign();
    const payload = { ...body(), campaignId: campaign.id };
    const results = await Promise.allSettled([
      advanceMusaPublication(context, randomUUID(), payload), advanceMusaPublication(context, randomUUID(), payload),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409 });
    expect(await prisma.musaPublication.count({ where: { campaignId: campaign.id } })).toBe(1);
  });
  it("the database blocks activation and next-reel retargeting while reserved", async () => {
    const campaign = await makeCampaign();
    await advanceMusaPublication(context, randomUUID(), { ...body(), campaignId: campaign.id });
    await expect(prisma.automation.update({ where: { id: campaign.id }, data: { isActive: true } })).rejects.toThrow();
    await expect(prisma.automation.update({ where: { id: campaign.id }, data: { postId: "wrong-reel", pendingNextReel: false } })).rejects.toThrow();
    await expect(prisma.automation.delete({ where: { id: campaign.id } })).rejects.toThrow();
    expect((await prisma.automation.findUniqueOrThrow({ where: { id: campaign.id } })).isActive).toBe(false);
  });
  it("binds the confirmed ID atomically and keeps the campaign paused", async () => {
    const campaign = await makeCampaign(); const id = randomUUID(); const payload = { ...body(), campaignId: campaign.id };
    await advanceMusaPublication(context, id, payload);
    await prisma.musaPublication.update({ where: { publicationId: id }, data: { stage: "FINALIZE", mediaId: "qa-exact-media" } });
    const result = await advanceMusaPublication(context, id, payload);
    expect(result).toMatchObject({ status: "published", mediaId: "qa-exact-media", errorCode: null });
    expect(await prisma.automation.findUniqueOrThrow({ where: { id: campaign.id } })).toMatchObject({
      postId: "qa-exact-media", pendingNextReel: false, isActive: false, nextReelArmedAt: null,
    });
    await prisma.automation.update({ where: { id: campaign.id }, data: { isActive: true } });
    await advanceMusaPublication(context, id, payload);
    expect(remote.publish).not.toHaveBeenCalled();
  });
  it("a changed draft does not overwrite its target after a confirmed publish", async () => {
    const campaign = await makeCampaign(); const id = randomUUID(); const payload = { ...body(), campaignId: campaign.id };
    await advanceMusaPublication(context, id, payload);
    await prisma.automation.update({ where: { id: campaign.id }, data: { name: "Changed while in flight" } });
    await prisma.musaPublication.update({ where: { publicationId: id }, data: { stage: "FINALIZE", mediaId: "qa-confirmed-media" } });
    expect(await advanceMusaPublication(context, id, payload)).toMatchObject({ status: "published", errorCode: "CAMPAIGN_BINDING_CONFLICT", mediaId: "qa-confirmed-media" });
    expect((await prisma.automation.findUniqueOrThrow({ where: { id: campaign.id } })).postId).toBeNull();
  });
  it("a stale publication marker remains uncertain after a process restart", async () => {
    const id = randomUUID(); await advanceMusaPublication(context, id, body());
    await prisma.musaPublication.update({ where: { publicationId: id }, data: {
      stage: "META_PUBLISHING", containerId: "qa-container", leaseToken: "dead-worker", leaseUntil: new Date(0),
    } });
    expect((await advanceMusaPublication(context, id, body())).status).toBe("uncertain");
    expect(remote.publish).not.toHaveBeenCalled();
  });
  it("a confirmed container keeps its paused campaign reserved even without a media ID", async () => {
    const campaign = await makeCampaign(); const id = randomUUID();
    await advanceMusaPublication(context, id, { ...body(), campaignId: campaign.id });
    await prisma.musaPublication.update({ where: { publicationId: id }, data: {
      status: "uncertain", stage: "META_PUBLISHING", containerId: "qa-container",
    } });
    expect(await getMusaPublication(context, id)).toMatchObject({ status: "published", mediaId: null,
      confirmation: { source: "meta_container", containerId: "qa-container", status: "PUBLISHED" },
      errorCode: "CAMPAIGN_BINDING_CONFLICT" });
    expect(await isCampaignReservedForMusaPublication(campaign.id, workspaceId)).toBe(true);
    await expect(prisma.automation.update({ where: { id: campaign.id }, data: { isActive: true } })).rejects.toThrow();
    await expect(prisma.automation.update({ where: { id: campaign.id }, data: { postId: "unrelated" } })).rejects.toThrow();
    await expect(prisma.automation.update({ where: { id: campaign.id }, data: { pendingNextReel: false } })).rejects.toThrow();
    await expect(prisma.automation.delete({ where: { id: campaign.id } })).rejects.toThrow();
    expect(await prisma.automation.findUniqueOrThrow({ where: { id: campaign.id } })).toMatchObject({
      isActive: false, postId: null, pendingNextReel: true,
    });
    await getMusaPublication(context, id);
    expect(remote.pollMeta).toHaveBeenCalledTimes(1);
    expect(remote.publish).not.toHaveBeenCalled();
  });
  it("database accepts only an exact Meta container proof for publication without a media ID", async () => {
    const id = randomUUID(); await advanceMusaPublication(context, id, body());
    const where = { publicationId: id };
    await expect(prisma.musaPublication.update({ where, data: { status: "published" } })).rejects.toThrow();
    await expect(prisma.musaPublication.update({ where, data: {
      status: "published", confirmationContainerId: "qa-container",
    } })).rejects.toThrow();
    await expect(prisma.musaPublication.update({ where, data: {
      status: "published", containerId: "other-container", confirmationContainerId: "qa-container",
    } })).rejects.toThrow();
    await expect(prisma.musaPublication.update({ where, data: {
      status: "published", provider: "ZERNIO", containerId: "qa-container", confirmationContainerId: "qa-container",
    } })).rejects.toThrow();
    await expect(prisma.musaPublication.update({ where, data: {
      status: "processing", containerId: "qa-container", confirmationContainerId: "qa-container",
    } })).rejects.toThrow();
    await expect(prisma.musaPublication.update({ where, data: {
      status: "published", mediaId: "qa-media", containerId: "qa-container", confirmationContainerId: "qa-container",
    } })).rejects.toThrow();
    await expect(prisma.musaPublication.update({ where, data: {
      status: "published", permalink: "https://www.instagram.com/reel/guessed/",
      containerId: "qa-container", confirmationContainerId: "qa-container",
    } })).rejects.toThrow();
    await prisma.musaPublication.update({ where, data: {
      status: "published", containerId: "qa-container", confirmationContainerId: "qa-container",
    } });
    expect((await prisma.musaPublication.findUniqueOrThrow({ where })).mediaId).toBeNull();
  });
  it("a new grant cannot reuse an already consumed publication UUID", async () => {
    const id = randomUUID(); await advanceMusaPublication(context, id, body());
    await expect(advanceMusaPublication({ ...context, connectionId: "different-grant" }, id, body())).rejects.toMatchObject({ status: 409 });
    expect(await prisma.musaPublication.count({ where: { publicationId: id } })).toBe(1);
  });
  it("database rejects a child as the parent proof, null children and oversized lists", async () => {
    const id = randomUUID(); await advanceMusaPublication(context, id, body());
    const where = { publicationId: id };
    await prisma.musaPublication.update({ where, data: { childContainerIds: ["qa-child-a", "qa-child-b"] } });
    await expect(prisma.musaPublication.update({ where, data: { containerId: "qa-child-a" } })).rejects.toThrow();
    await expect(prisma.musaPublication.update({ where, data: {
      childContainerIds: Array.from({ length: 11 }, (_, n) => `qa-child-${n}`),
    } })).rejects.toThrow();
    await expect(prisma.$executeRaw`UPDATE "MusaPublication" SET "childContainerIds" = ARRAY[NULL]::TEXT[] WHERE "publicationId" = ${id}::uuid`).rejects.toThrow();
    const saved = await prisma.musaPublication.findUniqueOrThrow({ where });
    expect(saved.childContainerIds).toEqual(["qa-child-a", "qa-child-b"]); expect(saved.containerId).toBeNull();
  });
  it("claims one persistent lease for overlapping mixed-carousel child writes", async () => {
    const id = randomUUID();
    const payload = { accountId: account.id, caption: "Synthetic mixed carousel", format: "carousel" as const, mediaItems: [
      { type: "image" as const, url: "https://cdn.example.com/qa.jpg" },
      { type: "video" as const, url: "https://cdn.example.com/qa.mp4" },
    ] };
    await advanceMusaPublication(context, id, payload);
    let release!: (value: string) => void; let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    remote.child.mockImplementation(() => { entered(); return new Promise<string>(resolve => { release = resolve; }); });
    const first = advanceMusaPublication(context, id, payload); await started;
    await advanceMusaPublication(context, id, payload); expect(remote.child).toHaveBeenCalledTimes(1);
    release("qa-child-a"); await first;
    expect(await prisma.musaPublication.findUniqueOrThrow({ where: { publicationId: id } })).toMatchObject({
      childContainerIds: ["qa-child-a"], containerId: null, stage: "META_CHILD_PROCESSING", leaseToken: null,
    });
  });
});
