import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ link: { findUnique: vi.fn(), update: vi.fn() }, clickCreate: vi.fn(), transaction: vi.fn(), contactUpdate: vi.fn(), runUpdate: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ prisma: { flowLink: mocks.link, flowLinkClick: { create: mocks.clickCreate }, $transaction: mocks.transaction, contact: { update: mocks.contactUpdate }, flowRun: { update: mocks.runUpdate } } }));
import { GET, HEAD } from "@/app/f/[token]/route";

const context = { params: Promise.resolve({ token: "opaque_link_token" }) };
const destination = "https://store.example.net/guide?utm_source=instagram";
const now = new Date("2026-10-01T16:00:00Z");
const link = { id: "link_a", destinationUrl: destination, clicks: 0, clickedAt: null, run: { automationId: "campaign_a", workspaceId: "workspace_a", instagramAccountId: "account_a" } };
const request = (userAgent?: string, method = "GET") => new NextRequest("https://openreply.example.net/f/opaque_link_token", { method, headers: userAgent ? { "user-agent": userAgent } : {} });
const human = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  mocks.link.findUnique.mockResolvedValue(link);
  mocks.link.update.mockResolvedValue(link);
  mocks.clickCreate.mockResolvedValue({ id: "click_a" });
  mocks.transaction.mockImplementation(async (operations) => Promise.all(operations));
});
afterEach(() => vi.useRealTimers());

describe("flow link previews are not contact interactions", () => {
  it.each([undefined, "facebookexternalhit/1.1", "meta-externalagent/1.1", "WhatsApp/2.24", "Slackbot-LinkExpanding 1.0", "Discordbot/2.0"])("redirects %s without counting a preview", async (agent) => {
    const response = await GET(request(agent), context);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(destination);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.link.update).not.toHaveBeenCalled();
    expect(mocks.clickCreate).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.contactUpdate).not.toHaveBeenCalled();
    expect(mocks.runUpdate).not.toHaveBeenCalled();
  });
  it("HEAD never counts a visit even when a browser sends it", async () => {
    const response = await HEAD(request(human, "HEAD"), context);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(destination);
    expect(mocks.link.update).not.toHaveBeenCalled();
    expect(mocks.clickCreate).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.contactUpdate).not.toHaveBeenCalled();
  });
  it("counts simultaneous human visits atomically while keeping clicks separate from message consent", async () => {
    let persistedClicks = 0;
    mocks.link.update.mockImplementation(async ({ data }) => {
      // Model database increment semantics. A stale read then assignment would
      // write 1 twice; independent browser visits must persist two clicks.
      persistedClicks = typeof data.clicks === "number" ? data.clicks : persistedClicks + data.clicks.increment;
      return { ...link, clicks: persistedClicks, clickedAt: data.clickedAt };
    });
    const results = await Promise.all([GET(request(human), context), GET(request(human), context)]);
    expect(results.map((response) => response.status)).toEqual([302, 302]);
    expect(persistedClicks).toBe(2);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    for (const [operations] of mocks.transaction.mock.calls) expect(operations).toHaveLength(2);
    expect(mocks.clickCreate).toHaveBeenCalledTimes(2);
    expect(mocks.clickCreate).toHaveBeenCalledWith({ data: { linkId: "link_a", automationId: "campaign_a", workspaceId: "workspace_a", instagramAccountId: "account_a" } });
    expect(mocks.contactUpdate).not.toHaveBeenCalled();
    expect(mocks.runUpdate).not.toHaveBeenCalled();
  });
  it("preserves the first human click timestamp on a later visit", async () => {
    const firstClick = new Date("2026-09-30T12:00:00Z");
    mocks.link.findUnique.mockResolvedValue({ ...link, clickedAt: firstClick });
    const response = await GET(request(human), context);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.link.update.mock.calls[0][0].data.clickedAt).toEqual(firstClick);
  });
  it("returns 404 for unavailable links without recording a click", async () => {
    mocks.link.findUnique.mockResolvedValue(null);
    expect((await GET(request(human), context)).status).toBe(404);
    expect((await HEAD(request(human, "HEAD"), context)).status).toBe(404);
    expect(mocks.link.update).not.toHaveBeenCalled();
    expect(mocks.clickCreate).not.toHaveBeenCalled();
  });
});
