import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { getBaseUrl } from "@/lib/env";

export async function buildFlowTrackedUrl({ runId, nodeId, buttonId, url }: { runId: string; nodeId: string; buttonId: string; url: string }): Promise<string> {
  const destination = new URL(url);
  if (destination.protocol !== "https:" || destination.username || destination.password) throw new Error("El enlace debe ser HTTPS y no contener credenciales.");
  const link = await prisma.flowLink.upsert({
    where: { runId_nodeId_buttonId: { runId, nodeId, buttonId } },
    create: { runId, nodeId, buttonId, destinationUrl: destination.toString(), token: randomBytes(24).toString("base64url") },
    update: {}, select: { token: true },
  });
  return `${getBaseUrl().replace(/\/$/, "")}/f/${link.token}`;
}

export function isAutomatedLinkVisit(userAgent: string | null): boolean {
  return !userAgent || /bot|crawler|spider|facebookexternalhit|facebookcatalog|meta-external|preview|slack|discord|telegrambot|whatsapp/i.test(userAgent);
}
