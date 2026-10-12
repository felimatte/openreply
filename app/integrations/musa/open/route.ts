import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { SELECTED_WORKSPACE_COOKIE } from "@/lib/workspace-selection";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");
  const accountId = url.searchParams.get("accountId");
  if (!workspaceId || workspaceId.length > 120 || (accountId && accountId.length > 120)) {
    return NextResponse.json({ error: "Choose an OpenReply workspace and account from MUSA." }, { status: 400 });
  }
  const callback = `/integrations/musa/open?${new URLSearchParams({ workspaceId, ...(accountId ? { accountId } : {}) })}`;
  const loginUrl = new URL("/login", url);
  loginUrl.searchParams.set("callbackUrl", callback);
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.redirect(loginUrl);
  const membership = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } }, select: { id: true } });
  const account = accountId && membership
    ? await prisma.instagramAccount.findFirst({ where: { id: accountId, workspaceId }, select: { id: true } })
    : null;
  if (!membership || (accountId && !account)) {
    loginUrl.searchParams.set("musa", "access_required");
    return NextResponse.redirect(loginUrl);
  }
  const destination = new URL("/dashboard", url);
  if (accountId) destination.searchParams.set("instagramAccountId", accountId);
  const response = NextResponse.redirect(destination);
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(SELECTED_WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true, secure: url.protocol === "https:", sameSite: "lax", path: "/", maxAge: 30 * 86400,
  });
  return response;
}
