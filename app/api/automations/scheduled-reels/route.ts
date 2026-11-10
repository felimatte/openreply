import { z } from "zod";
import { MusaIntegrationError, musaJson } from "@/lib/integrations/musa/errors";
import { listScheduledReels, requireScheduler } from "@/lib/integrations/musa/scheduler";
import { requireSchedulerWorkspace, schedulerErrorResponse } from "@/lib/integrations/musa/scheduler-dashboard";

export async function GET(request: Request) {
  try {
    const user = await requireSchedulerWorkspace(request);
    const parsed = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/).safeParse(new URL(request.url).searchParams.get("accountId"));
    if (!parsed.success) throw new MusaIntegrationError(400, "INVALID_ACCOUNT", "Elegí una cuenta de Instagram.");
    const scheduler = await requireScheduler(user.workspaceId, parsed.data);
    return musaJson({ success: true, data: { reels: await listScheduledReels(scheduler) } });
  } catch (error) { return schedulerErrorResponse(error); }
}
