import { describe, expect, it } from "vitest";
import { campaignEntryIssues, type CampaignEntrySettings } from "@/components/flows/campaign-entry";

const ready: CampaignEntrySettings = { accountId: "account", scope: "next", postId: null, matchAnyWord: false, keywords: ["GUIA"], excludedKeywords: [], priority: 0, publicReplyEnabled: false, publicReplyMessages: [] };

describe("campaign entry readiness", () => {
  it("allows preparing the next Reel without an existing post", () => {
    expect(campaignEntryIssues(ready)).toEqual([]);
    expect(campaignEntryIssues({ ...ready, scope: "any", matchAnyWord: true, keywords: [] })).toEqual([]);
  });

  it("takes missing entry settings to their corresponding controls", () => {
    expect(campaignEntryIssues({ ...ready, accountId: "", scope: "specific", keywords: [] }).map((issue) => issue.target)).toEqual(["campaign-account", "campaign-post", "campaign-keywords"]);
  });

  it("keeps dormant keywords from blocking any-comment campaigns", () => {
    expect(campaignEntryIssues({ ...ready, matchAnyWord: true, keywords: ["x".repeat(51)] })).toEqual([]);
    expect(campaignEntryIssues({ ...ready, keywords: ["x".repeat(51)] })[0].target).toBe("campaign-keywords");
    expect(campaignEntryIssues({ ...ready, keywords: Array.from({ length: 11 }, (_, index) => `WORD${index}`) })[0].target).toBe("campaign-keywords");
  });

  it("points at advanced controls when exclusions or priority exceed the API limits", () => {
    expect(campaignEntryIssues({ ...ready, excludedKeywords: ["x".repeat(51)], priority: 101 }).map((issue) => issue.target)).toEqual(["excluded-keywords", "campaign-priority"]);
    expect(campaignEntryIssues({ ...ready, priority: 0.5 })[0].target).toBe("campaign-priority");
  });

  it("ignores disabled public replies and validates enabled text", () => {
    expect(campaignEntryIssues({ ...ready, publicReplyMessages: ["x".repeat(1001)] })).toEqual([]);
    expect(campaignEntryIssues({ ...ready, publicReplyEnabled: true, publicReplyMessages: ["x".repeat(1001)] })[0].target).toBe("campaign-public-reply");
  });
});
