import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Automation, FlowVersion, Prisma } from "@/app/generated/prisma/client";
import type { MusaConnectionContext } from "@/lib/integrations/musa/auth";
import { createDefaultFlow } from "@/lib/flows/definition";

const mocks = vi.hoisted(() => ({ campaigns: vi.fn(), versions: vi.fn(), version: vi.fn(), target: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ prisma: {
  automation: { findMany: mocks.campaigns }, flowVersion: { findMany: mocks.versions },
} }));
import { copyMusaPublicationFlow, listMusaFlows, musaFlowRevision } from "@/lib/integrations/musa/flows";

const accountId = "account-a", workspaceId = "workspace-a";
const context = { workspaceId, accounts: [{ id: accountId }] } as unknown as MusaConnectionContext;
const tx = { flowVersion: { findFirst: mocks.version }, automation: { findFirst: mocks.target, create: mocks.create } } as unknown as Prisma.TransactionClient;
function source() {
  const automation = { id: "source-campaign", name: "Entregar guía", workspaceId, instagramAccountId: accountId,
    flowPublishedVersionId: "version-a", isActive: true, postId: "already-published-post", matchAnyPost: true, dmTriggerEnabled: false,
    keywords: ["GUIA"], excludedKeywords: ["no"], priority: 2, matchAnyWord: false, dmMessage: "La guía",
    wholeWordMatch: true, publicReplyEnabled: true, publicReplyMessages: ["Te escribimos"], contactTags: ["guia"],
  } as unknown as Automation;
  return { id: "version-a", automationId: automation.id, workspaceId, version: 1,
    definition: createDefaultFlow(), publishedAt: new Date(0), createdAt: new Date(0), automation,
  } as unknown as FlowVersion & { automation: Automation };
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.campaigns.mockResolvedValue([{ flowPublishedVersionId: "version-a" }]);
  mocks.versions.mockResolvedValue([source()]); mocks.version.mockResolvedValue(source());
  mocks.create.mockImplementation(async ({ data }) => ({ ...data, updatedAt: new Date(0) }));
});

describe("MUSA published flow catalog and publication copy", () => {
  it("lists only the granted account/workspace and hides publication-owned copies", async () => {
    const result = await listMusaFlows(context, accountId);
    expect(result.flows).toHaveLength(1);
    expect(result.flows[0]).toMatchObject({ id: "version-a", name: "Entregar guía", canAttach: true, unavailableReason: null });
    expect(result.flows[0].revision).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.campaigns).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      workspaceId, instagramAccountId: accountId, id: { not: { startsWith: "musa_flow_" } },
    }) }));
    expect(mocks.versions).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      workspaceId, automation: { workspaceId, instagramAccountId: accountId },
    }) }));
  });
  it("never consults another account's catalog", async () => {
    await expect(listMusaFlows(context, "foreign")).rejects.toMatchObject({ status: 403 });
    expect(mocks.campaigns).not.toHaveBeenCalled();
  });
  it("returns an empty list without treating it as a provider error", async () => {
    mocks.campaigns.mockResolvedValue([]); mocks.versions.mockResolvedValue([]);
    expect(await listMusaFlows(context, accountId)).toEqual({ version: 1, flows: [] });
  });
  it("refuses to silently truncate a catalog", async () => {
    mocks.campaigns.mockResolvedValue(Array.from({ length: 501 }, () => ({ flowPublishedVersionId: "v" })));
    await expect(listMusaFlows(context, accountId)).rejects.toMatchObject({ status: 503, code: "FLOW_LIST_LIMIT" });
  });
  it("makes a new paused campaign/version for each publication without touching the source post", async () => {
    const original = source();
    const revision = musaFlowRevision(original);
    const one = await copyMusaPublicationFlow(tx, context, accountId, original.id, revision);
    const two = await copyMusaPublicationFlow(tx, context, accountId, original.id, revision);
    expect(one.id).not.toBe(two.id);
    expect(one).toMatchObject({ id: expect.stringMatching(/^musa_flow_/), workspaceId, instagramAccountId: accountId,
      keywords: ["GUIA"], excludedKeywords: ["no"], publicReplyMessages: ["Te escribimos"], contactTags: ["guia"],
      isActive: false, postId: null, matchAnyPost: false, dmTriggerEnabled: false, pendingNextReel: false, flowEnabled: false });
    expect(one.flowPublishedVersionId).not.toBe(original.id);
    expect(mocks.create.mock.calls[0][0].data.flowVersions.create).toMatchObject({
      id: one.flowPublishedVersionId, workspaceId, version: 1, definition: original.definition,
    });
    expect(original.automation.postId).toBe("already-published-post");
    expect(mocks.version).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "version-a", workspaceId,
      automation: { workspaceId, instagramAccountId: accountId } } }));
  });
  it("rejects removed, foreign, edited or unpublished sources before creating a copy", async () => {
    const original = source(), revision = musaFlowRevision(original);
    for (const changed of [null, { ...original, automation: { ...original.automation, keywords: ["OTRA"] } },
      { ...original, automation: { ...original.automation, flowPublishedVersionId: "new-version" } }]) {
      mocks.version.mockResolvedValue(changed);
      await expect(copyMusaPublicationFlow(tx, context, accountId, original.id, revision)).rejects.toMatchObject({ status: 409, code: "FLOW_CHANGED" });
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("includes conversation settings and published definition in the revision", () => {
    const original = source(), revision = musaFlowRevision(original);
    for (const changed of [
      { ...original, definition: { changed: true } },
      { ...original, automation: { ...original.automation, keywords: ["OTRA"] } },
      { ...original, automation: { ...original.automation, contactTags: ["otra"] } },
      { ...original, automation: { ...original.automation, publicReplyMessages: ["Otro mensaje"] } },
    ]) expect(musaFlowRevision(changed)).not.toBe(revision);
  });
  it("keeps a malformed or triggerless flow unavailable", async () => {
    for (const original of [ { ...source(), definition: {} },
      { ...source(), automation: { ...source().automation, keywords: [], matchAnyWord: false } } ]) {
      mocks.versions.mockResolvedValue([original]);
      expect((await listMusaFlows(context, accountId)).flows[0].canAttach).toBe(false);
    }
  });
});
