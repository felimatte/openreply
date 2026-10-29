import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { decryptToken } from "@/lib/meta/oauth";
import { hashMusaCredential, validateMusaGrantScope } from "./auth";
import { MusaIntegrationError } from "./errors";
import { DISCOVERY_SCOPES } from "./discovery-config";
import { AnalyticsReadError, readFacebookAnalytics } from "./analytics-transport";
import type { AnalyticsSession } from "./analytics-session";

const id = z.string().regex(/^\d{1,40}$/);
const envelope = z.object({ version: z.literal(1), connectionId: z.string(), accountId: z.string(),
  accountTokenHash: z.string(), token: z.string().min(1).max(8192) }).strict();
const denied = () => new AnalyticsReadError("permission_required");

type LocalDiscoveryScope = { account: AnalyticsSession["account"]; identity: Pick<AnalyticsSession["identity"], "connectionId"> };

export async function loadDiscoveryGrant(session: LocalDiscoveryScope) {
  if (session.account.provider !== "META") throw new AnalyticsReadError("unsupported");
  const grant = await prisma.musaDiscoveryGrant.findUnique({ where: { connectionId_accountId: {
    connectionId: session.identity.connectionId, accountId: session.account.id } } });
  if (!grant || grant.revokedAt || !grant.encryptedToken || grant.expiresAt.getTime() <= Date.now() + 1000
    || grant.connectionId !== session.identity.connectionId || grant.accountId !== session.account.id
    || grant.instagramId !== session.account.instagramId || grant.accountTokenHash !== hashMusaCredential(session.account.accessToken)
    || DISCOVERY_SCOPES.some(scope => !grant.scopes.includes(scope))
    || ![grant.facebookInstagramId, grant.instagramUserId, grant.facebookUserId, grant.pageId].every(value => id.safeParse(value).success)) throw denied();
  const actor = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: {
    workspaceId: session.account.workspaceId, userId: grant.grantedByUserId } }, select: { role: true } });
  if (!actor || !["OWNER", "ADMIN"].includes(actor.role)) throw denied();
  let credential: z.infer<typeof envelope>;
  try { credential = envelope.parse(JSON.parse(decryptToken(grant.encryptedToken))); } catch { throw denied(); }
  if (credential.connectionId !== grant.connectionId || credential.accountId !== grant.accountId
    || credential.accountTokenHash !== grant.accountTokenHash) throw denied();
  const generation = hashMusaCredential(JSON.stringify([grant.id, grant.connectionId, grant.accountId, grant.accountTokenHash,
    grant.facebookInstagramId, grant.pageId, grant.facebookUserId, grant.expiresAt.toISOString(), grant.updatedAt.toISOString(),
    hashMusaCredential(grant.encryptedToken)]));
  return { ...grant, token: credential.token, generation };
}
export type DiscoveryReaderGrant = Awaited<ReturnType<typeof loadDiscoveryGrant>>;

/** The original token binding and the linked Page must still be authorized. */
export async function verifyDiscoveryProvider(session: AnalyticsSession, grant: DiscoveryReaderGrant): Promise<void> {
  const read = (path: string, fields?: string) => readFacebookAnalytics(session.context, grant.token, path,
    new URLSearchParams(fields ? { fields } : {}), session.signal);
  const [user, permissions, page] = await Promise.all([read("/me", "id"), read("/me/permissions"),
    read(`/${grant.pageId}`, "id,instagram_business_account{id}")]);
  const identity = z.object({ id }).parse(user);
  const allowed = z.object({ data: z.array(z.object({ permission: z.string(), status: z.string() })).max(200) }).parse(permissions);
  const linked = z.object({ id, instagram_business_account: z.object({ id }).optional() }).parse(page);
  if (identity.id !== grant.facebookUserId || linked.id !== grant.pageId || linked.instagram_business_account?.id !== grant.facebookInstagramId
    || DISCOVERY_SCOPES.some(scope => !allowed.data.some(item => item.permission === scope && item.status === "granted"))) throw denied();
}

/** Drop a completed read if consent, membership or account changed while Graph was running. */
export async function confirmDiscoveryGrant(session: LocalDiscoveryScope & { signal: AbortSignal }, grant: DiscoveryReaderGrant): Promise<void> {
  session.signal.throwIfAborted();
  const connection = await prisma.musaConnection.findUnique({ where: { id: session.identity.connectionId } });
  if (!connection || connection.revokedAt || connection.workspaceId !== session.account.workspaceId) throw denied();
  const accounts = await validateMusaGrantScope(connection).catch(error => {
    if (error instanceof MusaIntegrationError && error.status === 403) throw denied();
    throw error;
  });
  const account = accounts.find(item => item.id === session.account.id);
  if (!account || account.provider !== "META" || account.instagramId !== session.account.instagramId
    || account.accessToken !== session.account.accessToken || account.connectedAt.getTime() !== session.account.connectedAt.getTime()) throw denied();
  if ((await loadDiscoveryGrant(session)).generation !== grant.generation) throw denied();
  session.signal.throwIfAborted();
}
