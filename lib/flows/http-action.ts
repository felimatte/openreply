import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request } from "node:https";

const MAX_BYTES = 64 * 1024;
const TIMEOUT_MS = 10_000;

export class FlowHttpActionError extends Error {
  constructor(public code: "INVALID_URL" | "PRIVATE_DESTINATION" | "TIMEOUT" | "NETWORK" | "REDIRECT" | "TOO_LARGE" | "INVALID_PAYLOAD") {
    super(`La acción HTTP no pudo completarse (${code}).`);
    this.name = "FlowHttpActionError";
  }
}

export function isPublicFlowIp(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "");
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (isIP(ip) !== 6) return false;
  // Allow only global unicast; reject mapped IPv4, local, multicast, documentation,
  // and transition addresses which can conceal an otherwise reserved destination.
  const words = ip.toLowerCase().split(":");
  const first = parseInt(words[0] || "0", 16);
  const second = parseInt(words[1] || "0", 16);
  return (first & 0xe000) === 0x2000 && first !== 0x2002 && first !== 0x3fff &&
    !(first === 0x2001 && (second < 0x200 || second === 0xdb8));
}

/** Structural check for saving a definition; DNS is checked again at execution. */
export function validateFlowHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
    if (url.protocol !== "https:" || url.username || url.password || url.hash ||
      (url.port && url.port !== "443") || value.length > 2048) return false;
    if (isIP(host)) return isPublicFlowIp(host);
    return host.includes(".") && !/(^|\.)(localhost|local|internal|lan|home|test|invalid|example|onion)$/.test(host);
  } catch { return false; }
}

export async function executeFlowHttpAction({ url: value, payload, idempotencyKey }: {
  url: string;
  payload: unknown;
  idempotencyKey: string;
}): Promise<{ status: number; body: string }> {
  if (!validateFlowHttpUrl(value)) throw new FlowHttpActionError("INVALID_URL");
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(idempotencyKey)) throw new FlowHttpActionError("INVALID_PAYLOAD");
  let body: string;
  try { body = JSON.stringify(payload); } catch { throw new FlowHttpActionError("INVALID_PAYLOAD"); }
  if (typeof body !== "string" || Buffer.byteLength(body) > MAX_BYTES) throw new FlowHttpActionError("INVALID_PAYLOAD");
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const deadline = Date.now() + TIMEOUT_MS;
  let dnsTimeout: ReturnType<typeof setTimeout> | undefined;
  const resolved = isIP(host) ? [{ address: host, family: isIP(host) }] : await Promise.race([
    lookup(host, { all: true, verbatim: true }).catch(() => { throw new FlowHttpActionError("NETWORK"); }),
    new Promise<never>((_, reject) => { dnsTimeout = setTimeout(() => reject(new FlowHttpActionError("TIMEOUT")), TIMEOUT_MS); }),
  ]).finally(() => clearTimeout(dnsTimeout));
  if (!resolved.length || resolved.some(({ address }) => !isPublicFlowIp(address))) throw new FlowHttpActionError("PRIVATE_DESTINATION");
  const pinned = resolved[0];
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new FlowHttpActionError("TIMEOUT");
  // Pin the validated address in the connection lookup. A second DNS lookup by
  // fetch/request would leave a DNS rebinding gap between validation and sending.
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: "POST",
      agent: false,
      family: pinned.family,
      lookup: (_hostname, options, callback) => options.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family),
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "Idempotency-Key": idempotencyKey },
    }, (res) => {
      const status = res.statusCode ?? 502;
      if (status >= 300 && status < 400) { res.destroy(); req.destroy(new FlowHttpActionError("REDIRECT")); return; }
      const declared = Number(res.headers["content-length"] ?? 0);
      if (declared > MAX_BYTES) { res.destroy(); req.destroy(new FlowHttpActionError("TOO_LARGE")); return; }
      const chunks: Buffer[] = [];
      let bytes = 0;
      res.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) { res.destroy(); req.destroy(new FlowHttpActionError("TOO_LARGE")); return; }
        chunks.push(chunk);
      });
      res.on("error", () => reject(new FlowHttpActionError("NETWORK")));
      res.on("end", () => resolve({ status, body: Buffer.concat(chunks).toString("utf8") }));
    });
    const timeout = setTimeout(() => req.destroy(new FlowHttpActionError("TIMEOUT")), remaining);
    req.on("error", (error) => { clearTimeout(timeout); reject(error instanceof FlowHttpActionError ? error : new FlowHttpActionError("NETWORK")); });
    req.on("close", () => clearTimeout(timeout));
    req.end(body);
  });
}
