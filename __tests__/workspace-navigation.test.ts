import { describe, expect, it } from "vitest";
import { workspaceHref } from "@/components/workspace-navigation";

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
