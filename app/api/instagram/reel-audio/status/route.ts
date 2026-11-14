import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { metaReelAudioAccountIdPattern } from "@/lib/integrations/musa/meta-reel-audio-authorization";
import { metaReelAudioResponseHeaders } from "@/lib/integrations/musa/meta-reel-audio-config";
import { getMetaReelAudioGrant } from "@/lib/integrations/musa/meta-reel-audio-grant";

export const runtime = "nodejs";

function error(status: number, message: string) {
  return NextResponse.json({ success: false, error: message }, { status, headers: metaReelAudioResponseHeaders });
}

export async function GET(request: Request) {
  try {
    const context = await getCurrentWorkspaceContext();
    if (!context) return error(401, "Unauthorized");
    if (!canManageWorkspace(context.role)) return error(403, "Only owners and admins can manage music authorization");

    const params = new URL(request.url).searchParams;
    const accountId = params.get("accountId");
    if (!accountId || !metaReelAudioAccountIdPattern.test(accountId) || params.getAll("accountId").length !== 1) {
      return error(400, "Choose an Instagram account");
    }
    const account = await prisma.instagramAccount.findFirst({ where: { id: accountId, workspaceId: context.workspaceId, provider: "META" } });
    if (!account) return error(404, "Instagram account not found");
    const connected = Boolean(await getMetaReelAudioGrant(account));
    return NextResponse.json({ success: true, data: { connected } }, { headers: metaReelAudioResponseHeaders });
  } catch {
    return error(503, "Music authorization status unavailable");
  }
}
