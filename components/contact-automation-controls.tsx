"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const runLabels: Record<string, string> = { RUNNING: "En curso", WAITING: "Esperando", WAITING_WINDOW: "Esperando una nueva respuesta", PAUSED: "Pausado", CANCELLED: "Cancelado", COMPLETED: "Finalizado", FAILED: "Con error" };

interface ContactAutomation {
  automationPaused: boolean; automationPausedUntil: string | null; isPaused: boolean; assignedUserId: string | null; canEdit: boolean;
  notes: { id?: string; text?: string; createdAt?: string }[];
  members: { id: string; name: string }[];
  runs: { id: string; status: string; error: string | null; automation: { id: string; name: string } }[];
}

export default function ContactAutomationControls({ contactId }: { contactId: string }) {
  const [data, setData] = useState<ContactAutomation | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/contacts/${contactId}/automation`, { cache: "no-store", signal });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error ?? "No se pudo cargar la conversación.");
      setData(result.data); setError("");
    } catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "No se pudo cargar."); }
  }, [contactId]);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => load(controller.signal));
    const refresh = setInterval(() => { void load(controller.signal); }, 30000);
    return () => { controller.abort(); clearInterval(refresh); };
  }, [load]);

  async function act(body: object) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/contacts/${contactId}/automation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error ?? "No se pudo aplicar el cambio.");
      await load(); setNote("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar."); }
    finally { setBusy(false); }
  }
  const paused = data?.isPaused;
  return <section className="space-y-3 rounded-lg border border-border bg-surface/50 p-4">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Automatizaciones y atención</h3><span className="text-xs text-muted">{!data ? error ? "Sin información" : "Cargando…" : paused ? "Pausadas" : "Habilitadas"}</span></div>
    {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    {data?.canEdit && <>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void act({ action: paused ? "resume" : "pause" })} className="rounded border border-border px-3 py-2 text-xs disabled:opacity-50">{paused ? "Reanudar automatizaciones" : "Tomar conversación y pausar"}</button>
        {!paused && <button type="button" disabled={busy} onClick={() => void act({ action: "pause", minutes: 60 })} className="rounded border border-border px-3 py-2 text-xs disabled:opacity-50">Pausar 1 hora</button>}
      </div>
      <label className="block text-xs text-muted">Responsable<select aria-label="Responsable de la conversación" disabled={busy} value={data.assignedUserId ?? ""} onChange={(event) => void act({ action: "assign", userId: event.target.value || null })} className="mt-1 w-full rounded border border-border bg-surface p-2 text-sm text-foreground"><option value="">Sin asignar</option>{data.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
      <div className="space-y-2"><textarea aria-label="Nota interna" value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={2} placeholder="Agregar una nota interna…" className="w-full rounded border border-border bg-surface p-2 text-sm"/><button type="button" disabled={busy || !note.trim()} onClick={() => void act({ action: "note", text: note })} className="rounded border border-border px-3 py-2 text-xs disabled:opacity-50">Guardar nota</button></div>
    </>}
    {Array.isArray(data?.notes) && data.notes.slice(-5).reverse().map((entry, index) => <p key={entry.id ?? index} className="rounded bg-surface p-2 text-xs text-muted">{entry.text}{entry.createdAt && <span className="mt-1 block text-[10px]">{new Date(entry.createdAt).toLocaleString("es-AR")}</span>}</p>)}
    {!!data?.runs.length && <div className="space-y-1 text-xs"><p className="font-medium">Recorridos recientes</p>{data.runs.map((run) => <div key={run.id}><Link href={`/campaigns/${run.automation.id}/flow`} className="text-accent hover:underline">{run.automation.name}</Link><span className="ml-2 text-muted">{runLabels[run.status] ?? run.status}</span>{run.error && <p className="text-red-400">{run.error}</p>}</div>)}</div>}
  </section>;
}
