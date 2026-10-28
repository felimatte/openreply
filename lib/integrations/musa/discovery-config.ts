import { getBaseUrl, getMetaGraphApiVersion } from "@/lib/env";

/** A separate Facebook user grant; never reuse the Instagram publishing token. */
export const DISCOVERY_SCOPES = [
  "instagram_basic", "instagram_manage_insights", "pages_read_engagement", "pages_show_list",
] as const;
export const DISCOVERY_CALLBACK = "/api/integrations/musa/discovery/callback";
export const DISCOVERY_COOKIE = "openreply-discovery-state";
export const DISCOVERY_TTL_MS = 10 * 60_000;

export function discoveryConfig() {
  const appId = process.env.FACEBOOK_APP_ID ?? "";
  const appSecret = process.env.FACEBOOK_APP_SECRET ?? "";
  const version = getMetaGraphApiVersion();
  const base = new URL(getBaseUrl());
  if (!/^\d+$/.test(appId) || !appSecret || !/^v\d+\.0$/.test(version)
    || !/^[a-f0-9]{64}$/i.test(process.env.ENCRYPTION_KEY ?? "")
    || base.username || base.password || base.pathname !== "/" || base.search || base.hash
    || (base.protocol !== "https:" && !(base.protocol === "http:" && base.hostname === "localhost"))) {
    throw new Error("DISCOVERY_NOT_CONFIGURED");
  }
  return { appId, appSecret, version, baseUrl: base.origin, redirectUri: `${base.origin}${DISCOVERY_CALLBACK}` };
}

export function discoveryAuthorizationUrl(state: string): string {
  const config = discoveryConfig();
  const query = new URLSearchParams({ client_id: config.appId, redirect_uri: config.redirectUri,
    response_type: "code", state, scope: DISCOVERY_SCOPES.join(",") });
  return `https://www.facebook.com/${config.version}/dialog/oauth?${query}`;
}

export function discoveryReturnUrl(path: string): string {
  const base = new URL(process.env.MUSA_APP_ORIGIN ?? "");
  if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash
    || !/^\/b\/[a-z0-9-]{1,100}\/m\/content_studio\/competencia\?cuenta=[a-zA-Z0-9_-]{1,128}$/.test(path)) {
    throw new Error("DISCOVERY_INVALID_RETURN");
  }
  return new URL(path, base.origin).toString();
}
