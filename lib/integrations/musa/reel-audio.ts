import { z } from "zod";
import type { ZernioContext } from "@/lib/instagram/context";
import { MusaProviderError, publicationProviderRequest } from "./publications-provider";
import { reelAudioId } from "./publications-policy";

const zernioTrack = z.object({
  audioId: reelAudioId,
  title: z.string().nullish(),
  displayArtist: z.string().nullish(),
  audioType: z.enum(["music", "original_sound"]).nullish(),
  downloadUrl: z.string().nullish(),
});

function previewUrl(value?: string | null) {
  if (!value || value.length > 4096) return null;
  const result = z.url({ protocol: /^https$/ }).safeParse(value);
  if (!result.success) return null;
  const url = new URL(result.data);
  if (url.username || url.password || url.port ||
    !/(^|\.)(cdninstagram\.com|fbcdn\.net)$/i.test(url.hostname)) return null;
  return result.data;
}

function publicTrack(track: z.infer<typeof zernioTrack>) {
  return {
    id: track.audioId,
    title: track.title?.trim().slice(0, 200) || track.audioId,
    artist: track.displayArtist?.trim().slice(0, 200) || null,
    previewUrl: previewUrl(track.downloadUrl),
  };
}

function audioPath(context: ZernioContext) {
  return `/accounts/${encodeURIComponent(context.accountId)}/instagram/audio`;
}

export async function searchZernioReelAudio(context: ZernioContext, query?: string) {
  const params = new URLSearchParams({ audioType: "music" });
  if (query) params.set("q", query);
  const raw = await publicationProviderRequest(context, `${audioPath(context)}?${params}`, {
    audioLookup: "catalog",
  });
  const result = z.object({ audio: z.array(zernioTrack).max(100) }).safeParse(raw);
  if (!result.success) throw new MusaProviderError("PROVIDER_INVALID_RESPONSE", false, true);
  return result.data.audio.filter((track) => track.audioType !== "original_sound").map(publicTrack);
}

export async function getZernioReelAudio(context: ZernioContext, audioId: string) {
  const raw = await publicationProviderRequest(context, `${audioPath(context)}/${encodeURIComponent(audioId)}`, {
    audioLookup: "track",
  });
  const result = z.object({ audio: zernioTrack }).safeParse(raw);
  if (!result.success || result.data.audio.audioId !== audioId)
    throw new MusaProviderError("PROVIDER_INVALID_RESPONSE", false, true);
  if (result.data.audio.audioType === "original_sound") throw new MusaProviderError("REEL_AUDIO_UNAVAILABLE");
  return publicTrack(result.data.audio);
}
