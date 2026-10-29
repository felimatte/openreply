import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ musaConnection: { findUnique: vi.fn() }, workspaceMember: { findUnique: vi.fn() },
  instagramAccount: { findMany: vi.fn() }, workspace: { findUnique: vi.fn() }, musaDiscoveryGrant: { findUnique: vi.fn() },
  followerSnapshot: { findMany: vi.fn() } }));
vi.mock("@/lib/db/client", () => ({ prisma: db }));
vi.mock("@/lib/integrations/musa/analytics-quota", async original => ({
  ...await original<typeof import("@/lib/integrations/musa/analytics-quota")>(), reserveAnalyticsRead: vi.fn() }));

import { encryptToken } from "@/lib/meta/oauth";
import { hashMusaCredential } from "@/lib/integrations/musa/auth";
import { DISCOVERY_SCOPES } from "@/lib/integrations/musa/discovery-config";
import { AnalyticsQuotaError, reserveAnalyticsRead } from "@/lib/integrations/musa/analytics-quota";
import { GET as discovery } from "@/app/api/integrations/musa/v1/analytics/discovery/route";
import { GET as status } from "@/app/api/integrations/musa/v1/analytics/discovery/status/route";
import { GET as capabilities } from "@/app/api/integrations/musa/v1/analytics/capabilities/route";
import { encodeDiscoveryCursor, decodeDiscoveryCursor } from "@/lib/integrations/musa/discovery-reader-cursor";
import type { DiscoveryCursorScope } from "@/lib/integrations/musa/discovery-reader-cursor";
import type { MusaDiscoveryGrant } from "@/app/generated/prisma/client";

const range = { from: "2026-10-01T03:00:00.000Z", to: "2026-10-29T03:00:00.000Z", timezone: "America/Argentina/Buenos_Aires" };
const account = { id: "account-a", instagramId: "5678", username: "own", provider: "META", workspaceId: "workspace-a",
  accessToken: "", connectedAt: new Date("2026-01-01"), zernioAccountId: null };
const connection = { id: "grant-a", workspaceId: "workspace-a", businessId: "business-a", grantedByUserId: "admin-a", allowedAccountIds: ["account-a"], revokedAt: null };
const video = { id: "7001", caption: "Public caption", timestamp: "2026-10-15T12:00:00+0000", media_type: "VIDEO", media_product_type: "REELS",
  media_url: "https://cdn.example/reel.mp4", thumbnail_url: "https://cdn.example/reel.jpg", permalink: "https://www.instagram.com/reel/public/", like_count: 0, comments_count: 2 };
