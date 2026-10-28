import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { getEncryptionKeyHex } from "@/lib/env";
import type { AnalyticsIdentity } from "./analytics-contract";
import { MusaIntegrationError } from "./errors";

const cursorData = z.object({ scope: z.string(), after: z.string().min(1).max(2000), expires: z.number() });
function scope(identity: AnalyticsIdentity): string {
  return createHash("sha256").update(JSON.stringify([identity.connectionId, identity.generation, identity.accountId, identity.range])).digest("hex");
}
function key(): Buffer { return createHash("sha256").update(Buffer.from(getEncryptionKeyHex(), "hex")).update("musa-analytics-cursor-v1").digest(); }
export function encodeAnalyticsCursor(identity: AnalyticsIdentity, after: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify({ scope: scope(identity), after, expires: Date.now() + 86400000 })), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}
export function decodeAnalyticsCursor(identity: AnalyticsIdentity, cursor?: string): string | undefined {
  if (!cursor) return undefined;
  try {
    const bytes = Buffer.from(cursor, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const decoded = cursorData.parse(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")));
    if (decoded.scope !== scope(identity) || decoded.expires < Date.now()) throw new Error();
    return decoded.after;
  } catch { throw new MusaIntegrationError(400, "INVALID_CURSOR", "Restart the analytics refresh."); }
}
