import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLoginRedirect,
  getSignInOptions,
  isGoogleEmailAuthoritative,
  isVerifiedGoogleProfile,
} from "../lib/auth-options";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findUser: vi.fn(),
  ensureWorkspace: vi.fn(),
  getWorkspace: vi.fn(),
}));

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({
    handlers: {},
    auth: mocks.auth,
    signIn: vi.fn(),
    signOut: vi.fn(),
  })),
}));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: vi.fn(() => ({})) }));
vi.mock("@/lib/db/client", () => ({
  prisma: { user: { findUnique: mocks.findUser } },
}));
vi.mock("@/lib/workspace", () => ({
  ensureWorkspaceForUser: mocks.ensureWorkspace,
  getPrimaryWorkspace: mocks.getWorkspace,
}));

type AuthModule = typeof import("../lib/auth");
type SignInInput = Parameters<AuthModule["authConfig"]["callbacks"]["signIn"]>[0];

function googleSignIn(
  userEmail = "creator@example.com",
  profile: SignInInput["profile"] = {
    email: "creator@example.com",
    email_verified: true,
    hd: "example.com",
  },
): SignInInput {
  return {
    user: { id: "user-existing", email: userEmail },
    account: { provider: "google", providerAccountId: "google-sub", type: "oidc" },
    profile,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  for (const name of [
    "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "EMAIL_SERVER", "RESEND_API_KEY",
    "ALLOWED_EMAILS", "NEXTAUTH_SECRET",
  ]) vi.stubEnv(name, "");
});

afterEach(() => vi.unstubAllEnvs());

describe("available login methods", () => {
  it("does not advertise an unconfigured provider", () => {
    expect(getSignInOptions({ NODE_ENV: "test" })).toEqual({
      google: false, email: false, emailProviderId: "resend",
    });
  });

  it.each([
    { AUTH_GOOGLE_ID: "id" },
    { AUTH_GOOGLE_SECRET: "secret" },
    { AUTH_GOOGLE_ID: "id", AUTH_GOOGLE_SECRET: "  " },
  ])("requires both Google credentials: %j", (env) => {
    expect(getSignInOptions({ NODE_ENV: "test", ...env }).google).toBe(false);
  });

  it("supports Google without an email service", () => {
    expect(getSignInOptions({ NODE_ENV: "test", AUTH_GOOGLE_ID: " id ", AUTH_GOOGLE_SECRET: " secret " }))
      .toMatchObject({ google: true, email: false });
  });

  it("prefers SMTP when both email transports exist", () => {
    expect(getSignInOptions({ NODE_ENV: "test", EMAIL_SERVER: "smtp://example.com", RESEND_API_KEY: "test-key" }))
      .toMatchObject({ email: true, emailProviderId: "nodemailer" });
  });

  it("uses Resend when SMTP is blank", () => {
    expect(getSignInOptions({ NODE_ENV: "test", EMAIL_SERVER: "  ", RESEND_API_KEY: "test-key" }))
      .toMatchObject({ email: true, emailProviderId: "resend" });
  });

  it("registers Google without implicit email account merging", async () => {
    vi.stubEnv("AUTH_GOOGLE_ID", " test-client ");
    vi.stubEnv("AUTH_GOOGLE_SECRET", " test-secret ");
    const { authConfig } = await import("../lib/auth");
    expect(authConfig.providers).toHaveLength(1);
    const provider = authConfig.providers[0];
    expect(provider).toMatchObject({
      id: "google", type: "oidc",
      options: { clientId: "test-client", clientSecret: "test-secret" },
    });
    expect(provider).not.toHaveProperty("allowDangerousEmailAccountLinking", true);
    expect(provider.options).not.toHaveProperty("allowDangerousEmailAccountLinking", true);
  });

  it("registers no placeholder email provider when mail is unavailable", async () => {
    const { authConfig } = await import("../lib/auth");
    expect(authConfig.providers).toEqual([]);
  });

  it.each([
    ["EMAIL_SERVER", "smtp://example.com", "nodemailer"],
    ["RESEND_API_KEY", "test-resend-key", "resend"],
  ])("retains the %s email fallback", async (env, value, id) => {
    vi.stubEnv(env, value);
    const { authConfig, EMAIL_PROVIDER_ID } = await import("../lib/auth");
    expect(authConfig.providers.map((provider) => provider.id)).toEqual([id]);
    expect(EMAIL_PROVIDER_ID).toBe(id);
  });
});

