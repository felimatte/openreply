import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  signIn: vi.fn(),
  redirect: vi.fn(),
  getCookie: vi.fn(),
  setCookie: vi.fn(),
  isDemo: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mocks.auth, signIn: mocks.signIn, EMAIL_PROVIDER_ID: "resend",
}));
vi.mock("next-auth", async () => {
  const { AuthError } = await import("@auth/core/errors");
  return { AuthError };
});
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.getCookie, set: mocks.setCookie }),
}));
vi.mock("@/lib/env", () => ({ isPublicDemoHost: mocks.isDemo }));
vi.mock("@/lib/i18n/server", () => ({
  getI18n: async () => ({ t: (text: string) => text }),
}));
vi.mock("@/components/demo-notice", () => ({ DemoNotice: () => null }));

import LoginPage from "../app/login/page";

type Element = ReactElement<Record<string, unknown>>;
type LoginParams = Awaited<Parameters<typeof LoginPage>[0]["searchParams"]>;

function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

function textContent(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  if (isValidElement<{ children?: ReactNode }>(node)) return textContent(node.props.children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}

function formAction(tree: ReactNode, buttonText: string) {
  const form = elements(tree).find((element) =>
    element.type === "form" && elements(element).some((child) =>
      child.type === "button" && textContent(child) === buttonText,
    ),
  );
  expect(form, `form with button "${buttonText}"`).toBeDefined();
  expect(form?.props.action).toBeTypeOf("function");
  return form!.props.action as (data: FormData) => Promise<void>;
}

function render(params: LoginParams = {}) {
  return LoginPage({ searchParams: Promise.resolve(params) });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue(null);
  mocks.isDemo.mockResolvedValue(false);
  mocks.redirect.mockImplementation((destination: string) => {
    throw new Error(`NEXT_REDIRECT:${destination}`);
  });
  vi.stubEnv("AUTH_GOOGLE_ID", "test-google-id");
  vi.stubEnv("AUTH_GOOGLE_SECRET", "test-google-secret");
  vi.stubEnv("RESEND_API_KEY", "test-resend-key");
  vi.stubEnv("EMAIL_SERVER", "");
  vi.stubEnv("NEXTAUTH_URL", "https://openreply.example");
});

afterEach(() => vi.unstubAllEnvs());

