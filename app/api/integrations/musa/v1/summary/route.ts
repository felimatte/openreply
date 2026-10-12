import { requireMusaConnection } from "@/lib/integrations/musa/auth";
import { musaErrorResponse, musaJson } from "@/lib/integrations/musa/errors";
import { getMusaSummary } from "@/lib/integrations/musa/summary";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    return musaJson(await getMusaSummary(await requireMusaConnection(request), new URL(request.url).searchParams));
  } catch (error) { return musaErrorResponse(error); }
}
