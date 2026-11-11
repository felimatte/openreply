import { z } from "zod";
import type { InstagramAccount, MusaConnection } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { decryptToken, encryptToken } from "@/lib/meta/oauth";
import { requireMusaAccount, validateMusaGrantScope, type MusaConnectionContext } from "./auth";
import { MusaIntegrationError } from "./errors";

const opaqueId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const reverseToken = z.string().regex(/^musa_reel_[a-zA-Z0-9_-]{43}$/);
const grantBody = z.object({ version: z.literal(1), token: reverseToken, accountId: opaqueId, instagramId: opaqueId }).strict();
const sealedGrant = grantBody.extend({ connectionId: opaqueId });
const scheduledReel = z.object({
  publicationId: z.uuid(), title: z.string().max(240), scheduledAt: z.iso.datetime({ offset: true }), timezone: z.string().min(1).max(100),
});
const remoteStatus = z.enum(["waiting", "active", "cancelled", "failed"]);
const reservation = z.object({ version: z.literal(1), reservationId: z.uuid(), status: remoteStatus });
const reservationDetails = reservation.extend({ ...scheduledReel.shape,
  reason: z.enum(["media_id_pending", "activation_unconfirmed"]).optional(),
});
const list = z.object({ version: z.literal(1), reels: z.array(scheduledReel).max(100) });

export type Scheduler = {
  connection: MusaConnection;
  account: InstagramAccount;
  token: string;
};

