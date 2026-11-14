import { z } from "zod";
import type { ZernioContext } from "@/lib/instagram/context";
import { MusaProviderError, publicationProviderRequest } from "./publications-provider";
import { reelAudioId } from "./publications-policy";

export const reelAudioType = z.enum(["music", "original_sound"]);
export type ReelAudioType = z.infer<typeof reelAudioType>;

const zernioTrack = z.object({
  audioId: reelAudioId,
  title: z.string().nullish(),
  displayArtist: z.string().nullish(),
  igUsername: z.string().nullish(),
  audioType: reelAudioType.nullish(),
  downloadUrl: z.string().nullish(),
});

function reelAudioPreviewUrl(value?: string | null) {
  if (!value || value.length > 4096) return null;
  const result = z.url({ protocol: /^https$/ }).safeParse(value);
  if (!result.success) return null;
  const url = new URL(result.data);
  if (url.username || url.password || url.port ||
    !/(^|\.)(cdninstagram\.com|fbcdn\.net)$/i.test(url.hostname)) return null;
  return result.data;
}

export function publicReelAudioTrack(track: z.infer<typeof zernioTrack>, searchType?: ReelAudioType) {
  const creator = track.igUsername?.trim();
  const artist = track.displayArtist?.trim();
  // Search responses can omit the type. Prefer the provider's category-specific attribution when present.
  const audioType = track.audioType ?? (creator ? "original_sound" : artist ? "music" : searchType);
  const attribution = audioType === "original_sound" ? creator : artist;
  return {
    id: track.audioId,
    title: track.title?.trim().slice(0, 200) || track.audioId,
    artist: attribution?.slice(0, 200) || null,
    previewUrl: reelAudioPreviewUrl(track.downloadUrl),
    ...(audioType ? { audioType } : {}),
  };
}

function audioPath(context: ZernioContext) {
  return `/accounts/${encodeURIComponent(context.accountId)}/instagram/audio`;
}

export async function searchZernioReelAudio(context: ZernioContext, query?: string, audioType: ReelAudioType = "music") {
  const params = new URLSearchParams({ audioType });
  if (query) params.set("q", query);
  const raw = await publicationProviderRequest(context, `${audioPath(context)}?${params}`, {
    audioLookup: "catalog",
  });
  const result = z.object({ audio: z.array(zernioTrack).max(100) }).safeParse(raw);
  if (!result.success) throw new MusaProviderError("PROVIDER_INVALID_RESPONSE", false, true);
  return result.data.audio.map((track) => publicReelAudioTrack(track, audioType)).filter((track) => track.audioType === audioType);
}

export async function getZernioReelAudio(context: ZernioContext, audioId: string) {
  const raw = await publicationProviderRequest(context, `${audioPath(context)}/${encodeURIComponent(audioId)}`, {
    audioLookup: "track",
  });
  const result = z.object({ audio: zernioTrack }).safeParse(raw);
  if (!result.success || result.data.audio.audioId !== audioId)
    throw new MusaProviderError("PROVIDER_INVALID_RESPONSE", false, true);
  return publicReelAudioTrack(result.data.audio);
}
