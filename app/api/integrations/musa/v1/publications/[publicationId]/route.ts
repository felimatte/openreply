import { z } from "zod";
import { requireMusaConnection } from "@/lib/integrations/musa/auth";
import { MusaIntegrationError, musaErrorResponse } from "@/lib/integrations/musa/errors";
import { advanceMusaPublication, getMusaPublication } from "@/lib/integrations/musa/publications";
import { musaPublicationInputSchema } from "@/lib/integrations/musa/publications-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 9;
type Context = { params: Promise<{ publicationId: string }> };
async function publicationId(context: Context) {
  const result = z.uuid().safeParse((await context.params).publicationId);
  if (!result.success) throw new MusaIntegrationError(400, "INVALID_PUBLICATION_ID", "A UUID publication ID is required");
  return result.data;
}
const response = (body: unknown) => Response.json(body, { headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request, context: Context) {
  try { return response(await getMusaPublication(await requireMusaConnection(request), await publicationId(context))); }
  catch (error) { return musaErrorResponse(error); }
}

export async function PUT(request: Request, context: Context) {
  try {
    const connection = await requireMusaConnection(request);
    const id = await publicationId(context);
    if (Number(request.headers.get("content-length") ?? 0) > 40_000)
      throw new MusaIntegrationError(413, "PAYLOAD_TOO_LARGE", "Publication payload is too large");
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > 40_000) throw new MusaIntegrationError(413, "PAYLOAD_TOO_LARGE", "Publication payload is too large");
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { throw new MusaIntegrationError(400, "INVALID_PAYLOAD", "Invalid JSON"); }
    const parsed = musaPublicationInputSchema.safeParse(raw);
    if (!parsed.success) throw new MusaIntegrationError(400, "INVALID_PAYLOAD", "Check account, caption and public HTTPS media URLs");
    return response(await advanceMusaPublication(connection, id, parsed.data));
  } catch (error) { return musaErrorResponse(error); }
}
