import { describe, expect, it } from "vitest";
import { z } from "zod";
import { discoveryDiagnostic, discoveryStage } from "@/lib/integrations/musa/discovery-diagnostics";

describe("closed consent diagnostics", () => {
  it.each([
    new Error("https://graph.example?access_token=private-token"),
    new Error("private-token", { cause: { secret: "private-token" } }),
    { message: "DISCOVERY_EXPIRED", token: "private-token" },
    new Error("constructor"),
  ])("never logs arbitrary messages, causes or objects", error => {
    expect(discoveryDiagnostic(error, "complete_grant")).toEqual({ stage: "complete_grant", reason: "unexpected" });
  });
  it("keeps the failed stage without preserving raw validation data", async () => {
    let failure: unknown;
    try { await discoveryStage("token_metadata", async () => z.number().parse("private-token")); }
    catch (error) { failure = error; }
    expect(discoveryDiagnostic(failure, "complete_grant")).toEqual({ stage: "token_metadata", reason: "invalid_response" });
    expect(String(failure)).not.toContain("private-token");
    expect(JSON.stringify(failure)).not.toContain("private-token");
  });
  it("recognizes only closed failure reasons", () => {
    expect(discoveryDiagnostic(new Error("DISCOVERY_EXPIRED"), "complete_grant"))
      .toEqual({ stage: "complete_grant", reason: "expired" });
  });
  it("reports only allowlisted schema fields without values or arbitrary paths", async () => {
    let failure: unknown;
    try {
      await discoveryStage("token_metadata", async () => z.object({ data: z.object({ expires_at: z.number() }), private_field: z.number() })
        .parse({ data: { expires_at: "private-token" }, private_field: "private-token" }));
    } catch (error) { failure = error; }
    expect(discoveryDiagnostic(failure, "complete_grant"))
      .toEqual({ stage: "token_metadata", reason: "invalid_response", fields: ["data.expires_at"] });
    expect(JSON.stringify(failure)).not.toContain("private-token");
    expect(JSON.stringify(failure)).not.toContain("private_field");
  });
});
