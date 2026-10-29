import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { claimDiscovery, finishDiscovery } from "@/lib/integrations/musa/discovery-authorization";
import { DISCOVERY_CALLBACK, DISCOVERY_COOKIE, discoveryReturnUrl } from "@/lib/integrations/musa/discovery-config";
import { discoveryDiagnostic, type DiscoveryStage } from "@/lib/integrations/musa/discovery-diagnostics";
import { discoveryPage } from "@/lib/integrations/musa/discovery-page";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: NextRequest): Promise<Response> {
  let result: Response, returnUrl: string | undefined;
  let stage: DiscoveryStage = "session";
  try {
    const userId = await getCurrentUserId(); if (!userId) throw new Error("NO_SESSION");
    stage = "query";
    const params = request.nextUrl.searchParams;
    for (const key of ["state", "code", "error"]) if (params.getAll(key).length > 1) throw new Error("INVALID_QUERY");
    stage = "claim";
    const claim = await claimDiscovery(params.get("state"), request.cookies.get(DISCOVERY_COOKIE)?.value ?? null, userId);
    returnUrl = discoveryReturnUrl(claim.flow.returnPath);
    stage = "consent";
    const code = params.get("code");
    if (params.has("error") || !code || code.length > 8192) throw new Error("DENIED");
    stage = "complete_grant";
    await finishDiscovery(claim, code, AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]));
    result = discoveryPage({ title: "Autorización de lectura guardada", message: "Verificamos tu Página y la cuenta de Instagram. Falta completar la prueba de consulta de competidores antes de activar el análisis.", returnUrl });
  } catch (error) {
    console.warn("musa_discovery_authorization_failed", discoveryDiagnostic(error, stage));
    result = discoveryPage({ title: "No se pudo completar la conexión", message: "No pudimos verificar y guardar la conexión. Volvé a Musa para iniciar un nuevo intento.", returnUrl, status: 400 });
  }
  const response = new NextResponse(result.body, { status: result.status, headers: result.headers });
  response.cookies.set(DISCOVERY_COOKIE, "", { httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: DISCOVERY_CALLBACK, maxAge: 0 });
  return response;
}
