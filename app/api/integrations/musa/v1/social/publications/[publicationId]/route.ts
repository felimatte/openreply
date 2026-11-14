import { z } from "zod";
import { MusaIntegrationError, musaErrorResponse, musaJson } from "@/lib/integrations/musa/errors";
import { requireSocialConnection, socialPublicationInput } from "@/lib/integrations/musa/social-policy";
import { getSocialPublication, putSocialPublication } from "@/lib/integrations/musa/social-publications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

type Context = { params: Promise<{ publicationId: string }> };
const MAX_BODY = 16_000;

async function publicationId(context: Context) {
  const id = z.uuid().safeParse((await context.params).publicationId);
  if (!id.success) throw new MusaIntegrationError(400, "INVALID_PUBLICATION_ID", "A UUID publication ID is required.");
  return id.data;
}

async function requestPayload(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY)
    throw new MusaIntegrationError(413, "PAYLOAD_TOO_LARGE", "Publication payload is too large.");
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY)
    throw new MusaIntegrationError(413, "PAYLOAD_TOO_LARGE", "Publication payload is too large.");
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch { throw new MusaIntegrationError(400, "INVALID_PAYLOAD", "Invalid JSON."); }
  const input = socialPublicationInput.safeParse(raw);
  if (!input.success) throw new MusaIntegrationError(400, "INVALID_PAYLOAD", "Check the account, video and publication options.");
  return input.data;
}

export async function GET(request: Request, context: Context) {
  try {
    const connection = requireSocialConnection(request);
    return musaJson(await getSocialPublication(connection, await publicationId(context)));
  } catch (error) {
    return musaErrorResponse(error);
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const connection = requireSocialConnection(request);
    return musaJson(await putSocialPublication(connection, await publicationId(context), await requestPayload(request)));
  } catch (error) {
    return musaErrorResponse(error);
  }
}
