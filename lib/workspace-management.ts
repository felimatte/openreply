import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth";
import { isEmailAllowedToSignIn } from "@/lib/env";
import { SELECTED_WORKSPACE_COOKIE } from "@/lib/workspace-selection";

export const WORKSPACE_CREATION_LIMIT = 10;
const CREATION_WINDOW_MS = 60 * 60_000;
const workspaceName = z.string().trim().min(2).max(80).refine((name) => !/[\u0000-\u001f\u007f]/u.test(name));
export const createWorkspaceInput = z.object({ name: workspaceName }).strict();
export const selectWorkspaceInput = z.object({ workspaceId: z.string().min(1).max(120) }).strict();

export class WorkspaceManagementError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

export async function requireWorkspaceUser() {
  const userId = await getCurrentUserId();
  if (!userId) throw new WorkspaceManagementError(401, "UNAUTHORIZED");
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
  if (!user) throw new WorkspaceManagementError(401, "UNAUTHORIZED");
  return user;
}

export function canCreateIndependentWorkspace(email: string | null) {
  // Login admission by invitation is intentionally not sufficient authority.
  return Boolean(email?.trim()) && isEmailAllowedToSignIn(email?.trim().toLowerCase());
}

export function requireWorkspaceOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    throw new WorkspaceManagementError(403, "INVALID_ORIGIN");
  }
}

export async function readWorkspaceInput(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new WorkspaceManagementError(400, "INVALID_REQUEST");
  }
  if (Number(request.headers.get("content-length")) > 4096) throw new WorkspaceManagementError(413, "INVALID_REQUEST");
  const text = await request.text();
  if (text.length > 4096) throw new WorkspaceManagementError(413, "INVALID_REQUEST");
  try { return JSON.parse(text) as unknown; }
  catch { throw new WorkspaceManagementError(400, "INVALID_REQUEST"); }
}

export async function createIndependentWorkspace(userId: string, input: unknown) {
  const parsed = createWorkspaceInput.safeParse(input);
  if (!parsed.success) throw new WorkspaceManagementError(400, "INVALID_NAME");
  return prisma.$transaction(async (tx) => {
    // Serialize this user's creations across processes. Counting and the nested
    // OWNER membership write share the transaction, so parallel calls cannot
    // bypass the hourly limit or leave an inaccessible workspace behind.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user || !canCreateIndependentWorkspace(user.email)) {
      throw new WorkspaceManagementError(403, "CREATION_NOT_ALLOWED");
    }
    const count = await tx.workspace.count({ where: { ownerId: userId, createdAt: { gt: new Date(Date.now() - CREATION_WINDOW_MS) } } });
    if (count >= WORKSPACE_CREATION_LIMIT) throw new WorkspaceManagementError(429, "CREATION_RATE_LIMITED");
    return tx.workspace.create({
      data: { name: parsed.data.name, ownerId: userId, members: { create: { userId, role: "OWNER" } } },
      select: { id: true, name: true },
    });
  });
}

export function workspaceJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function workspaceSelectionResponse(request: Request, workspace: { id: string; name: string }, status = 200) {
  const response = workspaceJson({ success: true, data: { workspace } }, status);
  response.cookies.set(SELECTED_WORKSPACE_COOKIE, workspace.id, {
    httpOnly: true, secure: new URL(request.url).protocol === "https:",
    sameSite: "lax", path: "/", maxAge: 30 * 86400,
  });
  return response;
}

export function workspaceManagementErrorResponse(error: unknown) {
  const known = error instanceof WorkspaceManagementError;
  const response = workspaceJson({ success: false, error: { code: known ? error.code : "INTERNAL_ERROR" } }, known ? error.status : 500);
  if (known && error.status === 429) response.headers.set("Retry-After", "3600");
  return response;
}
