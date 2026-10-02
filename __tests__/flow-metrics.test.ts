import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  automation: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  dmLog: { groupBy: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  legacyClicks: { count: vi.fn(), groupBy: vi.fn() },
  flowClicks: { count: vi.fn(), groupBy: vi.fn() },
  workspace: { findUnique: vi.fn() }, account: { findFirst: vi.fn(), findMany: vi.fn() }, user: { findUnique: vi.fn() },
}));
vi.mock("@/lib/db/client", () => ({ prisma: { automation: mocks.automation, dmLog: mocks.dmLog, linkClick: mocks.legacyClicks, flowLinkClick: mocks.flowClicks, workspace: mocks.workspace, instagramAccount: mocks.account, user: mocks.user } }));
vi.mock("@/lib/auth", () => ({ getCurrentWorkspaceId: async () => "workspace_a", getCurrentUserId: async () => "user_a" }));
vi.mock("@/lib/workspace-access", () => ({ getCurrentWorkspaceContext: async () => ({ workspaceId: "workspace_a", userId: "user_a", role: "ADMIN" }), canManageWorkspace: () => true }));
import { getCampaignReportBySlug } from "@/lib/reports/data";
import { GET as campaigns } from "@/app/api/automations/route";
import { GET as dashboard } from "@/app/api/dashboard/stats/route";

const historicalCampaign = {
  id: "campaign_a", workspaceId: "workspace_a", instagramAccountId: "account_a",
  name: "Guía de Reel", keywords: ["GUÍA"], isActive: true, flowEnabled: false,
  flowPublishedVersionId: "historical_version", reportShareSlug: "report_a",
  workspace: { name: "Workspace A" }, instagramAccount: { username: "reader" },
  trackedLinks: [], createdAt: new Date("2026-09-01T12:00:00Z"), updatedAt: new Date("2026-10-01T12:00:00Z"),
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.automation.findFirst.mockResolvedValue(historicalCampaign);
  mocks.automation.findMany.mockResolvedValue([historicalCampaign]);
  mocks.automation.count.mockResolvedValue(1);
  mocks.dmLog.groupBy.mockImplementation(async ({ by }) => by.includes("status") ? [{ automationId: "campaign_a", status: "SENT", _count: { _all: 10 } }] : []);
  mocks.dmLog.count.mockResolvedValue(10);
  mocks.dmLog.findFirst.mockResolvedValue(null);
  mocks.dmLog.findMany.mockResolvedValue([]);
  mocks.legacyClicks.count.mockImplementation(async ({ where }) => where.createdAt ? 1 : 2);
  mocks.flowClicks.count.mockImplementation(async ({ where }) => where.createdAt ? 1 : 3);
  mocks.legacyClicks.groupBy.mockResolvedValue([{ automationId: "campaign_a", _count: { _all: 2 } }]);
  mocks.flowClicks.groupBy.mockResolvedValue([{ automationId: "campaign_a", _count: { _all: 3 } }]);
  mocks.workspace.findUnique.mockResolvedValue({ name: "Workspace A", dmsSentThisPeriod: 10 });
  mocks.account.findFirst.mockResolvedValue({ id: "account_a", username: "reader" });
  mocks.account.findMany.mockResolvedValue([{ id: "account_a", username: "reader" }]);
  mocks.user.findUnique.mockResolvedValue({ name: "Felipe" });
});

describe("flow click metrics survive disabling an automation", () => {
  it("keeps historical flow clicks in the public report totals and daily chart", async () => {
    const report = await getCampaignReportBySlug("report_a");
    expect(report?.metrics).toMatchObject({ sent: 10, clicks: 5, ctr: 50 });
    expect(report?.daily).toHaveLength(7);
    expect(report?.daily.every((day) => day.clicks === 2)).toBe(true);
    expect(mocks.flowClicks.count).toHaveBeenCalledWith({ where: { workspaceId: "workspace_a", automationId: "campaign_a" } });
    expect(mocks.automation.findFirst.mock.calls[0][0].select.flowPublishedVersionId).toBe(true);
  });
  it("keeps historical flow clicks in the campaign list after switching it off", async () => {
    const response = await campaigns(new NextRequest("https://openreply.example.net/api/automations"));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.data[0].analytics).toMatchObject({ sent: 10, clicks: 5, ctr: 50 });
    expect(mocks.flowClicks.groupBy).toHaveBeenCalledWith({ by: ["automationId"], where: { workspaceId: "workspace_a" }, _count: { _all: true } });
  });
  it("includes flow clicks in dashboard totals with the requested account and workspace scope", async () => {
    const response = await dashboard(new NextRequest("https://openreply.example.net/api/dashboard/stats?instagramAccountId=account_a"));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.data).toMatchObject({ totalClicks: 5, clicksThisMonth: 2, ctrThisMonth: 20 });
    for (const [query] of mocks.flowClicks.count.mock.calls) expect(query.where).toMatchObject({ workspaceId: "workspace_a", instagramAccountId: "account_a" });
  });
});
