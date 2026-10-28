import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  musaConnection: { findUnique: vi.fn() }, workspaceMember: { findUnique: vi.fn() }, instagramAccount: { findMany: vi.fn() },
  workspace: { findUnique: vi.fn() }, followerSnapshot: { findMany: vi.fn() },
}));
vi.mock("@/lib/db/client", () => ({ prisma: db }));
vi.mock("@/lib/instagram/context", () => ({ createInstagramContext: vi.fn(async () => ({ provider: "META", accessToken: "private-provider-token" })) }));
vi.mock("@/lib/integrations/musa/analytics-quota", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/integrations/musa/analytics-quota")>(), reserveAnalyticsRead: vi.fn() }));

import { metric, analyticsMetric, analyticsAsset, analyticsQuery } from "@/lib/integrations/musa/analytics-contract";
import type { AnalyticsIdentity } from "@/lib/integrations/musa/analytics-contract";
import { encodeAnalyticsCursor, decodeAnalyticsCursor } from "@/lib/integrations/musa/analytics-cursor";
import { publicMediaUrl } from "@/lib/integrations/musa/analytics-transport";
import { GET as accountRoute } from "@/app/api/integrations/musa/v1/analytics/account/route";
import { GET as mediaRoute } from "@/app/api/integrations/musa/v1/analytics/media/route";
import { createInstagramContext } from "@/lib/instagram/context";
import { AnalyticsQuotaError, reserveAnalyticsRead } from "@/lib/integrations/musa/analytics-quota";

const range = { from: "2026-10-21T03:00:00.000Z", to: "2026-10-28T03:00:00.000Z", timezone: "America/Argentina/Buenos_Aires" };
const identity: AnalyticsIdentity = { version: 1, connectionId: "grant-a", generation: "a".repeat(64), accountId: "account-a", instagramId: "ig-a", provider: "META", apiVersion: "v25.0", observedAt: "2026-10-28T12:00:00.000Z", range };
const account = { id: "account-a", instagramId: "ig-a", username: "test", provider: "META", workspaceId: "workspace-a", accessToken: "encrypted", connectedAt: new Date("2026-01-01") };
const grant = { id: "grant-a", workspaceId: "workspace-a", businessId: "business-a", grantedByUserId: "admin-a", allowedAccountIds: ["account-a"], revokedAt: null };
const provider = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function request(path = "account", extra: Record<string, string> = {}) {
  return new Request(`https://openreply.example/api/integrations/musa/v1/analytics/${path}?${new URLSearchParams({ ...range, accountId: "account-a", ...extra })}`, {
    headers: { Authorization: `Bearer musa_${"a".repeat(43)}`, "X-Musa-Business-Id": "business-a" },
  });
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("ENCRYPTION_KEY", "1".repeat(64)); vi.stubEnv("META_GRAPH_API_VERSION", "v25.0"); vi.stubGlobal("fetch", provider);
  db.musaConnection.findUnique.mockResolvedValue(grant); db.workspaceMember.findUnique.mockResolvedValue({ role: "ADMIN" });
  db.instagramAccount.findMany.mockResolvedValue([account]); db.workspace.findUnique.mockResolvedValue({ id: "workspace-a", name: "Test" });
  db.followerSnapshot.findMany.mockResolvedValue([{ date: new Date("2026-10-25"), followersCount: 123 }]);
  vi.mocked(reserveAnalyticsRead).mockResolvedValue(undefined);
  provider.mockImplementation(async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/me")) return json({ id: "app-scoped-id", user_id: "ig-a", username: "test", followers_count: 123 });
    return json({ data: [{ name: url.searchParams.get("metric"), total_value: { value: 42 } }] });
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("analytics values and transport boundaries", () => {
  it("keeps missing/hidden metrics distinct from measured zero", () => {
    expect(metric(undefined)).toEqual({ value: null, state: "unsupported" }); expect(metric(0)).toEqual({ value: 0, state: "available" });
    expect(analyticsMetric.safeParse({ value: 0, state: "permission_required" }).success).toBe(false);
    expect(analyticsMetric.safeParse({ value: null, state: "available" }).success).toBe(false);
  });
  it.each(["http://cdn.example/a.jpg", "https://127.0.0.1/a.jpg", "https://user:pass@cdn.example/a.jpg", "https://localhost/a", "https://internal.local/a", "javascript:alert(1)"])("rejects unsafe media URL %s", url => expect(publicMediaUrl(url)).toBeNull());
  it("rejects a non-HTTPS asset even in a normalized response", () => expect(analyticsAsset.safeParse({ id: "x", type: "image", url: "file:///private", poster: null }).success).toBe(false));
  it("validates periods and timezones", () => {
    expect(analyticsQuery.safeParse({ ...range, accountId: "account-a" }).success).toBe(true);
    expect(analyticsQuery.safeParse({ ...range, accountId: "account-a", timezone: "not-a-zone" }).success).toBe(false);
    expect(analyticsQuery.safeParse({ ...range, accountId: "account-a", to: range.from }).success).toBe(false);
  });
  it("uses opaque expiring cursors bound to account, generation and exact range", () => {
    const cursor = encodeAnalyticsCursor(identity, "provider-private-after");
    expect(cursor).not.toContain("provider-private-after"); expect(decodeAnalyticsCursor(identity, cursor)).toBe("provider-private-after");
    for (const changed of [{ ...identity, accountId: "other" }, { ...identity, generation: "b".repeat(64) }, { ...identity, range: { ...range, timezone: "UTC" } }]) {
      expect(() => decodeAnalyticsCursor(changed, cursor)).toThrow();
    }
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 86400001);
    expect(() => decodeAnalyticsCursor(identity, cursor)).toThrow(); vi.restoreAllMocks();
  });
});

describe("authenticated account insights", () => {
  it.each([false, true])("blocks provider reads when the grant or global quota is unavailable: %s", async limited => {
    vi.mocked(reserveAnalyticsRead).mockRejectedValue(new AnalyticsQuotaError(limited));
    const response = await accountRoute(request());
    expect(response.status).toBe(limited ? 429 : 503);
    if (limited) expect(response.headers.get("Retry-After")).toBe("3600");
    const body = await response.json();
    expect(provider).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain("redis");
  });
  it("bounds stalled authentication and prevents late provider reads", async () => {
    vi.useFakeTimers();
    let release: (value: typeof grant) => void = () => undefined;
    db.musaConnection.findUnique.mockReturnValue(new Promise(resolve => { release = resolve; }));
    try {
      const pending = accountRoute(request());
      await vi.advanceTimersByTimeAsync(8200);
      const response = await pending;
      expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("private-provider-token");
      release(grant); await vi.advanceTimersByTimeAsync(0);
      expect(provider).not.toHaveBeenCalled(); expect(db.followerSnapshot.findMany).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it("keeps unvalidated native totals unavailable, omits backfilled history and never invents capture time", async () => {
    const response = await accountRoute(request()); expect(response.status).toBe(200);
    const body = await response.json(); expect(body.metrics.reach).toEqual({ value: null, state: "pending_validation" }); expect(body.metricScope).toBe("account_period");
    expect(body.followers).toEqual({ value: 123, state: "available" });
    expect(body.observations[0]).toMatchObject({ observedAt: null, precision: "utc_day", source: "observed" });
    expect(db.followerSnapshot.findMany.mock.calls[0][0].where).toMatchObject({ instagramAccountId: "account-a", backfilled: false });
    const queries = provider.mock.calls.map(([url]) => new URL(String(url))).filter(url => url.pathname.endsWith("/insights"));
    expect(queries).toHaveLength(0);
    expect(JSON.stringify(body)).not.toContain("private-provider-token");
  });
  it("does not sum daily values when the native aggregate is missing", async () => {
    provider.mockImplementation(async input => new URL(String(input)).pathname.endsWith("/me") ? json({ id: "ig-a", username: "test" }) : json({ data: [{ name: "reach", values: [{ value: 10 }, { value: 20 }] }] }));
    const body = await (await accountRoute(request())).json(); expect(body.metrics.reach.value).toBeNull();
  });
  it.each(["account", "media"])("refuses a provider token for a different identity before reading %s", async route => {
    provider.mockResolvedValue(json({ id: "another-account", username: "other" }));
    const body = await (await (route === "media" ? mediaRoute : accountRoute)(request(route))).json();
    expect(provider).toHaveBeenCalledTimes(1); expect(db.followerSnapshot.findMany).not.toHaveBeenCalled();
    expect(route === "media" ? body.state : body.followers.state).toBe("permission_required");
  });
  it.each(["account", "media"])("rejects a revoked grant before calling provider for %s", async route => {
    db.musaConnection.findUnique.mockResolvedValue({ ...grant, revokedAt: new Date() });
    expect((await (route === "media" ? mediaRoute : accountRoute)(request(route))).status).toBe(401); expect(provider).not.toHaveBeenCalled();
  });
  it("rejects ungranted accounts and repeated query fields", async () => {
    expect((await mediaRoute(request("media", { accountId: "ungranted" }))).status).toBe(403);
    const original = request(); expect((await accountRoute(new Request(`${original.url}&accountId=account-a`, original))).status).toBe(400);
    expect(provider).not.toHaveBeenCalled();
  });
});

describe("bounded media pages", () => {
  const reel = { id: "reel-1", timestamp: "2026-10-25T12:00:00Z", media_type: "VIDEO", media_product_type: "REELS", caption: "Real caption", media_url: "https://cdn.example/reel.mp4", thumbnail_url: "https://cdn.example/reel.jpg", like_count: 0 };
  function mediaProvider(paging?: unknown) {
    provider.mockImplementation(async input => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/me")) return json({ id: "ig-a", username: "test" });
      if (url.pathname.endsWith("/media")) return json({ data: [reel], paging });
      return json({ data: [{ name: url.searchParams.get("metric"), period: "lifetime", values: [{ value: 0 }] }] });
    });
  }
  it("returns real video and cover, lifetime metrics and no invented duration", async () => {
    mediaProvider(); const body = await (await mediaRoute(request("media"))).json();
    expect(body.media[0]).toMatchObject({ format: "reel", durationSeconds: null, metricScope: "lifetime", assets: [{ url: reel.media_url, poster: reel.thumbnail_url, type: "video" }] });
    expect(body.media[0].metrics.comments.value).toBeNull(); expect(body.media[0].metrics.likes.value).toBe(0);
    expect(body.media[0].metrics.views.value).toBe(0); expect(body.coverage).toBe("complete");
  });
  it("does not claim complete history when next exists without a usable cursor", async () => {
    mediaProvider({ next: "https://graph.instagram.com/next?access_token=private" });
    const body = await (await mediaRoute(request("media"))).json(); expect(body.coverage).toBe("sample"); expect(body.state).toBe("partial"); expect(body.nextCursor).toBeNull(); expect(JSON.stringify(body)).not.toContain("access_token");
  });
  it("wraps cursors instead of following arbitrary provider next URLs", async () => {
    mediaProvider({ next: "https://internal.invalid/next", cursors: { after: "opaque-provider" } });
    const body = await (await mediaRoute(request("media"))).json(); expect(body.coverage).toBe("page"); expect(body.nextCursor).toBeTypeOf("string");
    expect(provider.mock.calls.every(([url]) => String(url).startsWith("https://graph.instagram.com/v25.0/"))).toBe(true);
    expect(provider.mock.calls.every(([, init]) => init?.redirect === "error" && init.signal instanceof AbortSignal)).toBe(true);
  });
  it("sanitizes a provider failure without replacing missing stats by zero", async () => {
    provider.mockResolvedValue(json({ error: { code: 190, message: "private-provider-token" } }, 400));
    const body = await (await mediaRoute(request("media"))).json(); expect(body.state).toBe("permission_required"); expect(body.media).toEqual([]); expect(JSON.stringify(body)).not.toContain("private-provider-token");
  });
  it.each([4, 17, 368])("propagates Graph throttle %s from insights without a partial success", async code => {
    provider.mockImplementation(async input => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/me")) return json({ id: "ig-a", username: "test" });
      if (url.pathname.endsWith("/media")) return json({ data: [reel] });
      return new Response(JSON.stringify({ error: { code, message: "private" } }), { status: 400, headers: { "Retry-After": "7200" } });
    });
    const response = await mediaRoute(request("media"));
    expect(response.status).toBe(429); expect(response.headers.get("Retry-After")).toBe("7200");
    expect((await response.json()).media).toBeUndefined();
  });
  it("preserves Zernio source age and matches both post and account identities", async () => {
    db.instagramAccount.findMany.mockResolvedValue([{ ...account, provider: "ZERNIO" }]);
    vi.mocked(createInstagramContext).mockResolvedValueOnce({ provider: "ZERNIO", apiKey: "private-provider-token", accountId: "z-a", instagramId: "ig-a" });
    provider.mockImplementation(async input => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/accounts")) return json({ accounts: [{ _id: "z-a", platformUserId: "ig-a", username: "test" }] });
      if (url.pathname.endsWith("/posts")) return json({ posts: [{ id: "post-a", createdTime: "2026-10-25T12:00:00Z", mediaType: "image", likeCount: 0 }] });
      return json({ platformAnalytics: [
        { accountId: "other", platformPostId: "post-a", analytics: { views: 999, lastUpdated: "2026-10-28T12:00:00Z" } },
        { accountId: "z-a", platformPostId: "other", analytics: { views: 888, lastUpdated: "2026-10-28T12:00:00Z" } },
        { accountId: "z-a", platformPostId: "post-a", analytics: { views: 0, lastUpdated: "2026-10-25T13:00:00Z" } },
      ] });
    });
    const body = await (await mediaRoute(request("media"))).json();
    expect(body.media[0]).toMatchObject({ insightsUpdatedAt: "2026-10-25T13:00:00.000Z", metrics: { views: { value: 0, state: "available" } } });
    expect(body.coverage).toBe("sample"); expect(JSON.stringify(body)).not.toContain("private-provider-token");
  });
});
