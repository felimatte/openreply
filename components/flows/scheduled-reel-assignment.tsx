import { useEffect, useState } from "react";
import ScheduledReelPicker, { scheduledReelTime, type ScheduledReel } from "./scheduled-reel-picker";

interface Assignment {
  status: "draft" | "waiting" | "active" | "cancelled" | "failed" | "unconfirmed";
  publicationId: string;
  requestId?: string;
  code?: string;
  title?: string;
  scheduledAt?: string;
  timezone?: string;
}

const LABELS: Record<Assignment["status"], string> = {
  draft: "Borrador sin vincular",
  waiting: "En espera de publicación",
  active: "Vinculado al Reel publicado",
  cancelled: "Programación cancelada",
  failed: "No se pudo vincular el Reel",
  unconfirmed: "Vínculo sin confirmar",
};

const DETAILS: Record<Assignment["status"], string> = {
  draft: "Publicá el flujo para que espere al Reel que elegiste.",
  waiting: "Esta versión del flujo se vinculará cuando Instagram confirme ese Reel.",
  active: "Los comentarios de este Reel pueden iniciar el flujo.",
  cancelled: "Podés vincular otro Reel. Tu flujo está guardado.",
  failed: "Revisá la programación en MUSA o elegí otro Reel. Tu flujo está guardado.",
  unconfirmed: "Volvé a intentar con el mismo Reel para recuperar la respuesta.",
};

const WAITING_DETAILS: Record<string, string> = {
  media_id_pending: "Instagram confirmó la publicación. El vínculo espera el identificador del Reel.",
  activation_unconfirmed: "El Reel está publicado. La activación del flujo todavía no se pudo confirmar.",
  MUSA_UNAVAILABLE: "No pudimos actualizar el estado de MUSA. Tu vínculo se conserva.",
  MUSA_NOT_CONNECTED: "No pudimos comprobar el permiso de esta cuenta. Revisalo en MUSA y actualizá el estado.",
};

export default function ScheduledReelAssignment({
  campaignId, accountId, canEdit, busy, dirty, valid, revision, onActive,
}: {
  campaignId: string;
  accountId: string;
  canEdit: boolean;
  busy: boolean;
  dirty: boolean;
  valid: boolean;
  revision: number;
  onActive: () => void;
}) {
  const api = `/api/automations/${encodeURIComponent(campaignId)}/scheduled-reel`;
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(api, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok || !body.success) throw new Error();
        setAssignment(body.data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("No pudimos consultar el vínculo con MUSA.");
      });
    return () => controller.abort();
  }, [api, attempt]);

  async function reserve(publicationId: string, requestId?: string) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(api, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicationId, requestId, expectedRevision: revision }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) {
        throw new Error(response.status === 409
          ? "Cambió el borrador o el Reel. Actualizá el estado antes de reintentar."
          : "No pudimos confirmar el vínculo. Actualizá el estado antes de reintentar.");
      }
      setAssignment(body.data);
      if (body.data.status === "active") onActive();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pudimos confirmar el vínculo.");
    } finally {
      setSaving(false);
    }
  }

  const mayReplace = assignment && ["draft", "cancelled", "failed"].includes(assignment.status);
  return <section className="flow-section space-y-3" aria-label="Reel programado en MUSA">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-semibold">Reel programado en MUSA</h2>
      <button type="button" className="flow-button" disabled={saving} onClick={() => {
        setError("");
        setAttempt(value => value + 1);
        onActive();
      }}>Actualizar estado</button>
    </div>
    {error && <p role="alert" className="text-sm text-error">{error}</p>}
    <div role="status" className="space-y-1">
      {assignment ? <>
        <p className="text-sm font-medium">{LABELS[assignment.status]}</p>
        {assignment.title && <p className="break-words text-sm">{assignment.title}</p>}
        {assignment.scheduledAt && assignment.timezone && (
          <p className="text-sm text-muted">{scheduledReelTime({ scheduledAt: assignment.scheduledAt, timezone: assignment.timezone })}</p>
        )}
        <p className="text-sm text-muted">{assignment.status === "waiting" && assignment.code
          ? WAITING_DETAILS[assignment.code] ?? DETAILS.waiting : DETAILS[assignment.status]}</p>
      </> : !error && <p className="text-sm text-muted">Consultando el vínculo…</p>}
    </div>
    {canEdit && mayReplace && (
      <AssignmentChoice
        key={`${assignment.status}:${assignment.publicationId}`}
        accountId={accountId}
        assignment={assignment}
        disabled={busy || saving}
        blocked={dirty || !valid || !!error}
        hint={dirty ? "Guardá los cambios del flujo antes de vincularlo." : !valid ? "Revisá los pasos marcados antes de publicar." : ""}
        reserve={reserve}
      />
    )}
    {canEdit && assignment?.status === "unconfirmed" && (
      <button type="button" className="flow-button" disabled={busy || saving}
        onClick={() => void reserve(assignment.publicationId, assignment.requestId)}>
        Reintentar el vínculo
      </button>
    )}
  </section>;
}

function AssignmentChoice({ accountId, assignment, disabled, blocked, hint, reserve }: {
  accountId: string;
  assignment: Assignment;
  disabled: boolean;
  blocked: boolean;
  hint: string;
  reserve: (publicationId: string, requestId: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<ScheduledReel | null>(() => assignment.status === "draft" ? {
    publicationId: assignment.publicationId,
    title: assignment.title ?? "Reel elegido",
    scheduledAt: assignment.scheduledAt ?? "",
    timezone: assignment.timezone ?? "",
  } : null);
  const [requestId, setRequestId] = useState<string>();
  return <div className="space-y-2">
    <ScheduledReelPicker accountId={accountId} selected={selected} onSelect={reel => {
      setSelected(reel);
      setRequestId(undefined);
    }} disabled={disabled} />
    {hint && <p className="text-sm text-muted">{hint}</p>}
    <button type="button" className="flow-button flow-button-primary" disabled={disabled || blocked || !selected}
      onClick={() => {
        if (!selected) return;
        const id = requestId ?? crypto.randomUUID();
        setRequestId(id);
        void reserve(selected.publicationId, id);
      }}>
      Publicar flujo
    </button>
  </div>;
}
