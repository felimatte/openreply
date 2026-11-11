import { requireMusaConnection } from "@/lib/integrations/musa/auth";
import { musaErrorResponse, musaJson } from "@/lib/integrations/musa/errors";
import { registerSchedulerGrant } from "@/lib/integrations/musa/scheduler";

export async function PUT(request: Request) {
  try {
    const connection = await requireMusaConnection(request);
    await registerSchedulerGrant(connection, await request.json().catch(() => null));
    return musaJson({ version: 1, ok: true });
  } catch (error) { return musaErrorResponse(error); }
}
