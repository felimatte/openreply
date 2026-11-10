import { z } from "zod";
import { requireMusaConnection } from "@/lib/integrations/musa/auth";
import { MusaIntegrationError, musaErrorResponse, musaJson } from "@/lib/integrations/musa/errors";
import { activateScheduledReel, activationInput } from "@/lib/integrations/musa/scheduled-reel-activation";

type Context = { params: Promise<{ reservationId: string }> };

export async function PUT(request: Request, { params }: Context) {
  try {
    const connection = await requireMusaConnection(request);
    const reservationId = z.uuid().safeParse((await params).reservationId);
    const input = activationInput.safeParse(await request.json().catch(() => null));
    if (!reservationId.success || !input.success)
      throw new MusaIntegrationError(400, "INVALID_ACTIVATION", "Falta confirmar el identificador del Reel.");
    await activateScheduledReel(connection, reservationId.data, input.data);
    return musaJson({ version: 1, ok: true });
  } catch (error) { return musaErrorResponse(error); }
}