describe("Google identity and allowlist", () => {
  it.each([
    undefined, null, "profile", {}, { email: "creator@example.com" },
    { email: "creator@example.com", email_verified: false },
    { email: "creator@example.com", email_verified: "true" },
    { email: "creator@example.com", email_verified: 1 },
    { email: "  ", email_verified: true },
    { email: null, email_verified: true },
  ])("rejects a missing or unverified profile: %j", (profile) => {
    expect(isVerifiedGoogleProfile(profile)).toBe(false);
  });

  it("distinguishes the verification marker from current email authority", () => {
    expect(isVerifiedGoogleProfile({ email: "creator@example.com", email_verified: true }))
      .toBe(true);
  });

  it.each([
    { email: "creator@gmail.com", email_verified: true },
    { email: "CREATOR@GMAIL.COM", email_verified: true },
    { email: "creator@example.com", email_verified: true, hd: "example.com" },
  ])("trusts a verified Gmail or hosted Workspace identity: %j", (profile) => {
    expect(isGoogleEmailAuthoritative(profile)).toBe(true);
  });

  it.each([
    undefined, null, {},
    { email: "creator@example.com", email_verified: true },
    { email: "creator@example.com", email_verified: true, hd: "" },
    { email: "creator@example.com", email_verified: true, hd: "  " },
    { email: "creator@example.com", email_verified: true, hd: false },
    { email: "creator@example.com", email_verified: true, hd: 1 },
    { email: "creator@gmail.com.evil", email_verified: true },
    { email: "creator@fakegmail.com", email_verified: true },
    { email: "creator@gmail.com", email_verified: false },
    { email: "creator@example.com", email_verified: false, hd: "example.com" },
  ])("does not treat historical verification as current mailbox authority: %j", (profile) => {
    expect(isGoogleEmailAuthoritative(profile)).toBe(false);
  });

  it.each([
    { email: "creator@example.com", email_verified: true },
    { email: "creator@example.com", email_verified: true, hd: "  " },
    { email: "creator@example.com", email_verified: true, hd: false },
    { email: "creator@gmail.com.evil", email_verified: true },
  ])("requires email login before an unsupported Google address can accept invitations: %j", async (profile) => {
    const { authConfig } = await import("../lib/auth");
    await expect(authConfig.callbacks.signIn(googleSignIn(profile.email, profile)))
      .resolves.toBe("/login?error=GoogleEmailNotSupported");
    expect(mocks.ensureWorkspace).not.toHaveBeenCalled();
  });

  it("enforces verification even with no allowlist", async () => {
    const { authConfig } = await import("../lib/auth");
    await expect(authConfig.callbacks.signIn(googleSignIn("creator@example.com", {
      email: "creator@example.com", email_verified: false,
    }))).resolves.toBe(false);
    await expect(authConfig.callbacks.signIn({ ...googleSignIn(), profile: undefined }))
      .resolves.toBe(false);
    await expect(authConfig.callbacks.signIn(googleSignIn())).resolves.toBe(true);
  });

  it("blocks a disallowed current Google email even if the stored user is allowed", async () => {
    vi.stubEnv("ALLOWED_EMAILS", "creator@example.com");
    const { authConfig } = await import("../lib/auth");
    await expect(authConfig.callbacks.signIn(googleSignIn("creator@example.com", {
      email: "outsider@example.com", email_verified: true, hd: "example.com",
    }))).resolves.toBe(false);
  });

  it("blocks a disallowed stored user even if the Google profile is allowed", async () => {
    vi.stubEnv("ALLOWED_EMAILS", "creator@example.com");
    const { authConfig } = await import("../lib/auth");
    await expect(authConfig.callbacks.signIn(googleSignIn("outsider@example.com")))
      .resolves.toBe(false);
    await expect(authConfig.callbacks.signIn(googleSignIn())).resolves.toBe(true);
  });

  it("applies the allowlist before sending and after verifying an email link", async () => {
    vi.stubEnv("ALLOWED_EMAILS", "creator@example.com");
    const { authConfig } = await import("../lib/auth");
    for (const email of [{ verificationRequest: true as const }, undefined]) {
      for (const [address, allowed] of [["creator@example.com", true], ["outsider@example.com", false]] as const) {
        await expect(authConfig.callbacks.signIn({
          user: { email: address },
          account: { provider: "resend", providerAccountId: address, type: "email" },
          email,
        })).resolves.toBe(allowed);
      }
    }
  });
});

