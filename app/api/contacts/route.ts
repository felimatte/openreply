import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { asFieldValues } from "@/lib/contacts/format";
import { contactWhere } from "@/lib/contacts/query";

// New contacts arrive from the worker at any moment; never serve a cached list.
export const dynamic = "force-dynamic";

function positiveInt(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const params = request.nextUrl.searchParams;
  const page = positiveInt(params.get("page"), 1);
  const limit = Math.min(100, positiveInt(params.get("limit"), 25));
  const where = contactWhere(workspaceId, params);

  const [contacts, total, accounts] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: [{ lastInteractionAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        igAccountId: true,
        igsid: true,
        username: true,
        email: true,
        phone: true,
        fields: true,
        createdAt: true,
        lastInteractionAt: true,
        lastInboundAt: true,
        tags: {
          select: { tag: { select: { id: true, name: true } } },
          orderBy: { createdAt: "asc" },
        },
        sourceAutomation: { select: { id: true, name: true } },
      },
    }),
    prisma.contact.count({ where }),
    prisma.instagramAccount.findMany({
      where: { workspaceId },
      select: { instagramId: true, username: true },
    }),
  ]);

  const usernames = new Map(accounts.map((a) => [a.instagramId, a.username]));

  return NextResponse.json(
    {
      success: true,
      data: {
        contacts: contacts.map((contact) => ({
          ...contact,
          fields: asFieldValues(contact.fields),
          tags: contact.tags.map(({ tag }) => tag),
          instagramAccount: usernames.get(contact.igAccountId) ?? null,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