describe("login methods", () => {
  it("offers Google first and keeps email available without starting a login on render", async () => {
    const tree = await render();
    const buttons = elements(tree).filter((element) => element.type === "button").map(textContent);
    expect(buttons).toEqual(["Continue with Google", "Email me a magic link"]);
    expect(elements(tree).find((element) => element.type === "details")?.props.open).toBe(false);
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("supports Google without a mail service", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const tree = await render();
    expect(textContent(tree)).toContain("Continue with Google");
    expect(textContent(tree)).not.toContain("Email me a magic link");
    expect(elements(tree).filter((element) => element.type === "form")).toHaveLength(1);
  });

  it("retains email-only login when Google is not configured", async () => {
    vi.stubEnv("AUTH_GOOGLE_SECRET", "");
    const tree = await render();
    expect(textContent(tree)).not.toContain("Continue with Google");
    const data = new FormData();
    data.set("email", " creator@example.com ");
    await formAction(tree, "Email me a magic link")(data);
    expect(mocks.signIn).toHaveBeenCalledExactlyOnceWith("resend", {
      email: "creator@example.com", redirectTo: "/dashboard",
    });
  });

  it("shows an unavailable state without offering unconfigured methods", async () => {
    vi.stubEnv("AUTH_GOOGLE_SECRET", "");
    vi.stubEnv("RESEND_API_KEY", "");
    const tree = await render();
    expect(elements(tree).filter((element) => element.type === "form")).toHaveLength(0);
    expect(textContent(tree)).toContain("Sign-in is currently unavailable.");
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("offers email immediately when Google cannot verify the external mailbox", async () => {
    const tree = await render({ error: "GoogleEmailNotSupported" });
    expect(textContent(tree)).toContain("Use a Gmail or Google Workspace account");
    expect(elements(tree).find((element) => element.type === "details")?.props.open).toBe(true);
    const data = new FormData();
    data.set("email", "creator@example.com");
    await formAction(tree, "Email me a magic link")(data);
    expect(mocks.signIn).toHaveBeenCalledWith("resend", {
      email: "creator@example.com", redirectTo: "/dashboard",
    });
  });
});

describe("existing account migration", () => {
  it("preserves the destination across OAuth failure, email verification, and Google linking", async () => {
    const destination = "/campaigns/new?template=lead-magnet";
    mocks.getCookie.mockReturnValue({ value: destination });
    const failedLogin = await render({ error: "OAuthAccountNotLinked" });
    expect(textContent(failedLogin)).toContain("Sign in by email once");
    expect(elements(failedLogin).find((element) => element.type === "details")?.props.open).toBe(true);
    const data = new FormData();
    data.set("email", "creator@gmail.com");
    await formAction(failedLogin, "Email me a magic link")(data);

    const emailDestination = new URL(mocks.signIn.mock.calls[0][1].redirectTo, "https://openreply.example");
    expect(emailDestination.pathname).toBe("/login");
    expect(emailDestination.searchParams.get("linkGoogle")).toBe("1");
    expect(emailDestination.searchParams.get("callbackUrl")).toBe(destination);

    mocks.auth.mockResolvedValue({ user: { id: "existing-user", email: "creator@gmail.com" } });
    const connectedSession = await render({ linkGoogle: "1", callbackUrl: destination });
    expect(textContent(connectedSession)).toContain("Connect Google once.");
    expect(textContent(connectedSession)).not.toContain("Email me a magic link");
    expect(mocks.redirect).not.toHaveBeenCalled();
    await formAction(connectedSession, "Connect Google")(new FormData());
    expect(mocks.signIn).toHaveBeenLastCalledWith("google", {
      redirectTo: destination,
    }, { prompt: "select_account" });
    expect(mocks.setCookie).toHaveBeenLastCalledWith("openreply-login-destination", destination, {
      httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 1800,
    });
  });

  it("does not treat a linking URL as proof of an authenticated session", async () => {
    const tree = await render({ linkGoogle: "1", callbackUrl: "/settings?tab=team" });
    expect(textContent(tree)).toContain("Continue with Google");
    expect(textContent(tree)).not.toContain("Connect Google once.");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("redirects a validated existing session to its intended destination", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "existing-user" } });
    await expect(render({ callbackUrl: "/settings?tab=team" }))
      .rejects.toThrow("NEXT_REDIRECT:/settings?tab=team");
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
});

describe("return destination and action failures", () => {
  it.each(["https://outside.example", "//outside.example", "/a/..//outside.example", "/login?linkGoogle=1"])(
    "rejects an unsafe destination saved in a cookie: %s", async (value) => {
      mocks.getCookie.mockReturnValue({ value });
      const tree = await render({ error: "OAuthCallbackError" });
      await formAction(tree, "Continue with Google")(new FormData());
      expect(mocks.signIn).toHaveBeenCalledWith("google", { redirectTo: "/dashboard" }, { prompt: "select_account" });
      expect(mocks.setCookie).toHaveBeenCalledWith("openreply-login-destination", "/dashboard", expect.any(Object));
    },
  );

  it("does not reuse an old destination for a fresh login", async () => {
    mocks.getCookie.mockReturnValue({ value: "/settings?tab=team" });
    const tree = await render();
    await formAction(tree, "Continue with Google")(new FormData());
    expect(mocks.signIn).toHaveBeenCalledWith("google", { redirectTo: "/dashboard" }, { prompt: "select_account" });
  });

  it("rethrows framework navigation instead of converting a successful sign-in into an error", async () => {
    const navigation = new Error("NEXT_REDIRECT:https://accounts.google.com");
    mocks.signIn.mockRejectedValue(navigation);
    const tree = await render();
    await expect(formAction(tree, "Continue with Google")(new FormData())).rejects.toBe(navigation);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("redirects an authentication error back to a recoverable login with the destination", async () => {
    const { AccessDenied } = await import("@auth/core/errors");
    mocks.signIn.mockRejectedValue(new AccessDenied());
    const tree = await render({ callbackUrl: "/settings?tab=team" });
    await expect(formAction(tree, "Continue with Google")(new FormData())).rejects.toThrow("NEXT_REDIRECT:/login?");
    const errorUrl = new URL(mocks.redirect.mock.calls[0][0], "https://openreply.example");
    expect(errorUrl.searchParams.get("error")).toBe("AccessDenied");
    expect(errorUrl.searchParams.get("callbackUrl")).toBe("/settings?tab=team");
  });
});
