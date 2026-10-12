import { createHash } from "node:crypto";
import type { InstagramAccount, MusaConnection, Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { MusaIntegrationError } from "./errors";

export type MusaConnectionContext = {
  connectionId: string;
  workspaceId: string;
  allowedInstagramAccountIds: string[];
  connection: MusaConnection;
  workspace: { id: string; name: string };
  accounts: InstagramAccount[];
};

export function hashMusaCredential(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Recheck both the human's authority and every granted account, on every request. */
export async function validateMusaGrantScope(
  grant: Pick<MusaConnection, "workspaceId" | "grantedByUserId" | "allowedAccountIds">,
  db: Pick<Prisma.TransactionClient, "workspaceMember" | "instagramAccount"> = prisma,
): Promise<InstagramAccount[]> {
  const membership = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: grant.workspaceId, userId: grant.grantedByUserId } },
    select: { role: true },
  });
  if (!membership || (membership.role !== "OWNER" && membership.role !== "ADMIN")) {
    throw new MusaIntegrationError(403, "GRANT_REVOKED", "The administrator no longer has access. Reconnect MUSA from OpenReply Settings.");
  }
  const ids = [...new Set(grant.allowedAccountIds)];
  if (!ids.length || ids.length !== grant.allowedAccountIds.length) {
    throw new MusaIntegrationError(403, "ACCOUNT_SCOPE_CHANGED", "The granted Instagram accounts are no longer available. Reconnect MUSA.");
  }
  const accounts = await db.instagramAccount.findMany({
    where: { workspaceId: grant.workspaceId, id: { in: ids } },
    orderBy: { id: "asc" },
  });
  if (accounts.length !== ids.length) {
    throw new MusaIntegrationError(403, "ACCOUNT_SCOPE_CHANGED", "The granted Instagram accounts are no longer available. Reconnect MUSA.");
  }
  return accounts;
}

export async function requireMusaConnection(request: Request): Promise<MusaConnectionContext> {
  const bearer = /^Bearer (musa_[A-Za-z0-9_-]{43})$/.exec(request.headers.get("authorization") ?? "");
  const businessId = request.headers.get("x-musa-business-id");
  if (!bearer || !businessId) {
    throw new MusaIntegrationError(401, "UNAUTHORIZED", "A MUSA connection and business ID are required.");
  }
  const connection = await prisma.musaConnection.findUnique({ where: { tokenHash: hashMusaCredential(bearer[1]) } });
  if (!connection || connection.revokedAt || connection.businessId !== businessId) {
    throw new MusaIntegrationError(401, "UNAUTHORIZED", "This MUSA connection is not authorized for the business.");
  }
  const accounts = await validateMusaGrantScope(connection);
  const workspace = await prisma.workspace.findUnique({ where: { id: connection.workspaceId }, select: { id: true, name: true } });
  if (!workspace) throw new MusaIntegrationError(401, "UNAUTHORIZED", "This MUSA connection is no longer available.");
  return { connectionId: connection.id, workspaceId: workspace.id, allowedInstagramAccountIds: [...connection.allowedAccountIds], connection, workspace, accounts };
}

export function requireMusaAccount(context: MusaConnectionContext, accountId: string | null): InstagramAccount {
  const account = context.accounts.find((item) => item.id === accountId);
  if (!account) throw new MusaIntegrationError(403, "ACCOUNT_NOT_ALLOWED", "Select an Instagram account granted to this business.");
  return account;
}

export function publicMusaAccount(account: InstagramAccount) {
  return { id: account.id, instagramId: account.instagramId, username: account.username, provider: account.provider };
}
