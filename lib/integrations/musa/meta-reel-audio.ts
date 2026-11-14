import { z } from "zod";
import { MusaProviderError, publicationProviderRequest } from "./publications-provider";
import { reelAudioPreviewUrl } from "./reel-audio";

type MetaAudioAccess = { instagramId: string; accessToken: string };
const metaTrack = z.object({
  audio_id: z.string().regex(/^\d{1,32}$/),
  title: z.string().nullish(),
  display_artist: z.string().nullish(),
  audio_type: z.enum(["music", "original_sound"]).nullish(),
  download_url: z.string().nullish(),
});

function readMetaTrack(track: z.infer<typeof metaTrack>) {
  return {
    id: track.audio_id,
    title: track.title?.trim().slice(0, 200) || track.audio_id,
    artist: track.display_artist?.trim().slice(0, 200) || null,
    previewUrl: reelAudioPreviewUrl(track.download_url),
  };
}

function requestMetaAudio({ instagramId, accessToken }: MetaAudioAccess, audioId?: string, query?: string) {
  const params = new URLSearchParams({ user_id: instagramId });
  if (!audioId) params.set("audio_type", "music");
  if (query) params.set("search_query", query);
  return publicationProviderRequest({ provider: "META", graph: "facebook", accessToken },
    `/${audioId ?? "ig_audio"}?${params}`, { audioLookup: audioId ? "track" : "catalog" });
}

export async function searchMetaReelAudio(access: MetaAudioAccess, query?: string) {
  const raw = await requestMetaAudio(access, undefined, query);
  const result = z.object({ audio: z.array(metaTrack).max(100) }).safeParse(raw);
  if (!result.success) throw new MusaProviderError("PROVIDER_INVALID_RESPONSE", false, true);
  return result.data.audio.filter(track => track.audio_type !== "original_sound").map(readMetaTrack);
}

export async function getMetaReelAudio(access: MetaAudioAccess, audioId: string) {
  if (!/^\d{1,32}$/.test(audioId)) throw new MusaProviderError("REEL_AUDIO_UNAVAILABLE");
  const result = metaTrack.safeParse(await requestMetaAudio(access, audioId));
  if (!result.success || result.data.audio_id !== audioId)
    throw new MusaProviderError("PROVIDER_INVALID_RESPONSE", false, true);
  if (result.data.audio_type === "original_sound") throw new MusaProviderError("REEL_AUDIO_UNAVAILABLE");
  return readMetaTrack(result.data);
}
