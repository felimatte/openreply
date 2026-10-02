import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createDefaultFlow } from "@/lib/flows/definition";

const mocks = vi.hoisted(() => ({ context: vi.fn(), automation: { findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() }, version: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() }, run: { findMany: vi.fn(), groupBy: vi.fn(), updateMany: vi.fn() }, step: { groupBy: vi.fn() }, link: { groupBy: vi.fn() }, field: { upsert: vi.fn() }, transaction: vi.fn() }));
vi.mock("@/lib/workspace-access", () => ({ getCurrentWorkspaceContext: mocks.context, canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN" }));
vi.mock("@/lib/db/client", () => ({ prisma: { automation: mocks.automation, flowVersion: mocks.version, flowRun: mocks.run, flowStepRun: mocks.step, flowLink: mocks.link, contactField: mocks.field, $transaction: mocks.transaction } }));
import { GET, POST, PUT } from "@/app/api/automations/[id]/flow/route";
const context = { params: Promise.resolve({ id: "campaign_a" }) };
function request(body: unknown, method = "POST") { return new NextRequest("https://example.com/api/automations/campaign_a/flow", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }

describe("flow publishing and access", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.context.mockResolvedValue({ workspaceId: "workspace_a", role: "ADMIN" });
    mocks.automation.findFirst.mockResolvedValue({ id: "campaign_a", workspaceId: "workspace_a", instagramAccountId: "account_a", instagramAccount: { provider: "META" }, pendingNextReel: false, flowDraftRevision: 0 });
    mocks.automation.updateMany.mockResolvedValue({ count: 1 });
    mocks.version.findFirst.mockResolvedValue({ version: 2 });
    mocks.version.create.mockResolvedValue({ id: "version_3", version: 3 });
    mocks.transaction.mockImplementation(async (fn: ((tx: unknown) => unknown) | unknown[]) => typeof fn === "function" ? fn({ automation: mocks.automation, flowVersion: mocks.version, contactField: mocks.field }) : Promise.all(fn));
    mocks.version.findMany.mockResolvedValue([]); mocks.run.findMany.mockResolvedValue([]); mocks.run.groupBy.mockResolvedValue([]); mocks.step.groupBy.mockResolvedValue([]); mocks.link.groupBy.mockResolvedValue([]);
  });
  it("scopes every campaign lookup to the authenticated workspace", async () => {
    mocks.automation.findFirst.mockResolvedValue(null);
    const response = await POST(request({ action: "publish", definition: createDefaultFlow(), expectedRevision: 0 }), context);
    expect(response.status).toBe(404);
    expect(mocks.automation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "campaign_a", workspaceId: "workspace_a" } }));
    expect(mocks.version.create).not.toHaveBeenCalled();
  });
  it("rejects non-admin changes before accessing the campaign", async () => {
    mocks.context.mockResolvedValue({ workspaceId: "workspace_a", role: "MEMBER" });
    expect((await PUT(request({ definition: createDefaultFlow(), expectedRevision: 0 }, "PUT"), context)).status).toBe(403);
    expect(mocks.automation.findFirst).not.toHaveBeenCalled();
  });
  it("creates a new immutable version rather than overwriting an old one", async () => {
    const graph = createDefaultFlow();
    const response = await POST(request({ action: "publish", definition: graph, expectedRevision: 0 }), context);
    expect(response.status).toBe(200);
    expect(mocks.version.create).toHaveBeenCalledWith({ data: expect.objectContaining({ version: 3, definition: graph, automationId: "campaign_a", workspaceId: "workspace_a" }) });
    expect(mocks.automation.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ flowEnabled: true, flowPublishedVersionId: "version_3" }) }));
  });
  it("arms a resumed campaign from its new activation rather than an old paused wait", async () => {
    mocks.automation.findFirst.mockResolvedValue({ id: "campaign_a", workspaceId: "workspace_a", instagramAccountId: "account_a", instagramAccount: { provider: "META" }, isActive: false, pendingNextReel: true, nextReelArmedAt: new Date("2020-01-01"), flowDraftRevision: 0 });
    const before = Date.now();
    expect((await POST(request({ action: "publish", definition: createDefaultFlow(), expectedRevision: 0 }), context)).status).toBe(200);
    expect(mocks.automation.update.mock.calls[0][0].data.nextReelArmedAt.getTime()).toBeGreaterThanOrEqual(before);
  });
  it("preserves changes made by another editor", async () => {
    mocks.automation.updateMany.mockResolvedValue({ count: 0 });
    expect((await POST(request({ action: "publish", definition: createDefaultFlow(), expectedRevision: 0 }), context)).status).toBe(409);
    expect(mocks.version.create).not.toHaveBeenCalled();
  });
  it("refuses malformed graphs before creating a version", async () => {
    const graph = createDefaultFlow(); graph.edges = [];
    expect((await POST(request({ action: "publish", definition: graph, expectedRevision: 0 }), context)).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("returns the real builder data and scoped metrics with read-only permissions for members", async () => {
    mocks.context.mockResolvedValue({ workspaceId: "workspace_a", role: "MEMBER" });
    mocks.link.groupBy.mockResolvedValue([{ nodeId: "resource", buttonId: "link_0", _sum: { clicks: 5 }, _count: { clickedAt: 2 } }]);
    const response = await GET(new NextRequest("https://example.com/api/automations/campaign_a/flow"), context);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.canEdit).toBe(false);
    expect(body.data.draft.definition.schemaVersion).toBe(1);
    expect(body.data.linkStats).toEqual([{ nodeId: "resource", buttonId: "link_0", clicks: 5, runsClicked: 2 }]);
    expect(mocks.link.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { run: { automationId: "campaign_a", workspaceId: "workspace_a" } } }));
  });
  it("cancels runs waiting for interaction when disabling the visual engine", async () => {
    expect((await POST(request({ action: "disable" }), context)).status).toBe(200);
    const query = mocks.run.updateMany.mock.calls[0][0];
    expect(query.where.workspaceId).toBe("workspace_a");
    expect(query.where.status.in).toContain("WAITING_WINDOW");
    expect(query.data).toMatchObject({ status: "CANCELLED", waitType: null, waitExpiresAt: null, resumeAt: null });
    expect(mocks.automation.update).toHaveBeenCalledWith({ where: { id: "campaign_a" }, data: { flowEnabled: false } });
  });
});
