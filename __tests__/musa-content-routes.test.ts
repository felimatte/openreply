import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), capability: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/integrations/musa/auth", async original => ({
  ...await original<typeof import("@/lib/integrations/musa/auth")>(), requireMusaConnection: mocks.auth,
}));
vi.mock("@/lib/integrations/musa/publications-capabilities", () => ({ getMusaPublishingCapability: mocks.capability }));
vi.mock("@/lib/integrations/musa/flows", () => ({ listMusaFlows: mocks.list }));
import { GET as accounts } from "@/app/api/integrations/musa/v1/accounts/route";
import { GET as flows } from "@/app/api/integrations/musa/v1/flows/route";
import { MusaIntegrationError } from "@/lib/integrations/musa/errors";

const account = { id: "account-a", instagramId: "ig-a", username: "client-a", provider: "META", accessToken: "must-stay-private" };
const context = { workspaceId: "workspace-a", accounts: [account] };
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue(context); mocks.list.mockResolvedValue({ version: 1, flows: [] }); });

describe("MUSA content route capabilities and flow boundary", () => {
  it.each(["", "?includeStory=1"])("advertises stories only to clients that opt in: %s", async query => {
    mocks.capability.mockResolvedValue({ canPublish: true, supportedFormats: ["reel", "image", "carousel", "story"],
      publishUnavailableReason: null, canAttachStoryFlowOnPublish: true });
    const body = await (await accounts(new Request("https://example.invalid/accounts" + query))).json();
    expect(mocks.capability).toHaveBeenCalledExactlyOnceWith(account, Boolean(query));
    expect(body.accounts[0].supportedFormats).toEqual(query ? ["reel", "image", "carousel", "story"] : ["reel", "image", "carousel"]);
    if (query) expect(body.accounts[0].canAttachStoryFlowOnPublish).toBe(true);
    else expect(body.accounts[0]).not.toHaveProperty("canAttachStoryFlowOnPublish");
  });
  it.each([true, false])("exposes trial transport only with publishing authority: %s", async canPublish => {
    mocks.capability.mockResolvedValue({ canPublish, supportedFormats: canPublish ? ["reel", "image", "carousel"] : [],
      publishUnavailableReason: canPublish ? null : "PUBLISH_PERMISSION_REQUIRED" });
    const response = await accounts(new Request("https://example.invalid/accounts"));
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const result = await response.json();
    expect(result.accounts[0]).toMatchObject({ id: account.id, canPublishTrialReels: canPublish,
      trialUnavailableReason: canPublish ? null : "PUBLISH_PERMISSION_REQUIRED", canAttachFlowOnPublish: true });
    expect(JSON.stringify(result)).not.toContain(account.accessToken);
  });
  it("reads the catalog only for the account authorized by the existing grant", async () => {
    const response = await flows(new Request("https://example.invalid/flows?accountId=account-a"));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ version: 1, flows: [] });
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith(context, "account-a");
  });
  it.each(["", "?accountId=foreign"])("denies missing or foreign flow accounts: %s", async query => {
    expect((await flows(new Request("https://example.invalid/flows" + query))).status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("denies revoked grants before touching a catalog", async () => {
    mocks.auth.mockRejectedValue(new MusaIntegrationError(401, "UNAUTHORIZED", "Revoked"));
    expect((await flows(new Request("https://example.invalid/flows?accountId=account-a"))).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
