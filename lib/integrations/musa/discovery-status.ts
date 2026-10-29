import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { hashMusaCredential, validateMusaGrantScope } from "./auth";
import { analyticsOwnerGeneration } from "./analytics-session";
import { AnalyticsReadError } from "./analytics-transport";
import { loadDiscoveryGrant, confirmDiscoveryGrant } from "./discovery-reader-grant";
import { MusaIntegrationError } from "./errors";

const query = z.object({ accountId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/) }).strict();
type LocalState = "available" | "permission_required" | "unsupported";

/** Credential-state reconciliation only. Never use this context to authorize data reads. */
export async function readDiscoveryStatus(request: Request) {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => params.getAll(key).length !== 1))
    throw new MusaIntegrationError(400, "INVALID_QUERY", "Select one granted Instagram account.");
  const parsed = query.safeParse(Object.fromEntries(params));
  if (!parsed.success) throw new MusaIntegrationError(400, "INVALID_QUERY", "Select one granted Instagram account.");
  const bearer = /^Bearer (musa_[A-Za-z0-9_-]{43})$/.exec(request.headers.get("authorization") ?? "");
  const businessId = request.headers.get("x-musa-business-id");
  if (!bearer || !businessId) throw new MusaIntegrationError(401, "UNAUTHORIZED", "A MUSA connection and business ID are required.");
  const connection = await prisma.musaConnection.findUnique({ where: { tokenHash: hashMusaCredential(bearer[1]) } });
  if (!connection || connection.businessId !== businessId)
    throw new MusaIntegrationError(401, "UNAUTHORIZED", "This MUSA connection is not authorized for the business.");
  const accountId = parsed.data.accountId;
  if (!connection.allowedAccountIds.includes(accountId))
    throw new MusaIntegrationError(403, "ACCOUNT_NOT_ALLOWED", "Select an Instagram account granted to this business.");
  const result = (state: LocalState, generation: string | null = null, discoveryGeneration: string | null = null) => ({
    version: 1 as const, connectionId: connection.id, accountId, state, generation, discoveryGeneration, checkedAt: new Date().toISOString(),
  });
  request.signal.throwIfAborted();
  if (connection.revokedAt) return result("permission_required");
  try {
    const accounts = await validateMusaGrantScope(connection);
    const account = accounts.find(item => item.id === accountId);
    if (!account) return result("permission_required");
    const workspace = await prisma.workspace.findUnique({ where: { id: connection.workspaceId }, select: { id: true } });
    if (!workspace) return result("permission_required");
    const scope = { identity: { connectionId: connection.id }, account, signal: request.signal };
    const grant = await loadDiscoveryGrant(scope);
    await confirmDiscoveryGrant(scope, grant);
    return result("available", analyticsOwnerGeneration(connection.id, account), grant.generation);
  } catch (error) {
    if (error instanceof AnalyticsReadError && (error.state === "permission_required" || error.state === "unsupported")) return result(error.state);
    if (error instanceof MusaIntegrationError && error.status === 403) return result("permission_required");
    throw new MusaIntegrationError(503, "ANALYTICS_UNAVAILABLE", "Authorization status is temporarily unavailable.");
  }
}
