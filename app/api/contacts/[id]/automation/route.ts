import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { resumeContactFlows } from "@/lib/flows/engine";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
const fail = (error: string, status: number) => NextResponse.json({ success: false, error }, { status });
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause"), minutes: z.number().int().min(0).max(10080).optional() }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("assign"), userId: z.string().max(100).nullable() }),
  z.object({ action: z.literal("note"), text: z.string().trim().min(1).max(1000) }),
]);

export async function GET(_request: NextRequest, context: Context) {
  const user = await getCurrentWorkspaceContext();
  if (!user) return fail("Iniciá sesión.", 401);
  const { id } = await context.params;
  const contact = await prisma.contact.findFirst({ where: { id, workspaceId: user.workspaceId }, select: { id: true, automationPaused: true, automationPausedUntil: true, assignedUserId: true, notes: true, lastInboundAt: true } });
  if (!contact) return fail("Contacto no encontrado.", 404);
  const [members, runs] = await Promise.all([
    prisma.workspaceMember.findMany({ where: { workspaceId: user.workspaceId }, include: { user: { select: { id: true, name: true, email: true } } } }),
    prisma.flowRun.findMany({ where: { contactId: id, workspaceId: user.workspaceId }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, status: true, currentNodeId: true, error: true, createdAt: true, automation: { select: { id: true, name: true } } } }),
  ]);
  const isPaused = contact.automationPaused && (!contact.automationPausedUntil || contact.automationPausedUntil.getTime() > Date.now());
  return NextResponse.json({ success: true, data: { ...contact, isPaused, canEdit: canManageWorkspace(user.role), members: members.map((member) => ({ id: member.user.id, name: member.user.name ?? member.user.email ?? "Miembro" })), runs } });
}

export async function POST(request: NextRequest, context: Context) {
  const user = await getCurrentWorkspaceContext();
  if (!user) return fail("Iniciá sesión.", 401);
  if (!canManageWorkspace(user.role)) return fail("Necesitás permisos de administrador.", 403);
  const { id } = await context.params;
  const contact = await prisma.contact.findFirst({ where: { id, workspaceId: user.workspaceId }, select: { id: true, notes: true } });
  if (!contact) return fail("Contacto no encontrado.", 404);
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("La acción no es válida.", 400);
  const input = parsed.data;
  if (input.action === "pause") {
    await prisma.$transaction([
      prisma.contact.update({ where: { id }, data: { automationPaused: true, automationPausedUntil: input.minutes ? new Date(Date.now() + input.minutes * 60000) : null } }),
      prisma.flowRun.updateMany({ where: { contactId: id, workspaceId: user.workspaceId, status: "WAITING_WINDOW" }, data: { status: "PAUSED", waitType: "WINDOW" } }),
      prisma.flowRun.updateMany({ where: { contactId: id, workspaceId: user.workspaceId, status: { in: ["RUNNING", "WAITING"] } }, data: { status: "PAUSED" } }),
    ]);
  } else if (input.action === "resume") {
    await prisma.contact.update({ where: { id }, data: { automationPaused: false, automationPausedUntil: null } });
    await resumeContactFlows(id);
  } else if (input.action === "assign") {
    if (input.userId) {
      const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: user.workspaceId, userId: input.userId } }, select: { userId: true } });
      if (!member) return fail("El responsable debe pertenecer a este espacio de trabajo.", 400);
    }
    await prisma.contact.update({ where: { id }, data: { assignedUserId: input.userId } });
  } else {
    // Lock the contact row before appending so concurrent notes are not lost.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Contact" WHERE "id" = ${id} FOR UPDATE`;
      const fresh = await tx.contact.findUniqueOrThrow({ where: { id }, select: { notes: true } });
      const notes = Array.isArray(fresh.notes) ? fresh.notes : [];
      await tx.contact.update({ where: { id }, data: { notes: [...notes.slice(-99), { id: randomUUID(), text: input.text, authorId: user.userId, createdAt: new Date().toISOString() }] as Prisma.InputJsonValue } });
    });
  }
  return NextResponse.json({ success: true });
}
