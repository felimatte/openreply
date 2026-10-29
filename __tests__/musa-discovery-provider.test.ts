import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptToken } from "@/lib/meta/oauth";
import { DISCOVERY_SCOPES, discoveryAuthorizationUrl, discoveryReturnUrl } from "@/lib/integrations/musa/discovery-config";
import { exchangeDiscoveryGrant } from "@/lib/integrations/musa/discovery-provider";

const remote = vi.fn<typeof fetch>();
let account: { instagramId: string; accessToken: string };
let debug: Record<string, unknown>;
let permissions: Array<{ permission: string; status: string }>;
let pageData: unknown;
const body = (value: unknown) => Response.json(value);
beforeEach(() => {
  vi.stubEnv("FACEBOOK_APP_ID", "1234"); vi.stubEnv("FACEBOOK_APP_SECRET", "fake-facebook-secret");
  vi.stubEnv("META_GRAPH_API_VERSION", "v25.0"); vi.stubEnv("NEXTAUTH_URL", "https://openreply.example");
  vi.stubEnv("MUSA_APP_ORIGIN", "https://musa.example"); vi.stubEnv("ENCRYPTION_KEY", "1".repeat(64));
  account = { instagramId: "5678", accessToken: encryptToken("fake-instagram-token") };
  debug = { app_id: "1234", user_id: "9012", type: "USER", is_valid: true,
    expires_at: Math.floor(Date.now() / 1000) + 7200, data_access_expires_at: Math.floor(Date.now() / 1000) + 3600, scopes: [...DISCOVERY_SCOPES] };
  permissions = DISCOVERY_SCOPES.map(permission => ({ permission, status: "granted" }));
  pageData = { data: [{ id: "4444", instagram_business_account: { id: "3333" } }] };
  remote.mockReset().mockImplementation(async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("oauth/access_token")) return body({ access_token: "fake-facebook-token", expires_in: 86400 });
    if (url.pathname.endsWith("debug_token")) return body({ data: debug });
    if (url.pathname.endsWith("me/permissions")) return body({ data: permissions });
    if (url.hostname === "graph.instagram.com") return body({ id: "2222", user_id: "5678" });
    if (url.pathname.endsWith("/5678")) return body({ id: "3333" });
    if (url.pathname.endsWith("me/accounts")) return body(pageData);
    if (url.pathname.endsWith("/4444")) return body({ id: "4444", instagram_business_account: { id: "3333" } });
    throw new Error("Unexpected URL");
  });
  vi.stubGlobal("fetch", remote);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const exchange = () => exchangeDiscoveryGrant("fake-code", account, AbortSignal.timeout(1000));

describe("separate Facebook consent", () => {
  it("asks only for the four explicit read scopes and a server callback", () => {
    const url = new URL(discoveryAuthorizationUrl("random-state"));
    expect(url.origin).toBe("https://www.facebook.com"); expect(url.searchParams.get("scope")?.split(",")).toEqual(DISCOVERY_SCOPES);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe("https://openreply.example/api/integrations/musa/discovery/callback");
    expect(url.toString()).not.toContain("fake-facebook-secret");
  });
  it.each(["https://other.example/b/x/m/content_studio/competencia?cuenta=a", "//other.example", "/settings", "/b/x/m/content_studio/competencia?cuenta=a&next=https://other.example"])("rejects a noncanonical return %s", path => {
    expect(() => discoveryReturnUrl(path)).toThrow();
  });
  it("binds the return to the configured MUSA origin", () => {
    expect(discoveryReturnUrl("/b/shop/m/content_studio/competencia?cuenta=account-a")).toBe("https://musa.example/b/shop/m/content_studio/competencia?cuenta=account-a");
  });
  it("proves cross-login identity through the original token, Graph resolution and linked Page", async () => {
    const grant = await exchange();
    expect(grant).toMatchObject({ facebookUserId: "9012", instagramUserId: "5678", facebookInstagramId: "3333", pageId: "4444" });
    expect(grant.expiresAt.getTime()).toBe((debug.data_access_expires_at as number) * 1000);
    expect(remote.mock.calls.find(([url]) => String(url).includes("graph.instagram.com"))?.[1]?.headers).toEqual({ Authorization: "Bearer fake-instagram-token" });
    expect(remote.mock.calls.every(([, options]) => options?.redirect === "error" && options.cache === "no-store")).toBe(true);
    expect(remote.mock.calls.every(([url]) => !String(url).includes("username"))).toBe(true);
  });
  it("accepts Meta's documented numeric app_id without changing the identity proof", async () => {
    debug.app_id = 1234;
    expect(await exchange()).toMatchObject({ facebookInstagramId: "3333", pageId: "4444" });
  });
  it.each([1234.5, Number.MAX_SAFE_INTEGER + 1, -1234, null, true, {}, "1234.0"])("rejects unsafe or malformed app_id %j", async value => {
    debug.app_id = value;
    await expect(exchange()).rejects.toThrow();
    expect(remote.mock.calls.some(([url]) => String(url).includes("graph.instagram.com"))).toBe(false);
  });
  it.each([{ app_id: "9999" }, { type: "SYSTEM_USER" }, { is_valid: false }, { expires_at: 1 }, { data_access_expires_at: 1 }, { scopes: ["instagram_basic"] }])("rejects invalid token metadata %j", async change => {
    Object.assign(debug, change); await expect(exchange()).rejects.toThrow();
    expect(remote.mock.calls.some(([url]) => String(url).includes("graph.instagram.com"))).toBe(false);
  });
  it("requires every scope in the effective permission response", async () => {
    permissions[2].status = "declined"; await expect(exchange()).rejects.toThrow("DISCOVERY_PERMISSION_REQUIRED");
  });
  it("does not connect a different original Instagram identity", async () => {
    account.instagramId = "9999"; await expect(exchange()).rejects.toThrow("DISCOVERY_ACCOUNT_MISMATCH");
  });
  it.each([{ data: [] }, { data: [{ id: "4444", instagram_business_account: { id: "9999" } }] },
    { data: [{ id: "4444", instagram_business_account: { id: "3333" } }, { id: "5555", instagram_business_account: { id: "3333" } }] },
  ])("rejects missing or ambiguous Page identity", async value => { pageData = value; await expect(exchange()).rejects.toMatchObject({ stage: "linked_page", reason: "account_mismatch" }); });
  it("does not follow a provider supplied pagination URL", async () => {
    pageData = { data: [], paging: { next: "https://attacker.example/?token=secret", cursors: { after: "same" } } };
    await expect(exchange()).rejects.toMatchObject({ stage: "linked_page", reason: "incomplete_pages" });
    expect(remote.mock.calls.some(([url]) => String(url).includes("attacker.example"))).toBe(false);
  });
  it("replaces raw provider errors with a closed error", async () => {
    remote.mockResolvedValue(new Response("fake-secret", { status: 500 }));
    await expect(exchange()).rejects.toMatchObject({ stage: "exchange_code", reason: "provider_unavailable" });
  });
});


