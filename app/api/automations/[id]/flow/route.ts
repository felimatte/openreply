import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { createDefaultFlow, flowDefinitionSchema, validateFlowDefinition, type FlowDefinition } from "@/lib/flows/definition";
import { getFlowCapabilities } from "@/lib/flows/capabilities";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
const failure = (error: string, status: number) => NextResponse.json({ success: false, error }, { status });

async function resolve(context: Context, write = false) {
  const user = await getCurrentWorkspaceContext();
  if (!user) return { error: failure("Iniciá sesión para continuar.", 401) };
  if (write && !canManageWorkspace(user.role)) return { error: failure("Necesitás permisos de administrador para editar flujos.", 403) };
  const { id } = await context.params;
  const campaign = await prisma.automation.findFirst({
    where: { id, workspaceId: user.workspaceId },
    include: { instagramAccount: { select: { id: true, username: true, provider: true } }, trackedLinks: { orderBy: { position: "asc" } } },
  });
  if (!campaign) return { error: failure("Campaña no encontrada.", 404) };
  return { user, campaign };
}

export async function GET(_request: NextRequest, context: Context) {
  const resolved = await resolve(context);
  if ("error" in resolved) return resolved.error!;
  const { campaign, user } = resolved;
  const [versions, runs, summary, stepStats, linkStats] = await Promise.all([
    prisma.flowVersion.findMany({ where: { automationId: campaign.id, workspaceId: user.workspaceId }, orderBy: { version: "desc" }, take: 25 }),
    prisma.flowRun.findMany({ where: { automationId: campaign.id, workspaceId: user.workspaceId }, orderBy: { createdAt: "desc" }, take: 30, include: { contact: { select: { id: true, username: true, email: true, automationPaused: true } }, steps: { orderBy: { startedAt: "desc" }, take: 30 } } }),
    prisma.flowRun.groupBy({ by: ["status"], where: { automationId: campaign.id, workspaceId: user.workspaceId }, _count: { _all: true } }),
    prisma.flowStepRun.groupBy({ by: ["nodeId", "status"], where: { run: { automationId: campaign.id, workspaceId: user.workspaceId } }, _count: { _all: true } }),
    prisma.flowLink.groupBy({ by: ["nodeId", "buttonId"], where: { run: { automationId: campaign.id, workspaceId: user.workspaceId } }, _sum: { clicks: true }, _count: { clickedAt: true } }),
  ]);
  const publishedVersion = campaign.flowPublishedVersionId
    ? await prisma.flowVersion.findFirst({ where: { id: campaign.flowPublishedVersionId, automationId: campaign.id, workspaceId: user.workspaceId } }) : null;
  const parsedDraft = flowDefinitionSchema.safeParse(campaign.flowDraft);
  return NextResponse.json({ success: true, data: {
    campaign: { id: campaign.id, name: campaign.name, isActive: campaign.isActive, pendingNextReel: campaign.pendingNextReel, nextReelArmedAt: campaign.nextReelArmedAt, postId: campaign.postId, matchAnyPost: campaign.matchAnyPost, keywords: campaign.keywords, excludedKeywords: campaign.excludedKeywords, priority: campaign.priority, flowEnabled: campaign.flowEnabled, instagramAccount: campaign.instagramAccount },
    draft: { definition: parsedDraft.success ? parsedDraft.data : publishedVersion?.definition ?? createDefaultFlow(campaign), revision: campaign.flowDraftRevision },
    publishedVersion, versions: versions.map(({ id, version, createdAt, publishedAt }) => ({ id, version, createdAt, publishedAt })),
    runs, summary: summary.map((row) => ({ status: row.status, count: row._count._all })),
    stepStats: stepStats.map((row) => ({ nodeId: row.nodeId, status: row.status, count: row._count._all })),
    linkStats: linkStats.map((row) => ({ nodeId: row.nodeId, buttonId: row.buttonId, clicks: row._sum.clicks ?? 0, runsClicked: row._count.clickedAt })),
    capabilities: getFlowCapabilities(campaign.instagramAccount.provider), canEdit: canManageWorkspace(user.role),
  } });
}

async function readBody(request: NextRequest) {
  if (Number(request.headers.get("content-length") ?? 0) > 300_000) return null;
  const text = await request.text();
  if (text.length > 300_000) return null;
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return null; }
}

export async function PUT(request: NextRequest, context: Context) {
  const resolved = await resolve(context, true);
  if ("error" in resolved) return resolved.error!;
  const body = await readBody(request);
  if (!body || !Number.isInteger(body.expectedRevision)) return failure("Indicá la revisión del borrador.", 400);
  const parsed = flowDefinitionSchema.safeParse(body.definition);
  if (!parsed.success) return NextResponse.json({ success: false, error: "El formato del flujo no es válido.", issues: parsed.error.issues }, { status: 400 });
  const updated = await prisma.automation.updateMany({
    where: { id: resolved.campaign.id, workspaceId: resolved.user.workspaceId, flowDraftRevision: Number(body.expectedRevision) },
    data: { flowDraft: parsed.data as unknown as Prisma.InputJsonValue, flowDraftRevision: { increment: 1 } },
  });
  if (!updated.count) return failure("Otra edición cambió este borrador. Recargá antes de guardar.", 409);
  return NextResponse.json({ success: true, data: { definition: parsed.data, revision: Number(body.expectedRevision) + 1 } });
}

