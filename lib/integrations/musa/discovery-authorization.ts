import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { MusaDiscoveryFlow, Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { encryptToken } from "@/lib/meta/oauth";
import { hashMusaCredential, requireMusaAccount, requireMusaConnection, validateMusaGrantScope } from "./auth";
import { DISCOVERY_TTL_MS, discoveryAuthorizationUrl, discoveryConfig, discoveryReturnUrl } from "./discovery-config";
import { exchangeDiscoveryGrant } from "./discovery-provider";
import { MusaIntegrationError } from "./errors";

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const input = z.object({ accountId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), returnPath: z.string().max(400) }).strict();
const unavailable = () => new MusaIntegrationError(403, "DISCOVERY_UNAVAILABLE", "Start again from the selected MUSA business and account.");
type Db = Pick<Prisma.TransactionClient, "musaConnection" | "workspaceMember" | "instagramAccount" | "musaDiscoveryFlow" | "musaDiscoveryGrant">;

export async function issueDiscoveryTicket(request: Request, body: unknown) {
  const parsed = input.safeParse(body);
  if (!parsed.success) throw new MusaIntegrationError(400, "INVALID_DISCOVERY_REQUEST", "Select a valid account.");
  const grant = await requireMusaConnection(request), account = requireMusaAccount(grant, parsed.data.accountId);
  if (account.provider !== "META") throw unavailable();
  discoveryConfig(); discoveryReturnUrl(parsed.data.returnPath);
  if (new URL(discoveryReturnUrl(parsed.data.returnPath)).searchParams.get("cuenta") !== account.id) throw unavailable();
  const ticket = randomBytes(32).toString("base64url"), expiresAt = new Date(Date.now() + DISCOVERY_TTL_MS);
  const data = { ticketHash: hashMusaCredential(ticket), stateHash: null, browserHash: null, actorUserId: null,
    accountTokenHash: hashMusaCredential(account.accessToken), instagramId: account.instagramId,
    returnPath: parsed.data.returnPath, consumedAt: null, expiresAt };
  await prisma.musaDiscoveryFlow.upsert({ where: { connectionId_accountId: { connectionId: grant.connectionId, accountId: account.id } },
    create: { connectionId: grant.connectionId, accountId: account.id, ...data }, update: data });
  const url = `${discoveryConfig().baseUrl}/integrations/musa/discovery?ticket=${ticket}`;
  return { version: 1, connectionId: grant.connectionId, accountId: account.id, url, expiresAt: expiresAt.toISOString() };
}

async function validateScope(flow: MusaDiscoveryFlow, userId: string, db: Db = prisma) {
  const grant = await db.musaConnection.findUnique({ where: { id: flow.connectionId } });
  if (!grant || grant.revokedAt) throw unavailable();
  const membership = await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: grant.workspaceId, userId } } });
  if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) throw unavailable();
  const accounts = await validateMusaGrantScope(grant, db), account = accounts.find(item => item.id === flow.accountId);
  if (!account || account.provider !== "META" || account.instagramId !== flow.instagramId
    || hashMusaCredential(account.accessToken) !== flow.accountTokenHash) throw unavailable();
  return { grant, account };
}

export async function discoveryTicket(ticket: string | null, userId: string) {
  if (!ticket || !tokenPattern.test(ticket)) throw unavailable();
  const flow = await prisma.musaDiscoveryFlow.findUnique({ where: { ticketHash: hashMusaCredential(ticket) } });
  if (!flow || flow.consumedAt || flow.stateHash || flow.expiresAt.getTime() <= Date.now()) throw unavailable();
  const scope = await validateScope(flow, userId);
  discoveryReturnUrl(flow.returnPath);
  return { flow, ...scope };
}

