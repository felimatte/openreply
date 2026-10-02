import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getBaseUrl } from "@/lib/env";
import type { FlowMediaType } from "@/lib/flows/media";

export const FLOW_ASSET_CHUNK_BYTES = 1024 * 1024;
export const FLOW_ASSET_UPLOAD_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const FLOW_ASSET_WORKSPACE_MAX_BYTES = 512 * 1024 * 1024;
const MB = 1024 * 1024;
const FORMATS: Record<string, { kind: FlowMediaType; extensions: string[]; maxBytes: number }> = {
  "image/jpeg": { kind: "image", extensions: ["jpg", "jpeg"], maxBytes: 8 * MB },
  "image/png": { kind: "image", extensions: ["png"], maxBytes: 8 * MB },
  "video/mp4": { kind: "video", extensions: ["mp4"], maxBytes: 25 * MB },
  "video/ogg": { kind: "video", extensions: ["ogg", "ogv"], maxBytes: 25 * MB },
  "video/x-msvideo": { kind: "video", extensions: ["avi"], maxBytes: 25 * MB },
  "video/avi": { kind: "video", extensions: ["avi"], maxBytes: 25 * MB },
  "video/quicktime": { kind: "video", extensions: ["mov"], maxBytes: 25 * MB },
  "video/webm": { kind: "video", extensions: ["webm"], maxBytes: 25 * MB },
  "audio/aac": { kind: "audio", extensions: ["aac"], maxBytes: 25 * MB },
  "audio/x-aac": { kind: "audio", extensions: ["aac"], maxBytes: 25 * MB },
  "audio/mp4": { kind: "audio", extensions: ["mp4", "m4a"], maxBytes: 25 * MB },
  "audio/x-m4a": { kind: "audio", extensions: ["m4a"], maxBytes: 25 * MB },
  "audio/wav": { kind: "audio", extensions: ["wav"], maxBytes: 25 * MB },
  "audio/x-wav": { kind: "audio", extensions: ["wav"], maxBytes: 25 * MB },
  "application/pdf": { kind: "pdf", extensions: ["pdf"], maxBytes: 25 * MB },
};

export class FlowAssetError extends Error {
  constructor(message: string, public status = 400) { super(message); this.name = "FlowAssetError"; }
}

const metadataSchema = z.object({
  name: z.string().trim().min(1).max(180).refine((name) => !/[\\/\u0000-\u001f\u007f]/.test(name), "Nombre de archivo inválido."),
  mimeType: z.string().trim().toLowerCase().max(80),
  byteSize: z.number().int().positive().max(25 * MB),
}).strict();

export function parseFlowAssetMetadata(value: unknown) {
  const parsed = metadataSchema.safeParse(value);
  if (!parsed.success) throw new FlowAssetError("El nombre, tipo o tamaño del archivo no es válido.");
  const metadata = parsed.data;
  const format = FORMATS[metadata.mimeType];
  const extension = metadata.name.split(".").at(-1)?.toLowerCase();
  if (!format || !extension || !format.extensions.includes(extension)) throw new FlowAssetError("Elegí PNG, JPEG, video compatible, audio AAC/M4A/WAV o PDF.");
  if (metadata.byteSize > format.maxBytes) throw new FlowAssetError(format.kind === "image" ? "La imagen supera 8 MB." : "El archivo supera 25 MB.", 413);
  const mimeType = metadata.mimeType === "audio/x-wav" ? "audio/wav" : metadata.mimeType === "audio/x-m4a" ? "audio/mp4" : metadata.mimeType === "audio/x-aac" ? "audio/aac" : metadata.mimeType === "video/avi" ? "video/x-msvideo" : metadata.mimeType;
  return { ...metadata, mimeType, kind: format.kind, chunkCount: Math.ceil(metadata.byteSize / FLOW_ASSET_CHUNK_BYTES) };
}

export function createFlowAssetToken() { return randomBytes(32).toString("base64url"); }

export function getFlowAssetUrl(token: string): string {
  const base = new URL(getBaseUrl());
  if (base.protocol !== "https:" || base.username || base.password) throw new FlowAssetError("Configurá una URL pública HTTPS para alojar archivos.", 503);
  return new URL(`/api/flow-assets/public/${encodeURIComponent(token)}`, base).toString();
}

export function expectedFlowChunkBytes(byteSize: number, index: number): number {
  if (!Number.isSafeInteger(index) || index < 0 || index >= Math.ceil(byteSize / FLOW_ASSET_CHUNK_BYTES)) throw new FlowAssetError("La parte del archivo no es válida.");
  return Math.min(FLOW_ASSET_CHUNK_BYTES, byteSize - index * FLOW_ASSET_CHUNK_BYTES);
}

export async function readFlowAssetBody(request: Request, limit: number): Promise<Buffer> {
  if (Number(request.headers.get("content-length")) > limit) throw new FlowAssetError("El archivo o la parte supera el tamaño permitido.", 413);
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const parts: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new FlowAssetError("El archivo o la parte supera el tamaño permitido.", 413); }
      parts.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts, size);
}

/** Check the actual container, not the browser's declared MIME or extension. */
export function validateFlowAssetContent(data: Uint8Array, mimeType: string) {
  const bytes = Buffer.from(data);
  const ascii = (start: number, length: number) => bytes.subarray(start, start + length).toString("ascii");
  let valid = false;
  if (mimeType === "image/jpeg") valid = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  if (mimeType === "image/png") valid = bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && ascii(12, 4) === "IHDR" && ascii(bytes.length - 8, 4) === "IEND";
  if (mimeType === "application/pdf") valid = ascii(0, 5) === "%PDF-" && bytes.subarray(-1024).includes(Buffer.from("%%EOF"));
  if (["video/mp4", "audio/mp4"].includes(mimeType)) valid = bytes.length >= 16 && ascii(4, 4) === "ftyp" && bytes.readUInt32BE(0) >= 16 && bytes.readUInt32BE(0) <= bytes.length;
  if (mimeType === "video/quicktime") valid = bytes.length >= 16 && ["ftyp", "moov", "mdat", "wide"].includes(ascii(4, 4));
  if (mimeType === "video/x-msvideo") valid = bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "AVI ";
  if (mimeType === "video/ogg") valid = ascii(0, 4) === "OggS" && bytes.subarray(0, 4096).includes(Buffer.from("theora"));
  if (mimeType === "video/webm") valid = bytes.length >= 8 && bytes.subarray(0, 4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])) && bytes.subarray(0, 1024).includes(Buffer.from("webm"));
  if (mimeType === "audio/wav") valid = bytes.length >= 44 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE";
  if (mimeType === "audio/aac") valid = bytes.length >= 7 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
  if (!valid) throw new FlowAssetError("El contenido del archivo no coincide con su formato declarado.");
}

export function flowAssetResponse(asset: { id: string; name: string; kind: string; publicToken: string; status: string }) {
  return { id: asset.id, name: asset.name, type: asset.kind, url: asset.status === "READY" ? getFlowAssetUrl(asset.publicToken) : null };
}

export function flowAssetFailure(error: unknown): Response {
  if (error instanceof FlowAssetError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: "No se pudo guardar el archivo. Intentá nuevamente." }, { status: 500 });
}
