import { z } from "zod";
import { analyticsWithinDeadline } from "@/lib/integrations/musa/analytics-session";
import { MusaIntegrationError, musaErrorResponse, musaJson } from "@/lib/integrations/musa/errors";

export async function GET(request: Request): Promise<Response> {
  try {
    const username = z.string().regex(/^[a-zA-Z0-9._]{1,30}$/).safeParse(new URL(request.url).searchParams.get("username"));
    if (!username.success) throw new MusaIntegrationError(400, "INVALID_PROFILE", "Enter an Instagram username.");
    return musaJson(await analyticsWithinDeadline(request, async session => ({ ...session.identity, state: "permission_required", profile: null, media: [], coverage: "unavailable" })));
  } catch (error) { return musaErrorResponse(error); }
}
