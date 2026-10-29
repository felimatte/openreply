import { z } from "zod";
import { decryptToken } from "@/lib/meta/oauth";
import { DISCOVERY_SCOPES, discoveryConfig } from "./discovery-config";
import { discoveryStage } from "./discovery-diagnostics";

const id = z.string().regex(/^\d{1,40}$/);
const tokenResult = z.object({ access_token: z.string().min(1).max(8192), expires_in: z.number().int().positive() });
// Meta documents app_id as a JSON number as well as a string. Never round an unsafe ID.
const appId = z.union([id, z.number().int().positive().max(Number.MAX_SAFE_INTEGER).transform(String)]);
const debugResult = z.object({ data: z.object({ app_id: appId, user_id: id, type: z.literal("USER"), is_valid: z.literal(true),
  expires_at: z.number().int().positive(), data_access_expires_at: z.number().int().positive(), scopes: z.array(z.string()).max(200) }) });
const permissionResult = z.object({ data: z.array(z.object({ permission: z.string(), status: z.string() })).max(200) });
const instagramIdentity = z.object({ id, user_id: id });
const facebookIdentity = z.object({ id });
const pageResult = z.object({ data: z.array(z.object({ id, instagram_business_account: z.object({ id }).optional() })).max(100),
  paging: z.object({ next: z.string().optional(), cursors: z.object({ after: z.string().max(2048).optional() }).optional() }).optional() });

/** Provider errors and URLs never leave this boundary (they may contain credentials). */
async function readJson(url: URL, credential: string | null, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, redirect: "error", cache: "no-store",
    headers: credential ? { Authorization: `Bearer ${credential}` } : {},
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error("DISCOVERY_PROVIDER_UNAVAILABLE"); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("DISCOVERY_INVALID_RESPONSE");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 128_000) { await reader.cancel(); throw new Error("DISCOVERY_INVALID_RESPONSE"); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function graphUrl(path: string, params: Record<string, string>): URL {
  const url = new URL(`https://graph.facebook.com/${discoveryConfig().version}/${path}`);
  url.search = new URLSearchParams(params).toString(); return url;
}

async function exchange(code: string, signal: AbortSignal) {
  const { appId, appSecret, redirectUri } = discoveryConfig();
  const short = await discoveryStage("exchange_code", async () => tokenResult.parse(await readJson(graphUrl("oauth/access_token", {
    client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code,
  }), null, signal)));
  return discoveryStage("exchange_long_token", async () => tokenResult.parse(await readJson(graphUrl("oauth/access_token", {
    client_id: appId, client_secret: appSecret, grant_type: "fb_exchange_token", fb_exchange_token: short.access_token,
  }), null, signal)));
}

async function validateToken(token: string, signal: AbortSignal) {
  const { appId, appSecret } = discoveryConfig();
  const { data } = await discoveryStage("token_metadata", async () => debugResult.parse(await readJson(graphUrl("debug_token", { input_token: token }), `${appId}|${appSecret}`, signal)));
  const permissions = await discoveryStage("permissions", async () => permissionResult.parse(await readJson(graphUrl("me/permissions", {}), token, signal)));
  if (data.app_id !== appId || DISCOVERY_SCOPES.some(scope => !data.scopes.includes(scope)
    || !permissions.data.some(item => item.permission === scope && item.status === "granted"))) throw new Error("DISCOVERY_PERMISSION_REQUIRED");
  if (Math.min(data.expires_at, data.data_access_expires_at) * 1000 <= Date.now() + 60_000) throw new Error("DISCOVERY_EXPIRED");
  return data;
}

async function findOwnPage(token: string, instagramId: string, signal: AbortSignal): Promise<string> {
  let after: string | undefined;
  const matches = new Set<string>();
  for (let page = 0; page < 5; page++) {
    const response = pageResult.parse(await readJson(graphUrl("me/accounts", {
      fields: "id,instagram_business_account{id}", limit: "100", ...(after ? { after } : {}),
    }), token, signal));
    for (const item of response.data) if (item.instagram_business_account?.id === instagramId) matches.add(item.id);
    if (!response.paging?.next) {
      if (matches.size !== 1) throw new Error("DISCOVERY_ACCOUNT_MISMATCH");
      const pageId = [...matches][0];
      const linked = z.object({ id, instagram_business_account: z.object({ id }) }).parse(await readJson(
        graphUrl(pageId, { fields: "id,instagram_business_account{id}" }), token, signal));
      if (linked.id !== pageId || linked.instagram_business_account.id !== instagramId) throw new Error("DISCOVERY_ACCOUNT_MISMATCH");
      return pageId;
    }
    const next = response.paging.cursors?.after;
    if (!next || next === after) throw new Error("DISCOVERY_INCOMPLETE_PAGES");
    after = next;
  }
  throw new Error("DISCOVERY_INCOMPLETE_PAGES");
}

export async function exchangeDiscoveryGrant(code: string, account: { instagramId: string; accessToken: string }, signal: AbortSignal) {
  const token = await exchange(code, signal);
  const debug = await validateToken(token.access_token, signal);
  const igUrl = new URL(`https://graph.instagram.com/${discoveryConfig().version}/me?fields=id,user_id`);
  const own = await discoveryStage("instagram_identity", async () => instagramIdentity.parse(await readJson(igUrl, decryptToken(account.accessToken), signal)));
  if (![own.id, own.user_id].includes(account.instagramId)) throw new Error("DISCOVERY_ACCOUNT_MISMATCH");
  // Prove cross-login resolution through Meta; a matching username is never evidence.
  const resolved = await discoveryStage("facebook_identity", async () => facebookIdentity.parse(await readJson(graphUrl(own.user_id, { fields: "id" }), token.access_token, signal)));
  const pageId = await discoveryStage("linked_page", () => findOwnPage(token.access_token, resolved.id, signal));
  const expiresAt = new Date(Math.min(Date.now() + token.expires_in * 1000, debug.expires_at * 1000, debug.data_access_expires_at * 1000));
  return { token: token.access_token, facebookUserId: debug.user_id, facebookInstagramId: resolved.id,
    instagramUserId: own.user_id, pageId, expiresAt, scopes: [...DISCOVERY_SCOPES] };
}