describe("session and workspace continuity", () => {
  it("keeps database sessions and exposes the existing user ID", async () => {
    const { authConfig } = await import("../lib/auth");
    expect(authConfig.session.strategy).toBe("database");
    type Input = Parameters<typeof authConfig.callbacks.session>[0];
    const input = {
      user: { id: "user-existing", email: "creator@example.com", emailVerified: new Date() },
      session: { user: { id: "", email: "creator@example.com" }, expires: "2030-01-01T00:00:00Z" },
    } as Input;
    await expect(authConfig.callbacks.session(input)).resolves.toMatchObject({
      user: { id: "user-existing" },
    });
  });

  it("initializes the workspace through the existing idempotent helper", async () => {
    const { authConfig } = await import("../lib/auth");
    await authConfig.events.createUser({ user: { id: "user-existing", email: "creator@example.com" } });
    expect(mocks.ensureWorkspace).toHaveBeenCalledExactlyOnceWith("user-existing", "creator@example.com");
  });

  it("does not query workspaces or users without an authenticated session", async () => {
    mocks.auth.mockResolvedValue(null);
    const { getCurrentWorkspaceId } = await import("../lib/auth");
    await expect(getCurrentWorkspaceId()).resolves.toBeNull();
    expect(mocks.getWorkspace).not.toHaveBeenCalled();
    expect(mocks.findUser).not.toHaveBeenCalled();
    expect(mocks.ensureWorkspace).not.toHaveBeenCalled();
  });

  it("preserves an existing workspace instead of creating another", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-existing" } });
    mocks.getWorkspace.mockResolvedValue({ id: "workspace-existing" });
    const { getCurrentWorkspaceId } = await import("../lib/auth");
    await expect(getCurrentWorkspaceId()).resolves.toBe("workspace-existing");
    expect(mocks.getWorkspace).toHaveBeenCalledWith("user-existing");
    expect(mocks.ensureWorkspace).not.toHaveBeenCalled();
    expect(mocks.findUser).not.toHaveBeenCalled();
  });

  it("uses only the authenticated user when a workspace must be initialized", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-existing" } });
    mocks.getWorkspace.mockResolvedValue(null);
    mocks.findUser.mockResolvedValue({ email: "creator@example.com" });
    mocks.ensureWorkspace.mockResolvedValue({ id: "workspace-new" });
    const { getCurrentWorkspaceId } = await import("../lib/auth");
    await expect(getCurrentWorkspaceId()).resolves.toBe("workspace-new");
    expect(mocks.findUser).toHaveBeenCalledWith({
      where: { id: "user-existing" }, select: { email: true },
    });
    expect(mocks.ensureWorkspace).toHaveBeenCalledWith("user-existing", "creator@example.com");
  });
});

describe("login return destinations", () => {
  it("keeps local template and invitation destinations", () => {
    expect(getLoginRedirect("/campaigns/new?template=guide#preview"))
      .toBe("/campaigns/new?template=guide#preview");
    expect(getLoginRedirect("/invite/token-example")).toBe("/invite/token-example");
  });

  it.each([
    undefined, "", "https://outside.example", "//outside.example", "/\\outside.example",
    "/a/..//outside.example", "/a/%2e%2e//outside.example", "/hello world", "/\noutside.example",
    "/login", "/login?linkGoogle=1", "/api/auth/signin/google", "/a/../login",
  ])("rejects unsafe or looping return destination: %j", (value) => {
    expect(getLoginRedirect(value)).toBe("/dashboard");
  });

  it("retains a caller-provided trusted fallback", () => {
    expect(getLoginRedirect("https://outside.example", "/campaigns/new"))
      .toBe("/campaigns/new");
  });
});