describe("authorized granular Page targets", () => {
  function targets(show: unknown, read: unknown = show) {
    debug.granular_scopes = [
      { scope: "pages_show_list", target_ids: show },
      { scope: "pages_read_engagement", target_ids: read },
      // Instagram IDs are not Page candidates, including numbers outside safe precision.
      { scope: "instagram_basic", target_ids: [Number.MAX_SAFE_INTEGER + 1] },
    ];
  }
  function pages(overrides: Record<string, () => Response>) {
    const original = remote.getMockImplementation()!;
    remote.mockImplementation(async (input, options) => {
      const target = new URL(String(input)).pathname.split("/").at(-1)!;
      return overrides[target] ? overrides[target]() : original(input, options);
    });
  }
  const pageReads = () => remote.mock.calls.map(([input]) => new URL(String(input)).pathname)
    .filter(path => /^\/v25\.0\/4\d+$/.test(path));
  beforeEach(() => { pageData = { data: [] }; });

  it("finds an omitted authorized Page and rechecks its exact linked identity", async () => {
    targets([4444, "4444"]);
    expect(await exchange()).toMatchObject({ pageId: "4444", facebookInstagramId: "3333" });
    expect(pageReads()).toEqual(["/v25.0/4444", "/v25.0/4444"]);
    expect(remote.mock.calls.every(([url]) => ["graph.facebook.com", "graph.instagram.com"].includes(new URL(String(url)).hostname))).toBe(true);
  });
  it("uses only the intersection of both Page permissions", async () => {
    targets(["4444", "4555"], ["4444", "4666"]);
    expect(await exchange()).toMatchObject({ pageId: "4444" });
    expect(pageReads()).toEqual(["/v25.0/4444", "/v25.0/4444"]);
  });
  it.each([
    undefined,
    [{ scope: "instagram_basic", target_ids: ["4444"] }],
    [{ scope: "pages_show_list", target_ids: ["4444"] }],
    [{ scope: "pages_show_list", target_ids: ["4444"] }, { scope: "pages_read_engagement" }],
    [{ scope: "pages_show_list", target_ids: null }, { scope: "pages_read_engagement", target_ids: ["4444"] }],
    [{ scope: "pages_show_list", target_ids: [] }, { scope: "pages_read_engagement", target_ids: ["4444"] }],
    [{ scope: "pages_show_list", target_ids: ["4444"] }, { scope: "pages_show_list", target_ids: ["4444"] }, { scope: "pages_read_engagement", target_ids: ["4444"] }],
    [{ scope: "pages_show_list", target_ids: ["4444"] }, { scope: "pages_read_engagement", target_ids: ["4555"] }],
  ].map(granular => ({ granular })))("refuses absent, unbounded, duplicate or disjoint Page grants: %j", async ({ granular }) => {
    if (granular === undefined) delete debug.granular_scopes; else debug.granular_scopes = granular;
    await expect(exchange()).rejects.toMatchObject({ stage: "linked_page", reason: "account_mismatch" });
    expect(pageReads()).toEqual([]);
  });
  it.each([Number.MAX_SAFE_INTEGER + 1, 0, -1, 4.5, "0", "04444", "../4444", {}])("refuses malformed or unsafe Page target %j", async value => {
    targets([value]);
    await expect(exchange()).rejects.toMatchObject({ stage: "linked_page", reason: "invalid_response" });
    expect(pageReads()).toEqual([]);
  });
  it.each([
    [{ scope: "pages_show_list", target_ids: "4444" }],
    [{ scope: "pages_show_list", target_ids: Array.from({ length: 101 }, () => "4444") }],
    Array.from({ length: 201 }, () => ({ scope: "pages_show_list", target_ids: ["4444"] })),
  ].map(value => ({ value })))("bounds malformed granular metadata before reading identities: %j", async ({ value }) => {
    debug.granular_scopes = value;
    await expect(exchange()).rejects.toMatchObject({ stage: "token_metadata", reason: "invalid_response" });
    expect(remote.mock.calls.some(([url]) => String(url).includes("graph.instagram.com"))).toBe(false);
  });
  it("rejects more than ten unique common Page targets without truncating", async () => {
    targets(Array.from({ length: 11 }, (_, index) => String(4444 + index)));
    await expect(exchange()).rejects.toMatchObject({ stage: "linked_page", reason: "incomplete_pages" });
    expect(pageReads()).toEqual([]);
  });
  it("checks all ten candidates for ambiguity before the final selected Page read", async () => {
    targets(Array.from({ length: 10 }, (_, index) => String(4444 + index)));
    pages(Object.fromEntries(Array.from({ length: 9 }, (_, index) => {
      const pageId = String(4445 + index);
      return [pageId, () => body({ id: pageId, instagram_business_account: { id: "9999" } })];
    })));
    expect(await exchange()).toMatchObject({ pageId: "4444" });
    expect(pageReads()).toHaveLength(11);
    expect(pageReads().at(-1)).toBe("/v25.0/4444");
  });
  it("refuses multiple authorized Pages bound to the same Instagram identity", async () => {
    targets(["4444", "4555"]);
    pages({ "4555": () => body({ id: "4555", instagram_business_account: { id: "3333" } }) });
    await expect(exchange()).rejects.toMatchObject({ stage: "linked_page", reason: "account_mismatch" });
    expect(pageReads()).toEqual(["/v25.0/4444", "/v25.0/4555"]);
  });
  it.each([
    { id: "4555", instagram_business_account: { id: "3333" } },
    { id: "4444", instagram_business_account: { id: "9999" } },
    { id: "4444" },
  ])("does not substitute a mismatched Page or Instagram identity: %j", async value => {
    targets(["4444"]); pages({ "4444": () => body(value) });
    await expect(exchange()).rejects.toMatchObject({ stage: "linked_page", reason: "account_mismatch" });
  });
  it.each([403, 500])("fails closed if a later candidate cannot be read (HTTP %i)", async status => {
    targets(["4444", "4555"]); pages({ "4555": () => new Response("private-provider-detail", { status }) });
    await expect(exchange()).rejects.toMatchObject({ stage: "linked_page", reason: "provider_unavailable" });
    expect(pageReads()).toEqual(["/v25.0/4444", "/v25.0/4555"]);
  });
  it("rejects a malformed later candidate instead of accepting an earlier match", async () => {
    targets(["4444", "4555"]); pages({ "4555": () => body({ unexpected: true }) });
    await expect(exchange()).rejects.toMatchObject({ stage: "linked_page", reason: "invalid_response" });
  });
  it("rejects a linked Instagram identity changed during the final recheck", async () => {
    let reads = 0;
    targets(["4444"]); pages({ "4444": () => body({ id: "4444", instagram_business_account: { id: ++reads === 1 ? "3333" : "9999" } }) });
    await expect(exchange()).rejects.toMatchObject({ stage: "linked_page", reason: "account_mismatch" });
    expect(reads).toBe(2);
  });
  it("does not fall back after incomplete enumeration", async () => {
    targets(["4444"]); pageData = { data: [], paging: { next: "https://untrusted.example", cursors: {} } };
    await expect(exchange()).rejects.toMatchObject({ stage: "linked_page", reason: "incomplete_pages" });
    expect(pageReads()).toEqual([]);
  });
  it("keeps an enumerated match and its final recheck without reading other targets", async () => {
    targets(["4555"]); pageData = { data: [{ id: "4444", instagram_business_account: { id: "3333" } }] };
    expect(await exchange()).toMatchObject({ pageId: "4444" });
    expect(pageReads()).toEqual(["/v25.0/4444"]);
  });
});
