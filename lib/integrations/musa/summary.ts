import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { calculateCtr } from "@/lib/tracking/analytics";
import { requireMusaAccount, type MusaConnectionContext } from "./auth";
import { MusaIntegrationError } from "./errors";

const isoDate = z.iso.datetime({ offset: true });

export function musaSummaryPeriod(params: URLSearchParams, now = new Date()) {
  const toValue = params.get("to") ?? now.toISOString();
  const fromValue = params.get("from") ?? new Date(now.getTime() - 30 * 86400_000).toISOString();
  if (!isoDate.safeParse(fromValue).success || !isoDate.safeParse(toValue).success) {
    throw new MusaIntegrationError(400, "INVALID_PERIOD", "Use ISO timestamps with a timezone for from and to.");
  }
  const from = new Date(fromValue);
  const to = new Date(toValue);
  if (from >= to || to.getTime() - from.getTime() > 366 * 86400_000) {
    throw new MusaIntegrationError(400, "INVALID_PERIOD", "Choose a period of up to 366 days with from before to.");
  }
  return { from, to };
}

export async function getMusaSummary(context: MusaConnectionContext, params: URLSearchParams) {
  const account = requireMusaAccount(context, params.get("accountId"));
  const { from, to } = musaSummaryPeriod(params);
  const scope = { workspaceId: context.workspaceId, instagramAccountId: account.id, createdAt: { gte: from, lt: to } };
  const [rows, clicks, contacts] = await Promise.all([
    prisma.dmLog.groupBy({ by: ["status", "dmDeliveryUnconfirmed"], where: scope, _count: { _all: true } }),
    Promise.all([
      prisma.linkClick.count({ where: scope }),
      prisma.flowLinkClick.count({ where: scope }),
    ]).then(([campaignClicks, flowClicks]) => campaignClicks + flowClicks),
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(DISTINCT "commenterId") AS count FROM "DmLog" WHERE "workspaceId" = ${context.workspaceId} AND "instagramAccountId" = ${account.id} AND "createdAt" >= ${from} AND "createdAt" < ${to}`,
  ]);
  const metrics = { sent: 0, failed: 0, skipped: 0, unconfirmed: 0, clicks, contacts: Number(contacts[0]?.count ?? 0), ctr: 0 };
  for (const row of rows) {
    if (row.dmDeliveryUnconfirmed) metrics.unconfirmed += row._count._all;
    else if (row.status === "SENT") metrics.sent += row._count._all;
    else if (row.status === "FAILED") metrics.failed += row._count._all;
    else if (row.status.startsWith("SKIPPED_")) metrics.skipped += row._count._all;
  }
  metrics.ctr = calculateCtr(clicks, metrics.sent);
  return {
    version: 1, accountId: account.id, from: from.toISOString(), to: to.toISOString(), generatedAt: new Date().toISOString(),
    metrics, availability: { automations: true },
    limitations: [
      "Automation activity recorded by OpenReply only; these figures do not measure Instagram profile reach.",
      "The period includes from and excludes to. Contacts counts distinct people in automation logs during this period; pending deliveries are excluded from delivery totals.",
      "Clicks include repeat visits. CTR is clicks divided by confirmed sends, capped at 100%.",
    ],
  };
}
