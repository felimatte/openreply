import { describe, expect, it } from "vitest";
import { accountScopedHref, initialCampaignAccount, workspaceHref } from "@/components/workspace-navigation";

describe("workspace preview navigation", () => {
  it("keeps real workspace links unchanged", () => {
    expect(workspaceHref("/campaigns", false)).toBe("/campaigns");
  });
  it("keeps the demo dashboard public", () => {
    expect(workspaceHref("/dashboard", true)).toBe("/demo");
  });
  it("explains the sign-in boundary and preserves the requested destination", () => {
    const url = new URL(workspaceHref("/campaigns/new?template=fitness-plan", true), "http://localhost:3001");
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("preview")).toBe("1");
    expect(url.searchParams.get("callbackUrl")).toBe("/campaigns/new?template=fitness-plan");
  });
});

describe("Instagram account handoff", () => {
  it("keeps the exact account when navigating from the MUSA dashboard to a new campaign", () => {
    expect(accountScopedHref("/dashboard", "berraz")).toBe("/dashboard?instagramAccountId=berraz");
    expect(accountScopedHref("/campaigns/new?template=starter", "berraz"))
      .toBe("/campaigns/new?template=starter&instagramAccountId=berraz");
    expect(accountScopedHref("/settings#musa", "berraz")).toBe("/settings?instagramAccountId=berraz#musa");
    expect(accountScopedHref("/campaigns/campaign-a/flow", "berraz")).toBe("/campaigns/campaign-a/flow?instagramAccountId=berraz");
    expect(accountScopedHref("https://elsewhere.example/dashboard", "berraz")).toBe("https://elsewhere.example/dashboard");
    expect(accountScopedHref("/campaigns", "all")).toBe("/campaigns");
  });

  it("selects the requested account even when another is the workspace default", () => {
    const accounts = [{ id: "latest" }, { id: "berraz" }];
    expect(initialCampaignAccount(accounts, "berraz", "latest")).toBe("berraz");
    expect(initialCampaignAccount(accounts, "foreign", "latest")).toBe("");
    expect(initialCampaignAccount(accounts, undefined, "latest")).toBe("latest");
  });
});
