import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { executeFlowRun, resumeContactFlows } from "@/lib/flows/engine";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentWorkspaceContext();
  if (!user) return NextResponse.json({ success: false, error: "Iniciá sesión." }, { status: 401 });
  if (!canManageWorkspace(user.role)) return NextResponse.json({ success: false, error: "Necesitás permisos de administrador." }, { status: 403 });
  const { id } = await context.params;
  let body: { runId?: string; action?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: "Solicitud no válida." }, { status: 400 }); }
  if (!body.runId || !["resume", "cancel"].includes(body.action ?? "")) return NextResponse.json({ success: false, error: "Elegí una ejecución y acción." }, { status: 400 });
  const run = await prisma.flowRun.findFirst({ where: { id: body.runId, automationId: id, workspaceId: user.workspaceId }, include: { contact: { select: { lastInboundAt: true } } } });
  if (!run) return NextResponse.json({ success: false, error: "Ejecución no encontrada." }, { status: 404 });
  if (body.action === "cancel") {
    const cancelled = await prisma.flowRun.updateMany({ where: { id: run.id, status: { in: ["RUNNING", "WAITING", "WAITING_WINDOW", "PAUSED"] } }, data: { status: "CANCELLED", resumeAt: null, waitType: null, waitExpiresAt: null } });
    if (!cancelled.count) return NextResponse.json({ success: false, error: "Esta ejecución ya terminó." }, { status: 409 });
  } else {
    if (run.status !== "PAUSED") return NextResponse.json({ success: false, error: "Sólo se pueden reanudar ejecuciones pausadas." }, { status: 400 });
    if (!run.contact.lastInboundAt || Date.now() - run.contact.lastInboundAt.getTime() >= 86400000) return NextResponse.json({ success: false, error: "Esperá una nueva respuesta del contacto para reabrir la conversación." }, { status: 409 });
    await prisma.contact.update({ where: { id: run.contactId }, data: { automationPaused: false, automationPausedUntil: null } });
    await resumeContactFlows(run.contactId);
    await executeFlowRun(run.id);
  }
  return NextResponse.json({ success: true });
}
