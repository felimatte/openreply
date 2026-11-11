import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { MusaIntegrationError, musaJson } from "@/lib/integrations/musa/errors";
import { publishScheduledCampaign, readScheduledCampaign } from "@/lib/integrations/musa/scheduled-reels";
import { requireSchedulerWorkspace, schedulerErrorResponse } from "@/lib/integrations/musa/scheduler-dashboard";

type Context = { params: Promise<{ id: string }> };
const publish = z.object({ publicationId: z.uuid(), requestId: z.uuid().optional(), expectedRevision: z.int().nonnegative().optional() }).strict();

async function requireScheduledCampaign(request: Request, context: Context, write = false) {
  const user = await requireSchedulerWorkspace(request, write);
  const { id } = await context.params;
  const campaign = await prisma.automation.findFirst({
    where: { id, workspaceId: user.workspaceId, musaScheduledPublicationId: { not: null } },
  });
  if (!campaign) throw new MusaIntegrationError(404, "CAMPAIGN_NOT_FOUND", "No encontramos el flujo programado.");
  return campaign;
}

export async function GET(request: Request, context: Context) {
  try { return musaJson({ success: true, data: await readScheduledCampaign(await requireScheduledCampaign(request, context)) }); }
  catch (error) { return schedulerErrorResponse(error); }
}

export async function PUT(request: Request, context: Context) {
  try {
    const campaign = await requireScheduledCampaign(request, context, true);
    const input = publish.safeParse(await request.json().catch(() => null));
    if (!input.success) throw new MusaIntegrationError(400, "INVALID_PUBLICATION", "Elegí un Reel programado.");
    return musaJson({ success: true, data: await publishScheduledCampaign(campaign, input.data) });
  } catch (error) { return schedulerErrorResponse(error); }
}
