import { NextResponse } from "next/server";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { getBaseUrl, getMissingInstagramOAuthEnv } from "@/lib/env";
import { createOAuthState, getAuthorizationUrl } from "@/lib/meta/oauth";
import { prisma } from "@/lib/db/client";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const purpose = params.get("purpose");
  if (purpose !== null && purpose !== "publish") {
    return NextResponse.redirect(`${getBaseUrl()}/settings?instagram=invalid`);
  }
  const context = await getCurrentWorkspaceContext(params.get("workspaceId"));
  if (!context) {
    return NextResponse.redirect(`${getBaseUrl()}/login`);
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.redirect(`${getBaseUrl()}/settings?instagram=forbidden`);
  }

  const accountId = params.get("accountId");
  const includePublishing = purpose === "publish";
  if (includePublishing) {
    // Require explicit tab/workspace context and an existing Meta account.
    // Never let a caller turn another customer's connection into a reconsent.
    if (!params.get("workspaceId") || !accountId || accountId.length > 128) {
      return NextResponse.redirect(`${getBaseUrl()}/settings?instagram=invalid`);
    }
    const account = await prisma.instagramAccount.findFirst({
      where: { id: accountId, workspaceId: context.workspaceId, provider: "META" },
      select: { id: true },
    });
    if (!account) return NextResponse.redirect(`${getBaseUrl()}/settings?instagram=forbidden`);
  }

  // getAuthorizationUrl and createOAuthState call requireEnv, which throws.
  // Without this check an incomplete .env surfaces as a 500 on a plain <a>
  // navigation, which reads to the user as the button doing nothing at all.
  const missingEnv = getMissingInstagramOAuthEnv();
  if (missingEnv.length > 0) {
    return NextResponse.redirect(
      `${getBaseUrl()}/settings?instagram=misconfigured&missing=${encodeURIComponent(
        missingEnv.join(",")
      )}`
    );
  }

  const redirectUri = `${getBaseUrl()}/api/instagram/callback`;
  const state = createOAuthState(context.workspaceId, includePublishing && accountId
    ? { purpose: "publish", accountId }
    : undefined);

  return NextResponse.redirect(getAuthorizationUrl(redirectUri, state, includePublishing));
}
