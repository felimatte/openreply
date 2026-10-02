import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  contact: { findFirst: vi.fn(), update: vi.fn() },
  member: { findUnique: vi.fn(), findMany: vi.fn() },
  run: { updateMany: vi.fn(), findMany: vi.fn() },
  transaction: vi.fn(), resume: vi.fn(),
}));
vi.mock("@/lib/workspace-access", () => ({ getCurrentWorkspaceContext: mocks.session, canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN" }));
vi.mock("@/lib/db/client", () => ({ prisma: { contact: mocks.contact, workspaceMember: mocks.member, flowRun: mocks.run, $transaction: mocks.transaction } }));
vi.mock("@/lib/flows/engine", () => ({ resumeContactFlows: mocks.resume }));
import { GET, POST } from "@/app/api/contacts/[id]/automation/route";

const now = new Date("2026-10-01T16:00:00Z");
const context = { params: Promise.resolve({ id: "contact_a" }) };
const request = (body: unknown) => new NextRequest("https://openreply.example.net/api/contacts/contact_a/automation", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  mocks.session.mockResolvedValue({ workspaceId: "workspace_a", userId: "admin_a", role: "ADMIN" });
  mocks.contact.findFirst.mockResolvedValue({ id: "contact_a", notes: [], automationPaused: true, automationPausedUntil: null, lastInboundAt: new Date("2026-09-01T12:00:00Z") });
  mocks.member.findUnique.mockResolvedValue({ userId: "member_a" });
  mocks.member.findMany.mockResolvedValue([]);
  mocks.run.findMany.mockResolvedValue([]);
  mocks.contact.update.mockResolvedValue({ id: "contact_a" });
  mocks.run.updateMany.mockResolvedValue({ count: 2 });
  mocks.transaction.mockImplementation(async (operations) => Promise.all(operations));
});
afterEach(() => vi.useRealTimers());

describe("contact flow control access", () => {
  it.each(["pause", "resume", "assign"])("refuses a member's %s before reading or changing a contact", async (action) => {
    mocks.session.mockResolvedValue({ workspaceId: "workspace_a", role: "MEMBER" });
    expect((await POST(request({ action, userId: "member_a" }), context)).status).toBe(403);
    expect(mocks.contact.findFirst).not.toHaveBeenCalled();
    expect(mocks.contact.update).not.toHaveBeenCalled();
    expect(mocks.resume).not.toHaveBeenCalled();
  });
  it("hides a contact outside the current workspace for both reading and mutation", async () => {
    mocks.contact.findFirst.mockResolvedValue(null);
    expect((await GET(new NextRequest("https://openreply.example.net"), context)).status).toBe(404);
    expect((await POST(request({ action: "pause" }), context)).status).toBe(404);
    for (const [query] of mocks.contact.findFirst.mock.calls) expect(query.where).toEqual({ id: "contact_a", workspaceId: "workspace_a" });
    expect(mocks.member.findMany).not.toHaveBeenCalled();
    expect(mocks.contact.update).not.toHaveBeenCalled();
  });
  it("refuses assigning someone who only belongs to another workspace", async () => {
    mocks.member.findUnique.mockResolvedValue(null);
    expect((await POST(request({ action: "assign", userId: "outsider" }), context)).status).toBe(400);
    expect(mocks.member.findUnique).toHaveBeenCalledWith({ where: { workspaceId_userId: { workspaceId: "workspace_a", userId: "outsider" } }, select: { userId: true } });
    expect(mocks.contact.update).not.toHaveBeenCalled();
  });
});

describe("pause and resume keep messaging permission truthful", () => {
  it("includes flows waiting for a new messaging window when pausing a contact", async () => {
    expect((await POST(request({ action: "pause", minutes: 60 }), context)).status).toBe(200);
    expect(mocks.contact.update).toHaveBeenCalledWith({ where: { id: "contact_a" }, data: { automationPaused: true, automationPausedUntil: new Date(now.getTime() + 3600000) } });
    const where = mocks.run.updateMany.mock.calls[0][0].where;
    expect(where.contactId).toBe("contact_a");
    expect(where.workspaceId).toBe("workspace_a");
    expect(where.status).toBe("WAITING_WINDOW");
    expect(mocks.run.updateMany.mock.calls[0][0].data).toEqual({ status: "PAUSED", waitType: "WINDOW" });
    const otherPaused = mocks.run.updateMany.mock.calls[1][0];
    expect(otherPaused.where).toMatchObject({ contactId: "contact_a", workspaceId: "workspace_a" });
    expect(otherPaused.where.status.in).toEqual(expect.arrayContaining(["RUNNING", "WAITING"]));
    expect(otherPaused.where.status.in).not.toContain("PAUSED");
    expect(otherPaused.data).toEqual({ status: "PAUSED" });
    expect(mocks.run.updateMany).toHaveBeenCalledTimes(2);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
  it("resumes automation without forging an inbound message or reopening its 24 hour window", async () => {
    const response = await POST(request({ action: "resume" }), context);
    expect(response.status).toBe(200);
    expect(mocks.contact.update).toHaveBeenCalledWith({ where: { id: "contact_a" }, data: { automationPaused: false, automationPausedUntil: null } });
    expect(mocks.resume).toHaveBeenCalledWith("contact_a");
    for (const [query] of mocks.contact.update.mock.calls) {
      expect(query.data).not.toHaveProperty("lastInboundAt");
      expect(query.data).not.toHaveProperty("lastInteractionAt");
    }
  });
});