const remote = vi.fn<typeof fetch>();
let grant: MusaDiscoveryGrant;
let target: Record<string, unknown>;
const json = (body: unknown, status = 200) => Response.json(body, { status });
function request(extra: Record<string, string> = {}, path = "discovery") {
  return new Request(`https://openreply.example/api/integrations/musa/v1/analytics/${path}?${new URLSearchParams({
    ...(path === "discovery/status" ? {} : range), accountId: account.id, ...(path === "discovery" ? { username: "competidor" } : {}), ...extra })}`, {
    headers: { authorization: `Bearer musa_${"a".repeat(43)}`, "x-musa-business-id": "business-a" } });
}
function provider(input: string | URL | Request) {
  const url = new URL(String(input));
  if (url.hostname === "graph.instagram.com") {
    if (url.pathname.endsWith("/me")) return json({ id: "1111", user_id: account.instagramId, username: "own", followers_count: 12 });
    return json({ data: [] });
  }
  if (url.hostname !== "graph.facebook.com") throw new Error("Unexpected origin");
  if (url.pathname.endsWith("/me/permissions")) return json({ data: DISCOVERY_SCOPES.map(permission => ({ permission, status: "granted" })) });
  if (url.pathname.endsWith("/me")) return json({ id: "9012" });
  if (url.pathname.endsWith("/4444")) return json({ id: "4444", instagram_business_account: { id: "3333" } });
  if (url.pathname.endsWith("/3333")) return json({ business_discovery: url.searchParams.get("fields")?.includes("username(own)") ? { id: "3333", username: "own" } : target });
  throw new Error("Unexpected path");
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("ENCRYPTION_KEY", "1".repeat(64)); vi.stubEnv("META_GRAPH_API_VERSION", "v25.0");
  vi.stubGlobal("fetch", remote); account.provider = "META"; account.accessToken = encryptToken("private-instagram-token");
  const accountTokenHash = hashMusaCredential(account.accessToken);
  grant = { id: "discovery-a", connectionId: "grant-a", accountId: account.id, grantedByUserId: "reader-admin", accountTokenHash,
    instagramId: account.instagramId, instagramUserId: "5678", facebookUserId: "9012", facebookInstagramId: "3333", pageId: "4444",
    encryptedToken: encryptToken(JSON.stringify({ version: 1, connectionId: "grant-a", accountId: account.id, accountTokenHash, token: "private-facebook-token" })),
    expiresAt: new Date(Date.now() + 3600000), scopes: [...DISCOVERY_SCOPES], revokedAt: null, createdAt: new Date("2026-10-29"), updatedAt: new Date("2026-10-29") };
  target = { id: "7777", username: "competidor", followers_count: 100, media_count: 1, media: { data: [video] } };
  db.musaConnection.findUnique.mockResolvedValue(connection); db.workspaceMember.findUnique.mockResolvedValue({ role: "ADMIN" });
  db.instagramAccount.findMany.mockResolvedValue([account]); db.workspace.findUnique.mockResolvedValue({ id: "workspace-a", name: "Business" });
  db.musaDiscoveryGrant.findUnique.mockImplementation(async () => grant); db.followerSnapshot.findMany.mockResolvedValue([]);
  vi.mocked(reserveAnalyticsRead).mockResolvedValue(undefined); remote.mockImplementation(async input => provider(input));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Discovery scope and effective permissions", () => {
  it("reads public media with the independent credential, preserving identity and hidden counters", async () => {
    target.media = { data: [video, { ...video, id: "7002", like_count: null, comments_count: undefined }] };
    const result = await discovery(request()), body = await result.json();
    expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({ accountId: account.id, instagramId: account.instagramId, provider: "META", state: "partial", coverage: "sample",
      target: { instagramId: "7777", username: "competidor", followers: { value: 100, state: "available" } } });
    expect(body.discoveryGeneration).toMatch(/^[a-f0-9]{64}$/);
    expect(body.media[0]).toMatchObject({ format: "reel", assets: [{ type: "video", url: video.media_url }],
      metrics: { likes: { value: 0, state: "available" }, comments: { value: 2, state: "available" }, views: { value: null, state: "unsupported" },
        reach: { value: null, state: "unsupported" }, saves: { value: null, state: "unsupported" }, shares: { value: null, state: "unsupported" } } });
    expect(body.media[1].metrics.likes).toEqual({ value: null, state: "unsupported" });
    expect(body.media[1].metrics.comments).toEqual({ value: null, state: "unsupported" });
    expect(JSON.stringify(body)).not.toMatch(/private-facebook-token|private-instagram-token|encryptedToken/);
    expect(remote.mock.calls.every(([url, options]) => !String(url).includes("private-") && options?.redirect === "error"
      && options.cache === "no-store" && (options.headers as Record<string, string>).Authorization === "Bearer private-facebook-token")).toBe(true);
    expect(remote.mock.calls.some(([url]) => String(url).includes("insights"))).toBe(false);
    expect(vi.mocked(reserveAnalyticsRead)).toHaveBeenCalledTimes(remote.mock.calls.length);
  });
  it.each(["missing", "revoked", "expired", "scope", "connection", "account", "instagram", "token", "cipher", "actor"])("refuses stale or invalid local consent before Graph: %s", async kind => {
    if (kind === "missing") db.musaDiscoveryGrant.findUnique.mockResolvedValue(null);
    if (kind === "revoked") grant.revokedAt = new Date();
    if (kind === "expired") grant.expiresAt = new Date(0);
    if (kind === "scope") grant.scopes = ["instagram_basic"];
    if (kind === "connection") grant.connectionId = "another";
    if (kind === "account") grant.accountId = "another";
    if (kind === "instagram") grant.instagramId = "9999";
    if (kind === "token") grant.accountTokenHash = "0".repeat(64);
    if (kind === "cipher") grant.encryptedToken = "invalid-ciphertext";
    if (kind === "actor") db.workspaceMember.findUnique.mockImplementation(async ({ where }) => ({ role: where.workspaceId_userId.userId === "reader-admin" ? "MEMBER" : "ADMIN" }));
    expect((await (await discovery(request())).json()).state).toBe("permission_required"); expect(remote).not.toHaveBeenCalled();
  });
  it.each(["connectionId", "accountId", "accountTokenHash"])("rejects a transplanted encrypted envelope %s", async key => {
    grant.encryptedToken = encryptToken(JSON.stringify({ version: 1, connectionId: "grant-a", accountId: account.id,
      accountTokenHash: grant.accountTokenHash, token: "private-facebook-token", [key]: "different" }));
    expect((await (await discovery(request())).json()).state).toBe("permission_required"); expect(remote).not.toHaveBeenCalled();
  });
  it.each(["permission", "user", "page"])("rechecks provider identity and granted permissions: %s", async kind => {
    remote.mockImplementation(async input => {
      const path = new URL(String(input)).pathname;
      if (kind === "permission" && path.endsWith("/permissions")) return json({ data: [] });
      if (kind === "user" && path.endsWith("/me")) return json({ id: "9999" });
      if (kind === "page" && path.endsWith("/4444")) return json({ id: "4444", instagram_business_account: { id: "9999" } });
      return provider(input);
    });
    expect((await (await discovery(request())).json()).state).toBe("permission_required");
    expect(remote.mock.calls.some(([url]) => String(url).includes("business_discovery"))).toBe(false);
  });
  it("does not return fetched data after local revocation races Graph", async () => {
    db.musaDiscoveryGrant.findUnique.mockResolvedValueOnce(grant).mockResolvedValueOnce({ ...grant, revokedAt: new Date() });
    const body = await (await discovery(request())).json();
    expect(body).toMatchObject({ state: "permission_required", target: null, media: [] });
  });
  it("does not return data after the original owner token changes", async () => {
    db.instagramAccount.findMany.mockResolvedValueOnce([account]).mockResolvedValueOnce([{ ...account, accessToken: "changed" }]);
    expect((await (await discovery(request())).json()).state).toBe("permission_required");
  });
  it("rejects a handle reassigned to another stable profile", async () => {
    const body = await (await discovery(request({ targetId: "9999" }))).json();
    expect(body).toMatchObject({ state: "unsupported", target: null, media: [], nextCursor: null });
  });
  it.each(["bad){id}", "@competidor", "", "a".repeat(31)])("rejects unsafe profile grammar %s", async username => {
    expect((await discovery(request({ username }))).status).toBe(400); expect(remote).not.toHaveBeenCalled();
  });
  it("does not accept duplicate query values or ungranted owner accounts", async () => {
    const original = request(); expect((await discovery(new Request(`${original.url}&username=another`, { headers: original.headers }))).status).toBe(400);
    expect((await discovery(request({ accountId: "different" }))).status).toBe(403); expect(remote).not.toHaveBeenCalled();
  });
});

