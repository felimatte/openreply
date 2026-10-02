"use client";

import { useEffect, useRef, useState } from "react";

export default function AssetUpload({ type, onUploaded, demo = false }: { type: "image" | "video" | "audio" | "pdf"; onUploaded: (asset: { url: string; name: string }) => void; demo?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  async function upload(file: File) {
    if (demo) return;
    setError(""); setProgress(0);
    const abort = new AbortController(); controller.current = abort;
    let assetId: string | null = null;
    try {
      const response = await fetch("/api/flow-assets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, mimeType: file.type || (type === "pdf" ? "application/pdf" : ""), byteSize: file.size }), signal: abort.signal });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || "No se pudo preparar el archivo.");
      const id = payload.data?.id ?? payload.asset?.id;
      if (!id) throw new Error("La respuesta de carga no contiene un archivo.");
      assetId = id;
      const chunkSize = payload.chunkSize ?? 1048576;
      for (let offset = 0, index = 0; offset < file.size; offset += chunkSize, index++) {
        const chunk = await fetch(`/api/flow-assets/${encodeURIComponent(id)}/chunks/${index}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: file.slice(offset, offset + chunkSize), signal: abort.signal });
        if (!chunk.ok) { const failure = await chunk.json().catch(() => ({})); throw new Error(failure.error || "La carga se interrumpió. Volvé a intentar."); }
        setProgress(Math.round(Math.min(offset + chunkSize, file.size) / file.size * 100));
      }
      const completed = await fetch(`/api/flow-assets/${encodeURIComponent(id)}/complete`, { method: "POST", signal: abort.signal });
      const result = await completed.json();
      if (!completed.ok || !result.success || !result.data?.url) throw new Error(result.error || "No se pudo finalizar la carga.");
      onUploaded({ url: result.data.url, name: result.data.name || file.name });
    } catch (cause) { if (assetId) await fetch(`/api/flow-assets/${encodeURIComponent(assetId)}`, { method: "DELETE" }).catch(() => {}); setError(abort.signal.aborted ? "Carga cancelada." : cause instanceof Error ? cause.message : "No se pudo cargar el archivo."); }
    finally { controller.current = null; setProgress(null); if (input.current) input.current.value = ""; }
  }
  return <div className="space-y-1.5">
    <input ref={input} type="file" accept={type === "pdf" ? "application/pdf" : `${type}/*`} className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
    <button type="button" disabled={demo || progress !== null} onClick={() => input.current?.click()} className="w-full rounded-lg border border-border px-3 py-2 text-xs hover:border-accent disabled:opacity-60">{demo ? "Subir requiere una cuenta" : progress === null ? "Subir archivo" : `Subiendo ${progress}%…`}</button>
    {progress !== null && <button type="button" className="text-xs text-muted underline" onClick={() => controller.current?.abort()}>Cancelar carga</button>}
    <p className="text-[11px] text-muted">{type === "image" ? "PNG o JPEG · hasta 8 MB" : type === "audio" ? "AAC, M4A o WAV · hasta 25 MB" : "Hasta 25 MB"}</p>
    {error && <p role="alert" className="text-xs text-error">{error}</p>}
  </div>;
}
