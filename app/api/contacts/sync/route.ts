import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { decryptToken, encryptToken } from "@/lib/meta/oauth";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";
import { buildAppsScript } from "@/lib/contacts/apps-script";
import {
  enqueueContactSync,
  generateSyncSecret,
  sendContactSyncTest,
  validateSyncUrl,
} from "@/lib/contacts/sync";

export const dynamic = "force-dynamic";

type SyncRow = {
  url: string | null;
  secret: string;
  enabled: boolean;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
};

/**
 * What the settings page shows. Only owners and admins get the script, since
 * it carries the secret that signs every update.
 */
function syncView(sync: SyncRow | null, canManage: boolean) {
  if (!sync) return { configured: false };
  return {
    configured: true,
    url: sync.url,
    enabled: sync.enabled,
    lastSuccessAt: sync.lastSuccessAt,
    lastErrorAt: sync.lastErrorAt,
    lastError: sync.lastError,
    ...(canManage ? { script: buildAppsScript(decryptToken(sync.secret)) } : {}),
  };
}

async function loadSync(workspaceId: string) {
  return prisma.contactSync.findUnique({ where: { workspaceId } });
}

function forbidden() {
  return NextResponse.json(
    { success: false, error: "Only owners and admins can change the sheet sync" },
    { status: 403 }
  );
}

function unauthorized() {
  return NextResponse.json(
    { success: false, error: "Unauthorized" },
    { status: 401 }
  );
}

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) return unauthorized();
  const sync = await loadSync(context.workspaceId);
  return NextResponse.json({
    success: true,
    data: syncView(sync, canManageWorkspace(context.role)),
  });
}

const actionSchema = z.object({
  action: z.enum(["setup", "test", "resend"]),
});

/**
 * `setup` creates the secret (and the script to copy); `test` sends a test
 * request; `resend` queues every contact for the sheet.
 */
export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return unauthorized();
  if (!canManageWorkspace(context.role)) return forbidden();
  const { workspaceId } = context;

  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid input" },
      { status: 400 }
    );
  }

  if (parsed.data.action === "setup") {
    const sync = await prisma.contactSync.upsert({
      where: { workspaceId },
      create: { workspaceId, secret: encryptToken(generateSyncSecret()) },
      update: {},
    });
    return NextResponse.json({ success: true, data: syncView(sync, true) });
  }

  const sync = await loadSync(workspaceId);
  if (!sync?.url) {
    return NextResponse.json(
      { success: false, error: "Paste the sheet's web app URL first." },
      { status: 400 }
    );
  }

  if (parsed.data.action === "test") {
    try {
      await sendContactSyncTest(workspaceId);
    } catch (error) {
      return NextResponse.json({
        success: false,
        error: error instanceof Error ? error.message : "The test failed",
        data: syncView(await loadSync(workspaceId), true),
      });
    }
    return NextResponse.json({
      success: true,
      data: syncView(await loadSync(workspaceId), true),
    });
  }

  if (!sync.enabled) {
    return NextResponse.json(
      { success: false, error: "Turn the sync on first." },
      { status: 400 }
    );
  }
  const contacts = await prisma.contact.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  await enqueueContactSync(
    workspaceId,
    contacts.map((contact) => contact.id)
  );
  return NextResponse.json({ success: true, data: { queued: contacts.length } });
}

const updateSchema = z.object({
  url: z.string().max(2000).optional(),
  enabled: z.boolean().optional(),
});

/**
 * Save the sheet's URL and switch the sync on or off. Saving a URL switches
 * the sync on and sends a test request, so a wrong URL shows up right away.
 */
export async function PUT(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return unauthorized();
  if (!canManageWorkspace(context.role)) return forbidden();
  const { workspaceId } = context;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid input" },
      { status: 400 }
    );
  }

  const existing = await loadSync(workspaceId);
  if (!existing) {
    return NextResponse.json(
      { success: false, error: "Set up the sync first." },
      { status: 400 }
    );
  }

  const data: { url?: string; enabled?: boolean } = {};
  if (parsed.data.url !== undefined) {
    const checked = validateSyncUrl(parsed.data.url);
    if (!checked.ok) {
      return NextResponse.json(
        { success: false, error: checked.error },
        { status: 400 }
      );
    }
    data.url = checked.url;
    data.enabled = parsed.data.enabled ?? true;
  } else if (parsed.data.enabled !== undefined) {
    if (parsed.data.enabled && !existing.url) {
      return NextResponse.json(
        { success: false, error: "Paste the sheet's web app URL first." },
        { status: 400 }
      );
    }
    data.enabled = parsed.data.enabled;
  }

  await prisma.contactSync.update({ where: { workspaceId }, data });

  if (data.url) {
    try {
      await sendContactSyncTest(workspaceId);
    } catch (error) {
      return NextResponse.json({
        success: false,
        error: error instanceof Error ? error.message : "The test failed",
        data: syncView(await loadSync(workspaceId), true),
      });
    }
  }

  return NextResponse.json({
    success: true,
    data: syncView(await loadSync(workspaceId), true),
  });
}

/** Stop syncing and forget the URL and secret. The sheet itself is untouched. */
export async function DELETE() {
  const context = await getCurrentWorkspaceContext();
  if (!context) return unauthorized();
  if (!canManageWorkspace(context.role)) return forbidden();
  await prisma.contactSync.deleteMany({ where: { workspaceId: context.workspaceId } });
  return NextResponse.json({ success: true, data: { configured: false } });
}