describe("Discovery pagination, formats and rate limits", () => {
  it("continues from an opaque nested after cursor even when Graph has no next URL", async () => {
    target.media = { data: [video], paging: { cursors: { after: "AFTER_1" } } };
    const first = await (await discovery(request())).json();
    expect(first.coverage).toBe("page"); expect(first.nextCursor).toBeTypeOf("string"); expect(first.nextCursor).not.toContain("AFTER_1");
    target.media = { data: [], paging: { cursors: { before: "BEFORE_1" } } };
    const next = await (await discovery(request({ targetId: "7777", cursor: first.nextCursor }))).json();
    expect(next).toMatchObject({ state: "available", coverage: "complete", media: [], nextCursor: null });
    expect(remote.mock.calls.some(([url]) => new URL(String(url)).searchParams.get("fields")?.includes("media.limit(5).after(AFTER_1)"))).toBe(true);
  });
  it("keeps scanning across an old or out-of-order post instead of claiming the period complete", async () => {
    target.media = { data: [{ ...video, timestamp: "2025-01-01T00:00:00Z" }, video], paging: { cursors: { after: "AFTER_1" } } };
    const body = await (await discovery(request())).json(); expect(body.coverage).toBe("page"); expect(body.media).toHaveLength(1);
  });
  it("does not follow Graph next URLs, and labels missing cursor or repeated cursor partial", async () => {
    target.media = { data: [video], paging: { next: "https://attacker.example/?token=private" } };
    let body = await (await discovery(request())).json(); expect(body).toMatchObject({ state: "partial", coverage: "sample", nextCursor: null });
    expect(remote.mock.calls.every(([url]) => new URL(String(url)).hostname === "graph.facebook.com")).toBe(true);
    target.media = { data: [video], paging: { cursors: { after: "AFTER_1" } } };
    body = await (await discovery(request())).json();
    expect(await (await discovery(request({ cursor: body.nextCursor }))).json()).toMatchObject({ state: "partial", coverage: "sample", nextCursor: null });
  });
  it("rejects cursor reuse for another target, range or refreshed consent", async () => {
    target.media = { data: [video], paging: { cursors: { after: "AFTER_1" } } };
    const first = await (await discovery(request())).json(); remote.mockClear();
    for (const extra of [{ username: "other" }, { targetId: "9999" }, { from: "2026-10-02T03:00:00.000Z" }] as Record<string, string>[])
      expect((await discovery(request({ cursor: first.nextCursor, ...extra }))).status).toBe(400);
    grant.updatedAt = new Date("2026-10-30");
    expect((await discovery(request({ cursor: first.nextCursor }))).status).toBe(400); expect(remote).not.toHaveBeenCalled();
  });
  it("expires a cursor without leaking its opaque provider data", () => {
    const value: DiscoveryCursorScope = { identity: { version: 1, connectionId: "grant-a", generation: "a".repeat(64),
      accountId: account.id, instagramId: account.instagramId, provider: "META", apiVersion: "v25.0", observedAt: new Date().toISOString(), range }, username: "competidor", generation: "b".repeat(64) };
    const cursor = encodeDiscoveryCursor(value, "AFTER_1", "7777");
    expect(decodeDiscoveryCursor(value, cursor)).toEqual({ after: "AFTER_1", targetId: "7777" });
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 86400001); expect(() => decodeDiscoveryCursor(value, cursor)).toThrow("Restart the competitor refresh");
  });
  it("renders real carousel children and marks incomplete collections honestly", async () => {
    target.media = { data: [{ ...video, media_type: "CAROUSEL_ALBUM", children: { data: [
      { id: "8001", media_type: "IMAGE", media_url: "https://cdn.example/image.jpg" },
      { id: "8002", media_type: "VIDEO", media_url: "https://cdn.example/child.mp4" }], paging: { cursors: { after: "MORE" } } } }] };
    const body = await (await discovery(request())).json();
    expect(body.media[0]).toMatchObject({ format: "carousel", assetsComplete: false, assets: [{ id: "8001", type: "image" }, { id: "8002", type: "video" }] });
  });
  it("falls back only on unavailable optional fields without fabricating missing assets", async () => {
    target.media = { data: [{ id: "7001", caption: "Text", timestamp: video.timestamp, media_type: "CAROUSEL_ALBUM", permalink: video.permalink }] };
    remote.mockImplementation(async input => {
      const fields = new URL(String(input)).searchParams.get("fields") ?? "";
      if (fields.includes("business_discovery") && fields.includes("media_product_type")) return json({ error: { code: 100 } }, 400);
      return provider(input);
    });
    const body = await (await discovery(request())).json();
    expect(body.state).toBe("partial"); expect(body.media[0]).toMatchObject({ assetsComplete: false, assets: [{ url: null, poster: null }] });
    expect(remote.mock.calls.filter(([url]) => String(url).includes("business_discovery"))).toHaveLength(3);
  });
  it.each([false, true])("propagates internal unavailable/limited budgets without making Graph requests: %s", async limited => {
    vi.mocked(reserveAnalyticsRead).mockRejectedValue(new AnalyticsQuotaError(limited, 7200));
    const response = await discovery(request()); expect(response.status).toBe(limited ? 429 : 503); expect(remote).not.toHaveBeenCalled();
    if (limited) expect(response.headers.get("retry-after")).toBe("7200");
  });
  it("propagates a provider throttle with its wait instead of retrying fields", async () => {
    remote.mockImplementation(async input => String(input).includes("business_discovery")
      ? new Response("", { status: 429, headers: { "Retry-After": "7200" } }) : provider(input));
    const result = await discovery(request()); expect(result.status).toBe(429); expect(result.headers.get("retry-after")).toBe("7200");
    expect(remote.mock.calls.filter(([url]) => String(url).includes("business_discovery"))).toHaveLength(1);
  });
  it.each(["missing", "malformed", "too-many"])("bounds and sanitizes invalid target responses: %s", async kind => {
    if (kind === "missing") target = undefined as unknown as Record<string, unknown>;
    if (kind === "malformed") target.media = { data: [{ ...video, timestamp: "not-a-date" }] };
    if (kind === "too-many") target.media = { data: Array.from({ length: 6 }, () => video) };
    const body = await (await discovery(request())).json(); expect(body.target).toBeNull(); expect(body.media).toEqual([]);
    expect(body.state).toBe(kind === "missing" ? "unsupported" : "temporarily_unavailable");
  });
});

