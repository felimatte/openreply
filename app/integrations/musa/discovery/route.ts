import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { beginDiscovery, discoveryTicket, revokeDiscovery } from "@/lib/integrations/musa/discovery-authorization";
import { DISCOVERY_CALLBACK, DISCOVERY_COOKIE, DISCOVERY_TTL_MS, discoveryConfig, discoveryReturnUrl } from "@/lib/integrations/musa/discovery-config";
import { discoveryPage } from "@/lib/integrations/musa/discovery-page";

export const runtime = "nodejs";
function failed(): Response { return discoveryPage({ title: "No se pudo iniciar la conexión", message: "Volvé a Musa y solicitá una nueva conexión para esta cuenta.", status: 400 }); }

export async function GET(request: Request): Promise<Response> {
  try {
    const ticket = new URL(request.url).searchParams.get("ticket");
    if (!ticket || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) return failed();
    const userId = await getCurrentUserId();
    if (!userId) {
      const login = new URL("/login", discoveryConfig().baseUrl);
      login.searchParams.set("callbackUrl", `/integrations/musa/discovery?ticket=${ticket}`);
      const response = NextResponse.redirect(login); response.headers.set("Cache-Control", "no-store"); response.headers.set("Referrer-Policy", "no-referrer"); return response;
    }
    const { flow, account, grant } = await discoveryTicket(ticket, userId);
    const existing = await prisma.musaDiscoveryGrant.findUnique({ where: { connectionId_accountId: { connectionId: flow.connectionId, accountId: flow.accountId } } });
    return discoveryPage({ title: "Conectar lectura de competidores", message: "Confirmá la cuenta y el negocio antes de continuar con Meta.",
      ticket, account: account.username, business: grant.businessName, returnUrl: discoveryReturnUrl(flow.returnPath),
      ...(existing && !existing.revokedAt && existing.encryptedToken ? { connectedUntil: existing.expiresAt.toISOString().slice(0, 10) } : {}) });
  } catch { return failed(); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const config = discoveryConfig();
    if (request.headers.get("origin") !== config.baseUrl) return failed();
    const userId = await getCurrentUserId(); if (!userId) return failed();
    const data = new URLSearchParams(await request.text()), ticket = data.get("ticket");
    if (!ticket || data.getAll("ticket").length !== 1 || data.getAll("intent").length !== 1) return failed();
    if (data.get("intent") === "revoke") {
      const returnUrl = await revokeDiscovery(ticket, userId);
      return discoveryPage({ title: "Lectura desconectada", message: "OpenReply dejó de conservar esta autorización de lectura para Musa.", returnUrl });
    }
    if (data.get("intent") !== "connect") return failed();
    const { url, browser } = await beginDiscovery(ticket, userId);
    const response = NextResponse.redirect(url, 303);
    response.cookies.set(DISCOVERY_COOKIE, browser, { httpOnly: true, secure: config.baseUrl.startsWith("https:"), sameSite: "lax",
      path: DISCOVERY_CALLBACK, maxAge: DISCOVERY_TTL_MS / 1000 });
    response.headers.set("Cache-Control", "no-store"); response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch { return failed(); }
}
