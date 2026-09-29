import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";
import { parseEmail, parsePhone } from "@/lib/contacts/answers";
import { asFieldValues } from "@/lib/contacts/format";
import { ensureTags } from "@/lib/contacts/store";
import { enqueueContactSync } from "@/lib/contacts/sync";

// Empty text clears a value. `tags` replaces the contact's whole tag list.
const updateContactSchema = z.object({
  email: z.string().max(254).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  fields: z.record(z.string(), z.string().max(500)).optional(),
  tags: z.array(z.string().max(50)).max(50).optional(),
});

type ManagerContext =
  | { allowed: false; response: NextResponse }
  | { allowed: true; workspaceId: string };

async function managerContext(): Promise<ManagerContext> {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return {
      allowed: false,
      response: NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      ),
    };
  }
  if (!canManageWorkspace(context.role)) {
    return {
      allowed: false,
      response: NextResponse.json(
        { success: false, error: "Only owners and admins can change contacts" },
        { status: 403 }
      ),
    };
  }
  return { allowed: true, workspaceId: context.workspaceId };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = await managerContext();
  if (!context.allowed) return context.response;
  const { workspaceId } = context;
  const { id } = await params;

  const parsed = updateContactSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const contact = await prisma.contact.findFirst({
    where: { id, workspaceId },
    select: { id: true, fields: true },
  });
  if (!contact) {
    return NextResponse.json(
      { success: false, error: "Contact not found" },
      { status: 404 }
    );
  }

  const input = parsed.data;
  const data: { email?: string | null; phone?: string | null; fields?: Record<string, string> } = {};

  if (input.email !== undefined) {
    const value = input.email?.trim() ?? "";
    if (value) {
      const email = parseEmail(value);
      if (!email.ok) {
        return NextResponse.json(
          { success: false, error: "That doesn't look like an email address." },
          { status: 400 }
        );
      }
      data.email = email.value;
    } else {
      data.email = null;
    }
  }

  if (input.phone !== undefined) {
    const value = input.phone?.trim() ?? "";
    if (value) {
      const phone = parsePhone(value);
      if (!phone.ok) {
        return NextResponse.json(
          { success: false, error: "That doesn't look like a phone number." },
          { status: 400 }
        );
      }
      data.phone = phone.value;
    } else {
      data.phone = null;
    }
  }

  if (input.fields) {
    const known = await prisma.contactField.findMany({
      where: { workspaceId, key: { in: Object.keys(input.fields) } },
      select: { key: true },
    });
    const values = asFieldValues(contact.fields);
    for (const { key } of known) {
      const value = input.fields[key].trim();
      if (value) values[key] = value;
      else delete values[key];
    }
    data.fields = { ...values };
  }

  const tags = input.tags ? await ensureTags(workspaceId, input.tags) : null;

  await prisma.$transaction(async (tx) => {
    await tx.contact.update({ where: { id }, data });
    if (tags) {
      await tx.contactTag.deleteMany({
        where: { contactId: id, tagId: { notIn: tags.map((tag) => tag.id) } },
      });
      await tx.contactTag.createMany({
        data: tags.map((tag) => ({ contactId: id, tagId: tag.id })),
        skipDuplicates: true,
      });
    }
  });

  await enqueueContactSync(workspaceId, [id]);
  return NextResponse.json({ success: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = await managerContext();
  if (!context.allowed) return context.response;
  const { workspaceId } = context;
  const { id } = await params;

  const { count } = await prisma.contact.deleteMany({ where: { id, workspaceId } });
  if (count === 0) {
    return NextResponse.json(
      { success: false, error: "Contact not found" },
      { status: 404 }
    );
  }

  // Take them out of the synced sheet too.
  await enqueueContactSync(workspaceId, [id], { deleted: true });
  return NextResponse.json({ success: true });
}
