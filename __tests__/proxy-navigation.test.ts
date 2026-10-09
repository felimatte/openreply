import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch as doesProxyMatch } from "next/experimental/testing/server";
import { config, proxy } from "../proxy";

const origin = "https://openreply.example";

describe("workspace navigation authentication", () => {
  it.each([
    "/dashboard",
    "/overview",
    "/inbox",
    "/campaigns",
    "/automations",
    "/contacts",
    "/logs",
    "/settings",
    "/diagnostics",
  ])("sends signed-out visitors from %s to login", (pathname) => {
    expect(doesProxyMatch({ config, nextConfig: {}, url: pathname })).toBe(true);
    const response = proxy(new NextRequest(origin + pathname));
    expect(response.status).toBe(307);
    const destination = new URL(response.headers.get("location")!);
    expect(destination.origin).toBe(origin);
    expect(destination.pathname).toBe("/login");
    expect(destination.searchParams.get("callbackUrl")).toBe(pathname);
  });

  it("preserves a nested campaign destination and its template after sign-in", () => {
    const pathname = "/campaigns/new?template=free-guide&source=demo";
    expect(doesProxyMatch({ config, nextConfig: {}, url: pathname })).toBe(true);
    const response = proxy(new NextRequest(origin + pathname));
    expect(response.status).toBe(307);
    const destination = new URL(response.headers.get("location")!);
    expect(destination.searchParams.get("callbackUrl")).toBe(pathname);
  });

  it.each([
    "authjs.session-token",
    "__Secure-authjs.session-token",
    "next-auth.session-token",
    "__Secure-next-auth.session-token",
  ])("keeps login reachable with a stale %s cookie", (cookie) => {
    const request = new NextRequest(origin + "/login?callbackUrl=%2Fcampaigns", {
      headers: { cookie: `${cookie}=expired-session` },
    });
    expect(doesProxyMatch({ config, nextConfig: {}, url: request.url })).toBe(false);
    const response = proxy(request);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("defers requests with a session cookie to server-side session validation", () => {
    const response = proxy(new NextRequest(origin + "/campaigns", {
      headers: { cookie: "authjs.session-token=unverified-session" },
    }));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it.each(["/demo", "/demo/flow", "/campaigns-public", "/api/automations"])(
    "leaves %s outside workspace page redirects",
    (pathname) => {
      expect(doesProxyMatch({ config, nextConfig: {}, url: pathname })).toBe(false);
      const response = proxy(new NextRequest(origin + pathname));
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-next")).toBe("1");
    },
  );
});
