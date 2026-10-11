import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { hashMusaCredential, publicMusaAccount, validateMusaGrantScope } from "./auth";
import { MusaIntegrationError } from "./errors";

const pairInput = z.object({
  code: z.string().regex(/^musa_pair_[A-Za-z0-9_-]{43}$/),
  businessId: z.uuid(),
  businessName: z.string().trim().min(1).max(200),
}).strict();

export async function exchangeMusaPairingCode(input: unknown) {
  const parsed = pairInput.safeParse(input);
  if (!parsed.success) throw new MusaIntegrationError(400, "INVALID_PAIRING_REQUEST", "Enter a valid pairing code, business ID and name.");
  const { code, businessId, businessName } = parsed.data;
  const codeHash = hashMusaCredential(code);
  const token = `musa_${randomBytes(32).toString("base64url")}`;
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    // This conditional update is the atomic claim. Concurrent callers cannot both consume a code.
    const claim = await tx.musaPairingCode.updateMany({
      where: { codeHash, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (claim.count !== 1) throw new MusaIntegrationError(400, "PAIRING_CODE_UNAVAILABLE", "This pairing code has expired or was already used. Generate a new one in OpenReply Settings.");
    const pairing = await tx.musaPairingCode.findUniqueOrThrow({ where: { codeHash }, include: { workspace: { select: { id: true, name: true } } } });
    const accounts = await validateMusaGrantScope(pairing, tx);
    // Workspace membership exposes every account in OpenReply. A selected account
    // subset only narrows MUSA metrics; it cannot isolate clients inside a workspace.
    // This CAS serializes distinct codes racing to bind the same workspace. Keep
    // the binding after revocation so existing members never inherit a new client.
    const binding = await tx.workspace.updateMany({
      where: { id: pairing.workspaceId, OR: [{ musaBusinessId: null }, { musaBusinessId: businessId }] },
      data: { musaBusinessId: businessId },
    });
    if (binding.count !== 1) throw new MusaIntegrationError(409, "WORKSPACE_ALREADY_BOUND", "This workspace belongs to another MUSA business. Create a separate workspace for this client in OpenReply Settings.");
    // Pairing does not revoke an earlier grant: MUSA must first persist the new
    // credential, and concurrent attempts can still lose its unique business insert.
    // The losing caller revokes only its newly issued grant through DELETE /connection.
    const connection = await tx.musaConnection.create({ data: {
      workspaceId: pairing.workspaceId, businessId, businessName,
      grantedByUserId: pairing.grantedByUserId, allowedAccountIds: pairing.allowedAccountIds,
      tokenHash: hashMusaCredential(token),
    } });
    return { version: 1 as const, connectionId: connection.id, workspace: pairing.workspace, accounts: accounts.map(publicMusaAccount), token };
  });
}

export async function createMusaPairingCode(workspaceId: string, userId: string, accountIds: string[]) {
  const ids = [...new Set(accountIds)];
  if (!ids.length || ids.length > 100) throw new MusaIntegrationError(400, "INVALID_ACCOUNTS", "Select at least one Instagram account.");
  const code = `musa_pair_${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  return prisma.$transaction(async (tx) => {
    await validateMusaGrantScope({ workspaceId, grantedByUserId: userId, allowedAccountIds: ids }, tx);
    const pairing = await tx.musaPairingCode.create({ data: { workspaceId, grantedByUserId: userId, allowedAccountIds: ids, codeHash: hashMusaCredential(code), expiresAt } });
    return { id: pairing.id, code, expiresAt: expiresAt.toISOString() };
  });
}