export async function POST(request: NextRequest, context: Context) {
  const resolved = await resolve(context, true);
  if ("error" in resolved) return resolved.error!;
  const { campaign, user } = resolved;
  const body = await readBody(request);
  if (!body) return failure("La solicitud no es válida.", 400);
  if (body.action === "disable") {
    await prisma.$transaction([
      prisma.automation.update({ where: { id: campaign.id }, data: { flowEnabled: false } }),
      prisma.flowRun.updateMany({ where: { automationId: campaign.id, workspaceId: user.workspaceId, status: { in: ["RUNNING", "WAITING", "WAITING_WINDOW", "PAUSED"] } }, data: { status: "CANCELLED", waitType: null, waitExpiresAt: null, resumeAt: null } }),
    ]);
    return NextResponse.json({ success: true });
  }
  if (!Number.isInteger(body.expectedRevision)) return failure("Indicá la revisión del borrador.", 400);
  const expectedRevision = Number(body.expectedRevision);
  if (body.action === "restore") {
    if (typeof body.versionId !== "string") return failure("Elegí una versión para restaurar.", 400);
    const version = await prisma.flowVersion.findFirst({ where: { id: body.versionId, automationId: campaign.id, workspaceId: user.workspaceId } });
    if (!version) return failure("Versión no encontrada.", 404);
    const changed = await prisma.automation.updateMany({ where: { id: campaign.id, flowDraftRevision: expectedRevision }, data: { flowDraft: version.definition as Prisma.InputJsonValue, flowDraftRevision: { increment: 1 } } });
    if (!changed.count) return failure("El borrador cambió. Recargá antes de restaurar.", 409);
    return NextResponse.json({ success: true, data: { definition: version.definition, revision: expectedRevision + 1 } });
  }
  if (body.action !== "publish") return failure("Acción no reconocida.", 400);
  const definition = body.definition ?? campaign.flowDraft;
  const validation = validateFlowDefinition(definition);
  if (!validation.valid) return NextResponse.json({ success: false, error: "Completá el flujo antes de publicar.", issues: validation.issues }, { status: 400 });
  const graph = flowDefinitionSchema.parse(definition) as FlowDefinition;
  // Subflows may only point at a published flow owned by this workspace.
  for (const node of graph.nodes) {
    if (node.type === "action" && node.data.action === "start_flow") {
      if (node.data.automationId === campaign.id) return failure("Un flujo no puede iniciarse a sí mismo.", 400);
      const target = await prisma.automation.findFirst({ where: { id: node.data.automationId, workspaceId: user.workspaceId, instagramAccountId: campaign.instagramAccountId, flowEnabled: true, flowPublishedVersionId: { not: null } }, select: { id: true } });
      if (!target) return failure("El subflujo debe estar publicado en esta cuenta y espacio de trabajo.", 400);
    }
  }
  try {
    const published = await prisma.$transaction(async (tx) => {
      const changed = await tx.automation.updateMany({ where: { id: campaign.id, workspaceId: user.workspaceId, flowDraftRevision: expectedRevision }, data: { flowDraftRevision: { increment: 1 } } });
      if (!changed.count) throw new Error("REVISION_CONFLICT");
      const latest = await tx.flowVersion.findFirst({ where: { automationId: campaign.id }, orderBy: { version: "desc" }, select: { version: true } });
      const version = await tx.flowVersion.create({ data: { workspaceId: user.workspaceId, automationId: campaign.id, version: (latest?.version ?? 0) + 1, definition: graph as unknown as Prisma.InputJsonValue } });
      await tx.automation.update({ where: { id: campaign.id }, data: { flowDraft: graph as unknown as Prisma.InputJsonValue, flowEnabled: true, flowPublishedVersionId: version.id, isActive: true, ...(campaign.pendingNextReel && (!campaign.nextReelArmedAt || !campaign.isActive) ? { nextReelArmedAt: new Date() } : {}) } });
      for (const node of graph.nodes) {
        const fieldKey = node.type === "input" ? node.data.fieldKey : node.type === "action" ? node.data.fieldKey : undefined;
        if (fieldKey && !["email", "phone"].includes(fieldKey)) {
          await tx.contactField.upsert({ where: { workspaceId_key: { workspaceId: user.workspaceId, key: fieldKey } }, create: { workspaceId: user.workspaceId, key: fieldKey, label: fieldKey }, update: {} });
        }
      }
      return version;
    });
    return NextResponse.json({ success: true, data: { publishedVersion: published, definition: graph, revision: expectedRevision + 1, flowEnabled: true } });
  } catch (error) {
    if (error instanceof Error && error.message === "REVISION_CONFLICT") return failure("El borrador cambió. Recargá antes de publicar.", 409);
    throw error;
  }
}
