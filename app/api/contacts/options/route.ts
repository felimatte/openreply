import { NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";

export const dynamic = "force-dynamic";

/** The workspace's tags and custom fields, for filters and the campaign editor. */
export async function GET() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const [tags, fields] = await Promise.all([
    prisma.tag.findMany({
      where: { workspaceId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, _count: { select: { contacts: true } } },
    }),
    prisma.contactField.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
      select: { key: true, label: true },
    }),
  ]);

  return NextResponse.json(
    {
      success: true,
      data: {
        tags: tags.map((tag) => ({
          id: tag.id,
          name: tag.name,
          count: tag._count.contacts,
        })),
        fields,
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
