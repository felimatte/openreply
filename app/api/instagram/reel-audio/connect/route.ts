import { NextResponse } from "next/server";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { beginMetaReelAudio, metaReelAudioAccountIdPattern } from "@/lib/integrations/musa/meta-reel-audio-authorization";
import { META_REEL_AUDIO_TTL_MS, metaReelAudioConfig, metaReelAudioCookie, metaReelAudioResponseHeaders, metaReelAudioSettingsUrl } from "@/lib/integrations/musa/meta-reel-audio-config";

export const runtime = "nodejs";

function failed() {
  return NextResponse.redirect(metaReelAudioSettingsUrl("error"), { status: 303, headers: metaReelAudioResponseHeaders });
}

export async function POST(request: Request) {
  try {
    const config = metaReelAudioConfig();
    if (request.headers.get("origin") !== config.baseUrl
      || request.headers.get("content-type")?.split(";", 1)[0].toLowerCase() !== "application/x-www-form-urlencoded") return failed();

    const form = new URLSearchParams(await request.text());
    const accountId = form.get("accountId");
    const workspaceId = form.get("workspaceId");
    if (!accountId || !metaReelAudioAccountIdPattern.test(accountId) || form.getAll("accountId").length !== 1
      || form.getAll("workspaceId").length > 1 || (workspaceId !== null && !metaReelAudioAccountIdPattern.test(workspaceId))) return failed();

    const context = await getCurrentWorkspaceContext(workspaceId);
    if (!context || !canManageWorkspace(context.role)) return failed();
    const { url, browser } = await beginMetaReelAudio(context, accountId);
    const response = NextResponse.redirect(url, { status: 303, headers: metaReelAudioResponseHeaders });
    response.cookies.set(metaReelAudioCookie(browser, META_REEL_AUDIO_TTL_MS / 1000));
    return response;
  } catch {
    return failed();
  }
}