export async function registerSchedulerGrant(context: MusaConnectionContext, input: unknown) {
  const parsed = grantBody.safeParse(input);
  if (!parsed.success) throw new MusaIntegrationError(400, "INVALID_SCHEDULER_GRANT", "La concesión de MUSA no es válida.");
  const account = requireMusaAccount(context, parsed.data.accountId);
  if (account.instagramId !== parsed.data.instagramId)
    throw new MusaIntegrationError(403, "ACCOUNT_NOT_ALLOWED", "La cuenta de Instagram no coincide.");
  const { token, ...scope } = parsed.data;
  const key = { connectionId: context.connectionId, accountId: account.id };
  const observed = await prisma.musaSchedulerGrant.findUnique({ where: { connectionId_accountId: key },
    select: { encryptedToken: true } });
  await listScheduledReels({ connection: context.connection, account, token });
  const encryptedToken = encryptToken(JSON.stringify({ ...scope, token, connectionId: context.connectionId }));
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "MusaConnection" WHERE "id" = ${context.connectionId} FOR NO KEY UPDATE`;
    const connection = await tx.musaConnection.findFirst({ where: { id: context.connectionId, revokedAt: null } });
    if (!connection || !(await validateMusaGrantScope(connection, tx)).some(a => a.id === account.id && a.instagramId === account.instagramId))
      throw new MusaIntegrationError(403, "GRANT_REVOKED", "La conexión de MUSA ya no está disponible.");
    const current = await tx.musaSchedulerGrant.findUnique({ where: { connectionId_accountId: key },
      select: { encryptedToken: true } });
    if (current?.encryptedToken !== observed?.encryptedToken) {
      if (current && decryptToken(current.encryptedToken) === JSON.stringify({ ...scope, token, connectionId: context.connectionId })) return;
      throw new MusaIntegrationError(409, "GRANT_CHANGED", "Otra concesión cambió mientras se comprobaba la cuenta. Reintentá desde MUSA.");
    }
    await tx.musaSchedulerGrant.upsert({
      where: { connectionId_accountId: key },
      create: { connectionId: context.connectionId, accountId: account.id, instagramId: account.instagramId, encryptedToken },
      update: { instagramId: account.instagramId, encryptedToken },
    });
  });
}

export async function requireScheduler(workspaceId: string, accountId: string, connectionId?: string): Promise<Scheduler> {
  const grant = await prisma.musaSchedulerGrant.findFirst({
    where: { accountId, ...(connectionId ? { connectionId } : {}), connection: { workspaceId, revokedAt: null },
      account: { workspaceId } },
    orderBy: [{ updatedAt: "desc" }, { connectionId: "asc" }],
    include: { connection: true, account: true },
  });
  if (!grant) throw new MusaIntegrationError(409, "MUSA_NOT_CONNECTED", "Conectá esta cuenta con MUSA para elegir un Reel programado.");
  const allowed = await validateMusaGrantScope(grant.connection);
  if (!allowed.some(account => account.id === accountId && account.instagramId === grant.instagramId))
    throw new MusaIntegrationError(403, "ACCOUNT_NOT_ALLOWED", "Esta cuenta no está autorizada para la conexión de MUSA.");
  let secret: z.infer<typeof sealedGrant>;
  try { secret = sealedGrant.parse(JSON.parse(decryptToken(grant.encryptedToken))); }
  catch { throw new MusaIntegrationError(503, "MUSA_UNAVAILABLE", "No pudimos comprobar la conexión con MUSA."); }
  if (secret.connectionId !== grant.connectionId || secret.accountId !== accountId || secret.instagramId !== grant.instagramId)
    throw new MusaIntegrationError(403, "ACCOUNT_NOT_ALLOWED", "La concesión no corresponde a esta cuenta.");
  return { connection: grant.connection, account: grant.account, token: secret.token };
}

function schedulerOrigin() {
  try {
    const origin = new URL(process.env.MUSA_SCHEDULER_BASE_URL ?? "");
    const local = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(origin.hostname);
    if (!(origin.protocol === "https:" || local && origin.protocol === "http:") || origin.username ||
      origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error();
    return origin.origin;
  } catch { throw new MusaIntegrationError(503, "MUSA_UNAVAILABLE", "La conexión de programación con MUSA no está disponible."); }
}

async function callScheduler<T>(scheduler: Scheduler, schema: z.ZodType<T>, reservationId?: string, body?: unknown): Promise<T> {
  const endpoint = new URL(`/api/integrations/openreply/scheduled-reels${reservationId ? `/${encodeURIComponent(reservationId)}` : ""}`, schedulerOrigin());
  const { id: accountId, instagramId } = scheduler.account;
  if (!body) endpoint.search = new URLSearchParams({ accountId, instagramId }).toString();
  try {
    const response = await fetch(endpoint, {
      method: body ? "POST" : "GET", cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(8_000),
      headers: { "Authorization": `Bearer ${scheduler.token}`, "Accept": "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 401 || response.status === 403) {
      const result = z.object({ version: z.literal(1), error: z.object({ code: z.string() }) })
        .safeParse(await response.json().catch(() => null));
      const revoked = response.status === 401 && result.success && result.data.error.code === "INVALID_GRANT";
      throw new MusaIntegrationError(409, revoked ? "MUSA_REVERSE_REVOKED" : "MUSA_NOT_CONNECTED",
        "La conexión de esta cuenta con MUSA ya no está disponible.");
    }
    if (response.status === 404 && reservationId)
      throw new MusaIntegrationError(404, "MUSA_RESERVATION_GONE", "La conexión actual ya no puede ver esa reserva.");
    if (response.status === 409 && body)
      throw new MusaIntegrationError(409, "MUSA_REEL_UNAVAILABLE", "Ese Reel ya no está disponible para vincular.");
    if (!response.ok) throw new Error();
    return schema.parse(await response.json());
  } catch (error) {
    if (error instanceof MusaIntegrationError) throw error;
    throw new MusaIntegrationError(503, "MUSA_UNAVAILABLE", "No pudimos confirmar la respuesta de MUSA. Reintentá en un momento.");
  }
}

export async function listScheduledReels(scheduler: Scheduler) {
  return (await callScheduler(scheduler, list)).reels;
}

export async function reserveScheduledReel(scheduler: Scheduler, reservationInput: {
  requestId: string; publicationId: string; automationId: string; flowVersionId: string;
}) {
  return callScheduler(scheduler, reservation, undefined, { version: 1, accountId: scheduler.account.id,
    instagramId: scheduler.account.instagramId, ...reservationInput });
}

export async function getScheduledReel(scheduler: Scheduler, reservationId: string) {
  return callScheduler(scheduler, reservationDetails, reservationId);
}
