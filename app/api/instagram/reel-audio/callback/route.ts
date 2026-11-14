import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { discoveryDiagnostic, type DiscoveryStage } from "@/lib/integrations/musa/discovery-diagnostics";
import { claimMetaReelAudio, finishMetaReelAudio } from "@/lib/integrations/musa/meta-reel-audio-authorization";
import { META_REEL_AUDIO_COOKIE, metaReelAudioCookie, metaReelAudioResponseHeaders, metaReelAudioSettingsUrl } from "@/lib/integrations/musa/meta-reel-audio-config";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  let accountId: string | undefined;
  let result: "connected" | "error" = "error";
  let clearCookie = false;
  let stage: DiscoveryStage = "session";
  try {
    const userId = await getCurrentUserId();
    if (!userId) throw new Error("NO_SESSION");
    stage = "query";
    const params = request.nextUrl.searchParams;
    if (["state", "code", "error"].some((key) => params.getAll(key).length > 1)) throw new Error("INVALID_QUERY");

    stage = "claim";
    const browser = request.cookies.get(META_REEL_AUDIO_COOKIE)?.value ?? null;
    const claim = await claimMetaReelAudio(params.get("state"), browser, userId);
    clearCookie = true;
    accountId = claim.account.id;
    stage = "consent";
    const code = params.get("code");
    if (params.has("error") || !code || code.length > 8192) throw new Error("DENIED");

    stage = "complete_grant";
    await finishMetaReelAudio(claim, code, AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]));
    result = "connected";
  } catch (error) {
    console.warn("meta_reel_audio_authorization_failed", discoveryDiagnostic(error, stage));
  }
  const response = NextResponse.redirect(metaReelAudioSettingsUrl(result, accountId), {
    status: 303,
    headers: metaReelAudioResponseHeaders,
  });
  if (clearCookie) response.cookies.set(metaReelAudioCookie("", 0));
  return response;
}