describe("Discovery capability evidence", () => {
  it("reports available only after a real successful Discovery probe matching the linked account", async () => {
    const body = await (await capabilities(request({}, "capabilities"))).json();
    expect(body.capabilities.competitorDiscovery).toBe("available");
    expect(body.discoveryGeneration).toMatch(/^[a-f0-9]{64}$/);
    expect(remote.mock.calls.some(([url]) => new URL(String(url)).searchParams.get("fields") === "business_discovery.username(own){id,username}")).toBe(true);
  });
  it("reports missing consent as permission_required without probing Facebook", async () => {
    db.musaDiscoveryGrant.findUnique.mockResolvedValue(null);
    const body = await (await capabilities(request({}, "capabilities"))).json();
    expect(body.capabilities.competitorDiscovery).toBe("permission_required"); expect(body.discoveryGeneration).toBeNull();
    expect(remote.mock.calls.some(([url]) => String(url).includes("graph.facebook.com"))).toBe(false);
  });
  it("does not advertise a grant as capability when the Discovery probe is unsupported", async () => {
    remote.mockImplementation(async input => String(input).includes("business_discovery") ? json({ error: { code: 100 } }, 400) : provider(input));
    expect((await (await capabilities(request({}, "capabilities"))).json()).capabilities.competitorDiscovery).toBe("pending_validation");
  });
});


