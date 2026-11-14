import { z } from "zod";
import { MusaProviderError, publicationProviderRequest } from "./publications-provider";
import { publicReelAudioTrack, reelAudioType, type ReelAudioType } from "./reel-audio";

type MetaAudioAccess = { instagramId: string; accessToken: string };
const metaTrack = z.object({
  audio_id: z.string().regex(/^\d{1,32}$/),
  title: z.string().nullish(),
  display_artist: z.string().nullish(),
  ig_username: z.string().nullish(),
  audio_type: reelAudioType.nullish(),
  download_url: z.string().nullish(),
});

function readMetaTrack(track: z.infer<typeof metaTrack>, searchType?: ReelAudioType) {
  return publicReelAudioTrack({
    audioId: track.audio_id,
    title: track.title,
    displayArtist: track.display_artist,
    igUsername: track.ig_username,
    audioType: track.audio_type,
    downloadUrl: track.download_url,
  }, searchType);
}

function requestMetaAudio({ instagramId, accessToken }: MetaAudioAccess, audioId?: string, query?: string, audioType: ReelAudioType = "music") {
  const params = new URLSearchParams({ user_id: instagramId });
  if (!audioId) params.set("audio_type", audioType);
  if (query) params.set("search_query", query);
  return publicationProviderRequest({ provider: "META", graph: "facebook", accessToken },
    `/${audioId ?? "ig_audio"}?${params}`, { audioLookup: audioId ? "track" : "catalog" });
}

export async function searchMetaReelAudio(access: MetaAudioAccess, query?: string, audioType: ReelAudioType = "music") {
  const raw = await requestMetaAudio(access, undefined, query, audioType);
  const result = z.object({ audio: z.array(metaTrack).max(100) }).safeParse(raw);
  if (!result.success) throw new MusaProviderError("PROVIDER_INVALID_RESPONSE", false, true);
  return result.data.audio.map((track) => readMetaTrack(track, audioType)).filter((track) => track.audioType === audioType);
}

export async function getMetaReelAudio(access: MetaAudioAccess, audioId: string) {
  if (!/^\d{1,32}$/.test(audioId)) throw new MusaProviderError("REEL_AUDIO_UNAVAILABLE");
  const result = metaTrack.safeParse(await requestMetaAudio(access, audioId));
  if (!result.success || result.data.audio_id !== audioId)
    throw new MusaProviderError("PROVIDER_INVALID_RESPONSE", false, true);
  return readMetaTrack(result.data);
}
