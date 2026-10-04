import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createDefaultFlow } from "@/lib/flows/definition";

const mocks = vi.hoisted(() => ({
  context: vi.fn(), workspace: { findUnique: vi.fn() }, account: { findFirst: vi.fn() },
  automation: { create: vi.fn(), findFirst: vi.fn() }, field: { upsert: vi.fn() }, transaction: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentWorkspaceId: vi.fn() }));
vi.mock("@/lib/workspace-access", () => ({ getCurrentWorkspaceContext: mocks.context, canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN" }));
vi.mock("@/lib/db/client", () => ({ prisma: { workspace: mocks.workspace, instagramAccount: mocks.account, automation: mocks.automation, $transaction: mocks.transaction } }));
vi.mock("@/lib/contacts/campaign-settings", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/contacts/campaign-settings")>();
  return { ...original, resolveCampaignContactSettings: vi.fn(async () => ({ data: {} })) };
});
import { POST } from "@/app/api/automations/route";

function request(overrides: Record<string, unknown> = {}) {
  return new NextRequest("https://example.com/api/automations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Nueva guía", instagramAccountId: "account_a", pendingNextReel: true, keywords: ["GUIA"], dmMessage: "Hola", flowDefinition: createDefaultFlow(), ...overrides }) });
}

describe("creating a campaign with its conversation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.context.mockResolvedValue({ workspaceId: "workspace_a", role: "ADMIN" });
    mocks.workspace.findUnique.mockResolvedValue({ id: "workspace_a" });
    mocks.account.findFirst.mockResolvedValue({ id: "account_a", provider: "META" });
    mocks.automation.create.mockImplementation(async ({ data }) => ({ id: "campaign_a", ...data }));
    mocks.transaction.mockImplementation(async (callback) => callback({ automation: mocks.automation, contactField: mocks.field }));
  });

  it("saves the edited graph and first published version in one transaction", async () => {
    const graph = createDefaultFlow();
    const opening = graph.nodes.find((node) => node.type === "message")!;
    if (opening.type === "message") opening.data.blocks = [{ type: "text", text: "Tu apertura personalizada. Respondé SI." }];
    const response = await POST(request({ flowDefinition: graph }));
    expect(response.status).toBe(201);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    const data = mocks.automation.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ workspaceId: "workspace_a", instagramAccountId: "account_a", flowDraft: graph, flowDraftRevision: 1, flowEnabled: true, isActive: true });
    expect(data.flowVersions.create).toMatchObject({ id: data.flowPublishedVersionId, workspaceId: "workspace_a", version: 1, definition: graph });
    expect(data.nextReelArmedAt).toBeInstanceOf(Date);
  });

  it("saves an incomplete paused draft without activating a legacy reply or creating a version", async () => {
    const graph = createDefaultFlow(); graph.edges = [];
    expect((await POST(request({ flowDefinition: graph, isActive: false }))).status).toBe(201);
    expect(mocks.automation.create.mock.calls[0][0].data).toMatchObject({ flowDraft: graph, flowEnabled: false, isActive: false, flowPublishedVersionId: null, nextReelArmedAt: null });
    expect(mocks.automation.create.mock.calls[0][0].data.flowVersions).toBeUndefined();
  });

  it("rejects an invalid active flow before writing any campaign", async () => {
    const graph = createDefaultFlow(); graph.edges = [];
    expect((await POST(request({ flowDefinition: graph }))).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.automation.create).not.toHaveBeenCalled();
  });

  it("registers custom fields inside the same transaction", async () => {
    const graph = createDefaultFlow();
    const resource = graph.nodes.findIndex((node) => node.id === "resource");
    graph.nodes[resource] = { ...graph.nodes[resource], type: "action", data: { action: "set_field", fieldKey: "interes", value: "guia" } };
    expect((await POST(request({ flowDefinition: graph }))).status).toBe(201);
    expect(mocks.field.upsert).toHaveBeenCalledWith({ where: { workspaceId_key: { workspaceId: "workspace_a", key: "interes" } }, create: { workspaceId: "workspace_a", key: "interes", label: "interes" }, update: {} });
  });

  it("checks subflow ownership and account before publishing a new campaign", async () => {
    const graph = createDefaultFlow();
    const resource = graph.nodes.findIndex((node) => node.id === "resource");
    graph.nodes[resource] = { ...graph.nodes[resource], type: "action", data: { action: "start_flow", automationId: "other_campaign" } };
    graph.edges.push({ id: "on_error", source: "resource", sourceHandle: "error", target: "end" });
    mocks.automation.findFirst.mockResolvedValue(null);
    expect((await POST(request({ flowDefinition: graph }))).status).toBe(400);
    expect(mocks.automation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: "workspace_a", instagramAccountId: "account_a", flowEnabled: true }) }));
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("preserves the creation path for simple campaigns and CSV imports", async () => {
    expect((await POST(request({ flowDefinition: undefined, dmTriggerEnabled: true }))).status).toBe(201);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.automation.create.mock.calls[0][0].data.flowDraft).toBeUndefined();
    expect(mocks.automation.create.mock.calls[0][0].data.dmTriggerEnabled).toBe(true);
  });

  it("rejects member writes before accessing accounts or the database", async () => {
    mocks.context.mockResolvedValue({ workspaceId: "workspace_a", role: "MEMBER" });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.workspace.findUnique).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