describe("Discovery local authorization reconciliation", () => {
  it("returns both current generations without Graph or analytics quota and matches real capability evidence", async () => {
    const response = await status(request({}, "discovery/status")), body = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({ version: 1, connectionId: "grant-a", accountId: account.id, state: "available" });
    expect(body.generation).toMatch(/^[a-f0-9]{64}$/); expect(body.discoveryGeneration).toMatch(/^[a-f0-9]{64}$/);
    expect(Date.parse(body.checkedAt)).not.toBeNaN(); expect(remote).not.toHaveBeenCalled(); expect(reserveAnalyticsRead).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toMatch(/private-|encryptedToken|facebook|pageId|username/);
    const actual = await (await capabilities(request({}, "capabilities"))).json();
    expect(body.generation).toBe(actual.generation); expect(body.discoveryGeneration).toBe(actual.discoveryGeneration);
  });
  it.each(["bridge-revoked", "missing", "revoked", "expired", "actor", "owner-removed", "workspace-removed", "cipher"])("returns a closed state for %s without requiring live read access", async kind => {
    if (kind === "bridge-revoked") db.musaConnection.findUnique.mockResolvedValue({ ...connection, revokedAt: new Date() });
    if (kind === "missing") db.musaDiscoveryGrant.findUnique.mockResolvedValue(null);
    if (kind === "revoked") grant.revokedAt = new Date();
    if (kind === "expired") grant.expiresAt = new Date(0);
    if (kind === "actor") db.workspaceMember.findUnique.mockResolvedValue(null);
    if (kind === "owner-removed") db.instagramAccount.findMany.mockResolvedValue([]);
    if (kind === "workspace-removed") db.workspace.findUnique.mockResolvedValue(null);
    if (kind === "cipher") grant.encryptedToken = null;
    const response = await status(request({}, "discovery/status"));
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ state: "permission_required", generation: null, discoveryGeneration: null });
    expect(remote).not.toHaveBeenCalled(); expect(reserveAnalyticsRead).not.toHaveBeenCalled();
  });
  it("changes Discovery generation on renewed consent but preserves the owner generation", async () => {
    const first = await (await status(request({}, "discovery/status"))).json(); grant.updatedAt = new Date("2026-11-01");
    const second = await (await status(request({}, "discovery/status"))).json();
    expect(second.generation).toBe(first.generation); expect(second.discoveryGeneration).not.toBe(first.discoveryGeneration);
  });
  it("drops status after a bridge revocation races the local read", async () => {
    db.musaConnection.findUnique.mockResolvedValueOnce(connection).mockResolvedValueOnce({ ...connection, revokedAt: new Date() });
    expect(await (await status(request({}, "discovery/status"))).json()).toMatchObject({ state: "permission_required", generation: null, discoveryGeneration: null });
  });
  it("does not reconcile another business or an ungranted account", async () => {
    const original = request({}, "discovery/status"), headers = new Headers(original.headers); headers.set("x-musa-business-id", "another");
    expect((await status(new Request(original.url, { headers }))).status).toBe(401);
    expect((await status(request({ accountId: "another" }, "discovery/status"))).status).toBe(403);
    db.musaConnection.findUnique.mockResolvedValue(null); expect((await status(original)).status).toBe(401);
    expect(remote).not.toHaveBeenCalled(); expect(db.musaDiscoveryGrant.findUnique).not.toHaveBeenCalled();
  });
  it("rejects duplicate and unrelated parameters, and has an eight-second deadline", async () => {
    const original = request({}, "discovery/status");
    expect((await status(new Request(`${original.url}&accountId=another`, { headers: original.headers }))).status).toBe(400);
    expect((await status(request({ username: "competidor" }, "discovery/status"))).status).toBe(400);
    vi.useFakeTimers();
    try {
      db.musaConnection.findUnique.mockImplementation(() => new Promise(() => undefined));
      const pending = status(original); await vi.advanceTimersByTimeAsync(8201); expect((await pending).status).toBe(503);
    } finally { vi.useRealTimers(); }
    expect(remote).not.toHaveBeenCalled();
  });
  it("does not turn a database outage into a revoked grant", async () => {
    db.workspaceMember.findUnique.mockRejectedValue(new Error("sensitive database error"));
    const response = await status(request({}, "discovery/status")); expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("sensitive");
  });
});
