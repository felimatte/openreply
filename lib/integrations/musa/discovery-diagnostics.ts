import { ZodError } from "zod";

export type DiscoveryStage = "session" | "query" | "claim" | "consent" | "complete_grant"
  | "exchange_code" | "exchange_long_token" | "token_metadata" | "permissions"
  | "instagram_identity" | "facebook_identity" | "linked_page";
type DiscoveryReason = "invalid_response" | "provider_unavailable" | "permission_required"
  | "expired" | "account_mismatch" | "incomplete_pages" | "aborted" | "unexpected";

const reasons: Record<string, DiscoveryReason> = {
  DISCOVERY_INVALID_RESPONSE: "invalid_response", DISCOVERY_PROVIDER_UNAVAILABLE: "provider_unavailable",
  DISCOVERY_PERMISSION_REQUIRED: "permission_required", DISCOVERY_EXPIRED: "expired",
  DISCOVERY_ACCOUNT_MISMATCH: "account_mismatch", DISCOVERY_INCOMPLETE_PAGES: "incomplete_pages",
};
function safeReason(error: unknown): DiscoveryReason {
  if (error instanceof ZodError) return "invalid_response";
  if (!(error instanceof Error)) return "unexpected";
  if (error.name === "AbortError" || error.name === "TimeoutError") return "aborted";
  return Object.hasOwn(reasons, error.message) ? reasons[error.message] : "unexpected";
}
const diagnosticFields = new Set(["access_token", "expires_in", "data.app_id", "data.user_id", "data.type",
  "data.is_valid", "data.expires_at", "data.data_access_expires_at", "data.scopes", "data", "id", "user_id",
  "paging", "instagram_business_account"]);
class DiscoveryStageError extends Error {
  constructor(readonly stage: DiscoveryStage, readonly reason: DiscoveryReason, readonly fields: string[]) {
    super("DISCOVERY_AUTHORIZATION_FAILED");
  }
}

/** Discard provider details, URLs, credentials and validation inputs at the boundary. */
export async function discoveryStage<T>(stage: DiscoveryStage, action: () => Promise<T>): Promise<T> {
  try { return await action(); }
  catch (error) {
    const fields = error instanceof ZodError
      ? [...new Set(error.issues.map(issue => issue.path.join(".")).filter(path => diagnosticFields.has(path)))].slice(0, 8)
      : [];
    throw new DiscoveryStageError(stage, safeReason(error), fields);
  }
}

/** Only fixed labels reach logs: never serialize an exception or its cause. */
export function discoveryDiagnostic(error: unknown, fallback: DiscoveryStage) {
  return error instanceof DiscoveryStageError
    ? { stage: error.stage, reason: error.reason, ...(error.fields.length ? { fields: error.fields } : {}) }
    : { stage: fallback, reason: safeReason(error) };
}
