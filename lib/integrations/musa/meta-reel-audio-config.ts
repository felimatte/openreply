import { getBaseUrl } from "@/lib/env";
import { facebookOAuthConfig } from "./discovery-config";

export const META_REEL_AUDIO_CALLBACK = "/api/instagram/reel-audio/callback";
export const META_REEL_AUDIO_COOKIE = "openreply-meta-reel-audio-state";
export const META_REEL_AUDIO_TTL_MS = 10 * 60_000;
export const META_REEL_AUDIO_SCOPES = [
  "instagram_basic", "instagram_content_publish", "pages_show_list", "pages_read_engagement",
] as const;
export const metaReelAudioResponseHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export function metaReelAudioConfig() {
  return facebookOAuthConfig(META_REEL_AUDIO_CALLBACK);
}

export function metaReelAudioSettingsUrl(status: "connected" | "error", accountId?: string) {
  const url = new URL("/settings", getBaseUrl());
  url.searchParams.set("reelAudio", status);
  if (accountId) url.searchParams.set("reelAudioAccountId", accountId);
  url.hash = "reel-audio";
  return url;
}

export function metaReelAudioCookie(browser: string, maxAge: number) {
  return {
    name: META_REEL_AUDIO_COOKIE,
    value: browser,
    httpOnly: true,
    secure: new URL(getBaseUrl()).protocol === "https:",
    sameSite: "lax" as const,
    path: META_REEL_AUDIO_CALLBACK,
    maxAge,
  };
}
