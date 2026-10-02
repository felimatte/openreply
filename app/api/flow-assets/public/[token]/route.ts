import { prisma } from "@/lib/db/client";
import { FLOW_ASSET_CHUNK_BYTES } from "../../_shared";

export const runtime = "nodejs";

async function serve(request: Request, token: string, headOnly = false) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return new Response(null, { status: 404 });
  const asset = await prisma.flowAsset.findUnique({ where: { publicToken: token }, select: { id: true, status: true, name: true, mimeType: true, byteSize: true } });
  if (!asset || asset.status !== "READY") return new Response(null, { status: 404 });
  let start = 0;
  let end = asset.byteSize - 1;
  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${asset.byteSize}` } });
    if (!match[1]) { start = Math.max(0, asset.byteSize - Number(match[2])); }
    else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= asset.byteSize) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${asset.byteSize}` } });
  }
  const headers = {
    "Content-Type": asset.mimeType,
    "Content-Length": String(end - start + 1),
    "Content-Disposition": `${asset.mimeType === "application/pdf" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": "private, no-store",
    "Accept-Ranges": "bytes",
    ...(range ? { "Content-Range": `bytes ${start}-${end}/${asset.byteSize}` } : {}),
  };
  if (headOnly) return new Response(null, { status: range ? 206 : 200, headers });
  let index = Math.floor(start / FLOW_ASSET_CHUNK_BYTES);
  const lastIndex = Math.floor(end / FLOW_ASSET_CHUNK_BYTES);
  // Stream one database chunk at a time: provider downloads can exceed the
  // serverless buffered-response limit, and videos may request a byte range.
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await prisma.flowAssetChunk.findUnique({ where: { assetId_index: { assetId: asset.id, index } }, select: { data: true } });
        if (!chunk) { controller.error(new Error("Archivo incompleto.")); return; }
        const offset = index * FLOW_ASSET_CHUNK_BYTES;
        controller.enqueue(new Uint8Array(chunk.data).subarray(Math.max(0, start - offset), Math.min(chunk.data.length, end - offset + 1)));
        if (index++ >= lastIndex) controller.close();
      } catch { controller.error(new Error("No se pudo leer el archivo.")); }
    },
  });
  return new Response(stream, { status: range ? 206 : 200, headers });
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return serve(request, (await params).token);
}

export async function HEAD(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return serve(request, (await params).token, true);
}
