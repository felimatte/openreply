import { z } from "zod";
import { createInstagramContext } from "@/lib/instagram/context";
import { requireMusaAccount, requireMusaConnection } from "@/lib/integrations/musa/auth";
import { MusaIntegrationError, musaErrorResponse, musaJson } from "@/lib/integrations/musa/errors";
import { getMetaReelAudioGrant } from "@/lib/integrations/musa/meta-reel-audio-grant";
import { getMetaReelAudio, searchMetaReelAudio } from "@/lib/integrations/musa/meta-reel-audio";
import { reelAudioId } from "@/lib/integrations/musa/publications-policy";
import { MusaProviderError } from "@/lib/integrations/musa/publications-provider";
import { getZernioReelAudio, reelAudioType, searchZernioReelAudio } from "@/lib/integrations/musa/reel-audio";

export const runtime = "nodejs";

const audioQuery = z.object({
  q: z.string().trim().max(120).optional(),
  audioId: reelAudioId.optional(),
  audioType: reelAudioType.optional(),
}).refine(({ q, audioId, audioType }) => audioId === undefined || (q === undefined && audioType === undefined));

export async function GET(request: Request) {
  try {
    const grant = await requireMusaConnection(request);
    const params = new URL(request.url).searchParams;
    const account = requireMusaAccount(grant, params.get("accountId"));
    const query = audioQuery.safeParse({
      q: params.get("q") ?? undefined,
      audioId: params.get("audioId") ?? undefined,
      audioType: params.get("audioType") ?? undefined,
    });
    if (!query.success || ["accountId", "q", "audioId", "audioType"].some((name) => params.getAll(name).length > 1)) {
      throw new MusaIntegrationError(400, "INVALID_AUDIO_QUERY", "Choose a search or a single Instagram track.");
    }

    const base = { version: 1, accountId: account.id };
    try {
      const { audioId, q, audioType } = query.data;
      if (account.provider === "META") {
        const access = await getMetaReelAudioGrant(account);
        if (!access) return musaJson({ ...base, available: false, tracks: [] });
        const tracks = audioId ? [await getMetaReelAudio(access, audioId)] : await searchMetaReelAudio(access, q, audioType);
        return musaJson({ ...base, available: true, tracks });
      }
      if (!account.zernioAccountId)
        throw new MusaIntegrationError(403, "RECONNECT_REQUIRED", "Reconnect this Instagram account to access music.");
      const provider = await createInstagramContext(account);
      if (provider.provider !== "ZERNIO") return musaJson({ ...base, available: false, tracks: [] });
      const tracks = audioId ? [await getZernioReelAudio(provider, audioId)] : await searchZernioReelAudio(provider, q, audioType);
      return musaJson({ ...base, available: true, tracks });
    } catch (error) {
      if (error instanceof MusaProviderError && error.code === "REEL_AUDIO_REQUIRES_FACEBOOK_LOGIN")
        return musaJson({ ...base, available: false, tracks: [] });
      throw audioError(error);
    }
  } catch (error) { return musaErrorResponse(error); }
}

function audioError(error: unknown) {
  if (!(error instanceof MusaProviderError)) return error;
  switch (error.code) {
    case "REEL_AUDIO_UNAVAILABLE":
      return new MusaIntegrationError(404, error.code, "This track is unavailable for this Instagram account.");
    case "RECONNECT_REQUIRED":
      return new MusaIntegrationError(403, error.code, "Reconnect this Instagram account to access music.");
    case "PROVIDER_RATE_LIMIT": {
      const limited = new MusaIntegrationError(429, error.code, "Instagram music is temporarily rate limited.");
      limited.retryAfterSeconds = 60;
      return limited;
    }
    default:
      return new MusaIntegrationError(503, "REEL_AUDIO_TEMPORARILY_UNAVAILABLE", "Could not check Instagram music.");
  }
}
