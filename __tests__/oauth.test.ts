import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createOAuthState,
  decryptToken,
  encryptToken,
  getAuthorizationUrl,
  verifyOAuthState,
} from "../lib/meta/oauth";

beforeEach(() => {
  vi.stubEnv("NEXTAUTH_SECRET", "test-secret-with-enough-length");
  vi.stubEnv("INSTAGRAM_APP_ID", "test-app-id");
  vi.stubEnv(
    "ENCRYPTION_KEY",
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  );
});

describe("OAuth state and token encryption", () => {
  it("round-trips encrypted tokens", () => {
    const encrypted = encryptToken("long-lived-token");
    expect(encrypted).not.toBe("long-lived-token");
    expect(decryptToken(encrypted)).toBe("long-lived-token");
  });

  it("signs and verifies Instagram OAuth state", () => {
    const state = createOAuthState("workspace_123");
    expect(verifyOAuthState(state)?.workspaceId).toBe("workspace_123");
  });

  it("rejects tampered OAuth state", () => {
    const state = createOAuthState("workspace_123");
    expect(verifyOAuthState(`${state}tampered`)).toBeNull();
  });

  it("keeps automation scopes unchanged unless publishing is explicitly requested", () => {
    const standard = new URL(getAuthorizationUrl("https://openreply.example/callback", "state"));
    expect(standard.searchParams.get("scope")).toBe("instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_manage_insights");
    const publishing = new URL(getAuthorizationUrl("https://openreply.example/callback", "state", true));
    expect(publishing.searchParams.get("scope")).toBe(`${standard.searchParams.get("scope")},instagram_business_content_publish`);
    expect(new URL(getAuthorizationUrl("https://openreply.example/callback", "state", false)).searchParams.get("scope")).toBe(standard.searchParams.get("scope"));
  });

  it("binds an optional publishing consent to the selected local account", () => {
    const state = createOAuthState("workspace_123", { purpose: "publish", accountId: "account_123" });
    expect(verifyOAuthState(state)).toMatchObject({ workspaceId: "workspace_123", publication: { purpose: "publish", accountId: "account_123" } });
    const [payload, signature] = state.split(".");
    const altered = JSON.parse(Buffer.from(payload, "base64url").toString());
    altered.publication.accountId = "another_account";
    expect(verifyOAuthState(`${Buffer.from(JSON.stringify(altered)).toString("base64url")}.${signature}`)).toBeNull();
    expect(verifyOAuthState(`${state}.extra`)).toBeNull();
  });
});
