import { useEffect, useId, useState } from "react";

export interface ScheduledReel {
  publicationId: string;
  title: string;
  scheduledAt: string;
  timezone: string;
}

type ReelList = { reels: ScheduledReel[] } | { error: string };

export function scheduledReelTime(reel: Pick<ScheduledReel, "scheduledAt" | "timezone">) {
  const date = new Date(reel.scheduledAt);
  try {
    return new Intl.DateTimeFormat("es-AR", {
      dateStyle: "medium",
      timeStyle: "short",
      hourCycle: "h23",
      timeZone: reel.timezone,
    }).format(date) + " · " + reel.timezone;
  } catch {
    return "Horario sin confirmar";
  }
}

export default function ScheduledReelPicker({
  accountId, selected, onSelect, disabled = false,
}: {
  accountId: string;
  selected: ScheduledReel | null;
  onSelect: (reel: ScheduledReel | null) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<ReelList | null>(null);

  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ accountId });
    fetch(`/api/automations/scheduled-reels?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (controller.signal.aborted) return;
        if (response.ok && body.success && Array.isArray(body.data?.reels)) {
          setResult({ reels: body.data.reels });
        } else {
          setResult({ error: body.code === "MUSA_NOT_CONNECTED"
            ? "Habilitá la selección desde la conexión de OpenReply en MUSA para esta cuenta."
            : "No pudimos consultar los Reels programados en MUSA." });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ error: "No pudimos consultar los Reels programados en MUSA." });
      });
    return () => controller.abort();
  }, [accountId, attempt]);

  if (!accountId) return <p className="campaign-entry-hint">Elegí primero la cuenta de Instagram.</p>;
  if (!result) return <p role="status" className="campaign-entry-hint">Cargando Reels programados…</p>;
  if ("error" in result) return <div className="space-y-2">
    <p role="alert" className="campaign-entry-hint">{result.error}</p>
    <button type="button" className="flow-button" onClick={reload} disabled={disabled}>Volver a intentar</button>
  </div>;

  const selectedId = selected?.publicationId ?? "";
  const unavailable = !!selected && !result.reels.some(reel => reel.publicationId === selectedId);
  return <div className="space-y-2">
    <label htmlFor={id} className="text-sm text-foreground">Reel programado</label>
    <select
      id={id}
      className="block w-full min-h-11 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
      value={selectedId}
      aria-describedby={`${id}-help`}
      onChange={event => onSelect(result.reels.find(reel => reel.publicationId === event.target.value) ?? null)}
      disabled={disabled || !result.reels.length}
    >
      <option value="">Elegí un Reel programado</option>
      {unavailable && <option value={selectedId} disabled>{selected.title} · Ya no disponible</option>}
      {result.reels.map(reel => (
        <option key={reel.publicationId} value={reel.publicationId}>{reel.title} · {scheduledReelTime(reel)}</option>
      ))}
    </select>
    <p id={`${id}-help`} className="campaign-entry-hint">
      {unavailable
        ? "Ese Reel ya no está disponible. Elegí otro para publicar el flujo."
        : result.reels.length
          ? "El flujo se activa cuando Instagram confirma el Reel que elegiste."
          : "Esta cuenta no tiene Reels con programación confirmada disponibles."}
    </p>
    {(!result.reels.length || unavailable) && (
      <button type="button" className="flow-button" onClick={reload} disabled={disabled}>Actualizar Reels</button>
    )}
  </div>;

  function reload() {
    setResult(null);
    setAttempt(value => value + 1);
  }
}
