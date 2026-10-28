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
  ])("rejects missing or ambiguous Page identity", async value => { pageData = value; await expect(exchange()).rejects.toThrow("DISCOVERY_ACCOUNT_MISMATCH"); });
  it("does not follow a provider supplied pagination URL", async () => {
    pageData = { data: [], paging: { next: "https://attacker.example/?token=secret", cursors: { after: "same" } } };
    await expect(exchange()).rejects.toThrow("DISCOVERY_INCOMPLETE_PAGES");
    expect(remote.mock.calls.some(([url]) => String(url).includes("attacker.example"))).toBe(false);
  });
  it("replaces raw provider errors with a closed error", async () => {
    remote.mockResolvedValue(new Response("fake-secret", { status: 500 }));
    await expect(exchange()).rejects.toThrow("DISCOVERY_PROVIDER_UNAVAILABLE");
  });
});
