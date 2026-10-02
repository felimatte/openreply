import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "../proxy";

describe("login routing", () => {
  it.each(["authjs.session-token", "__Secure-authjs.session-token", "next-auth.session-token", "__Secure-next-auth.session-token"])(
    "lets the login page validate a potentially stale %s cookie", (name) => {
      const response = proxy(new NextRequest("https://openreply.example/login?linkGoogle=1", {
        headers: { cookie: `${name}=expired-or-invalid-token` },
      }));
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-next")).toBe("1");
    },
  );

  it("preserves the protected destination and query while requesting authentication", () => {
    const response = proxy(new NextRequest("https://openreply.example/settings?tab=team&invite=example"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("https://openreply.example");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("callbackUrl")).toBe("/settings?tab=team&invite=example");
  });

  it("allows the login page to render without a session cookie", () => {
    const response = proxy(new NextRequest("https://openreply.example/login"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
