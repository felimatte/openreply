import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { isAutomatedLinkVisit } from "@/lib/flows/tracking";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const link = await prisma.flowLink.findUnique({ where: { token }, include: { run: { select: { automationId: true, workspaceId: true, instagramAccountId: true } } } });
  if (!link) return new NextResponse("Enlace no disponible", { status: 404 });
  // Preview fetches must not cancel a reminder before a person opens the link.
  if (!isAutomatedLinkVisit(request.headers.get("user-agent"))) {
    await prisma.$transaction([
      prisma.flowLink.update({ where: { id: link.id }, data: { clicks: { increment: 1 }, clickedAt: link.clickedAt ?? new Date() } }),
      prisma.flowLinkClick.create({ data: { linkId: link.id, automationId: link.run.automationId, workspaceId: link.run.workspaceId, instagramAccountId: link.run.instagramAccountId } }),
    ]);
  }
  return NextResponse.redirect(link.destinationUrl, { status: 302, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

export async function HEAD(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const link = await prisma.flowLink.findUnique({ where: { token }, select: { destinationUrl: true } });
  return link ? NextResponse.redirect(link.destinationUrl, { status: 302, headers: { "Cache-Control": "no-store" } }) : new NextResponse(null, { status: 404 });
}