export async function beginDiscovery(ticket: string, userId: string) {
  const { flow, grant } = await discoveryTicket(ticket, userId);
  const state = randomBytes(32).toString("base64url"), browser = randomBytes(32).toString("base64url");
  const url = discoveryAuthorizationUrl(state);
  const updated = await prisma.musaDiscoveryFlow.updateMany({ where: { id: flow.id, ticketHash: flow.ticketHash,
    stateHash: null, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { stateHash: hashMusaCredential(state), browserHash: hashMusaCredential(browser), actorUserId: userId } });
  if (updated.count !== 1) throw unavailable();
  return { url, browser, workspaceId: grant.workspaceId };
}

export async function claimDiscovery(state: string | null, browser: string | null, userId: string) {
  if (!state || !browser || !tokenPattern.test(state) || !tokenPattern.test(browser)) throw unavailable();
  return prisma.$transaction(async tx => {
    const where = { stateHash: hashMusaCredential(state), browserHash: hashMusaCredential(browser),
      actorUserId: userId, consumedAt: null, expiresAt: { gt: new Date() } };
    const flow = await tx.musaDiscoveryFlow.findFirst({ where });
    if (!flow) throw unavailable();
    const scope = await validateScope(flow, userId, tx);
    const claimed = await tx.musaDiscoveryFlow.updateMany({ where: { id: flow.id, ...where }, data: { consumedAt: new Date() } });
    if (claimed.count !== 1) throw unavailable();
    return { flow, ...scope };
  });
}

export async function finishDiscovery(claim: Awaited<ReturnType<typeof claimDiscovery>>, code: string, signal: AbortSignal) {
  const { flow, account } = claim;
  const result = await exchangeDiscoveryGrant(code, account, signal);
  signal.throwIfAborted();
  await prisma.$transaction(async tx => {
    // A conditional UPDATE locks this generation until the grant commit. A read
    // alone permits a newer ticket or local revocation to race the old callback.
    const locked = await tx.musaDiscoveryFlow.updateMany({ where: { id: flow.id, stateHash: flow.stateHash,
      actorUserId: flow.actorUserId, consumedAt: { not: null }, expiresAt: { gt: new Date() } }, data: { stateHash: flow.stateHash } });
    if (locked.count !== 1) throw unavailable();
    await validateScope(flow, flow.actorUserId!, tx);
    signal.throwIfAborted();
    const encryptedToken = encryptToken(JSON.stringify({ version: 1, connectionId: flow.connectionId, accountId: flow.accountId,
      accountTokenHash: flow.accountTokenHash, token: result.token }));
    const data = { grantedByUserId: flow.actorUserId!, accountTokenHash: flow.accountTokenHash, instagramId: flow.instagramId,
      instagramUserId: result.instagramUserId, facebookUserId: result.facebookUserId, facebookInstagramId: result.facebookInstagramId,
      pageId: result.pageId, encryptedToken, expiresAt: result.expiresAt, scopes: result.scopes, revokedAt: null };
    await tx.musaDiscoveryGrant.upsert({ where: { connectionId_accountId: { connectionId: flow.connectionId, accountId: flow.accountId } },
      create: { connectionId: flow.connectionId, accountId: flow.accountId, ...data }, update: data });
  });
  return discoveryReturnUrl(flow.returnPath);
}

export async function revokeDiscovery(ticket: string, userId: string) {
  const { flow } = await discoveryTicket(ticket, userId);
  await prisma.$transaction(async tx => {
    const canceled = await tx.musaDiscoveryFlow.updateMany({ where: { id: flow.id, ticketHash: flow.ticketHash },
      data: { stateHash: null, browserHash: null, consumedAt: new Date() } });
    if (canceled.count !== 1) throw unavailable();
    await validateScope(flow, userId, tx);
    await tx.musaDiscoveryGrant.updateMany({ where: { connectionId: flow.connectionId, accountId: flow.accountId },
      data: { encryptedToken: null, revokedAt: new Date() } });
  });
  return discoveryReturnUrl(flow.returnPath);
}
