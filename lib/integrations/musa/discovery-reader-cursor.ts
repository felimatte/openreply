import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { getEncryptionKeyHex } from "@/lib/env";
import { MusaIntegrationError } from "./errors";
import type { AnalyticsIdentity } from "./analytics-contract";

export const discoveryUsername = z.string().regex(/^[a-zA-Z0-9._]{1,30}$/).transform(value => value.toLowerCase());
export const discoveryTargetId = z.string().regex(/^\d{1,40}$/);
export const discoveryAfter = z.string().regex(/^[A-Za-z0-9_+/=-]{1,2000}$/);
const data = z.object({ scope: z.string(), after: discoveryAfter, targetId: discoveryTargetId, expires: z.number() }).strict();
export interface DiscoveryCursorScope { identity: AnalyticsIdentity; username: string; generation: string }
function scope(value: DiscoveryCursorScope): string {
  const { identity: i, username, generation } = value;
  return createHash("sha256").update(JSON.stringify([i.connectionId, i.generation, i.accountId, i.instagramId, i.provider,
    i.apiVersion, i.range, username.toLowerCase(), generation])).digest("hex");
}
function key(): Buffer { return createHash("sha256").update(Buffer.from(getEncryptionKeyHex(), "hex")).update("musa-discovery-cursor-v1").digest(); }
export function encodeDiscoveryCursor(value: DiscoveryCursorScope, after: string, targetId: string): string {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  const payload = data.parse({ scope: scope(value), after, targetId, expires: Date.now() + 86400000 });
  const bytes = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString("base64url");
}
export function decodeDiscoveryCursor(value: DiscoveryCursorScope, cursor?: string, targetId?: string): { after: string; targetId: string } | null {
  if (!cursor) return null;
  try {
    if (!/^[A-Za-z0-9_-]{40,4096}$/.test(cursor)) throw new Error();
    const bytes = Buffer.from(cursor, "base64url"), decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const result = data.parse(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")));
    if (result.scope !== scope(value) || result.expires <= Date.now() || targetId && result.targetId !== targetId) throw new Error();
    return { after: result.after, targetId: result.targetId };
  } catch { throw new MusaIntegrationError(400, "INVALID_CURSOR", "Restart the competitor refresh."); }
}
