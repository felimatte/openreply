"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { createDefaultFlow, parseFlowDefinition, validateFlowDefinition, type FlowDefinition } from "@/lib/flows/definition";
import FlowCanvas from "./flows/flow-canvas";
import NodeEditor from "./flows/node-editor";
import FlowPreview from "./flows/flow-preview";
import { cloneFlow, createTemplate, ports, uid, type BuilderNode } from "./flows/model";
import FlowIcon from "./flows/flow-icon";
import FlowDialog from "./flows/flow-dialog";
import FlowJourney from "./flows/flow-journey";
import StepPicker from "./flows/step-picker";
import { findOpeningNodes, flowContent, insertNode, primaryPort, type InsertionPoint } from "./flows/editor-model";
import type { MessageField } from "@/lib/flows/message-variables";
import "./flows/flow-editor.css";

interface Version { id: string; version: number; createdAt: string; publishedAt?: string | null; definition?: FlowDefinition }
interface Run { id: string; status: string; currentNodeId?: string | null; createdAt: string; updatedAt?: string; error?: string | null; contact?: { id: string; username?: string | null; email?: string | null }; steps?: { id: string; nodeId: string; status: string; error?: string | null; createdAt: string }[] }
interface FlowPayload {
  campaign: { id: string; name: string; isActive: boolean; flowEnabled?: boolean; postId?: string | null; matchAnyPost?: boolean; pendingNextReel?: boolean; keywords?: string[]; matchAnyWord?: boolean; instagramAccount?: { username?: string } };
  draft: { definition: FlowDefinition; revision: number } | null;
  publishedVersion: Version | null; versions: Version[]; runs: Run[];
  capabilities?: { provider?: string; initialButtons?: boolean; media?: Record<string, boolean>; pdfMode?: string; limits?: Record<string, number> };
  summary?: { status: string; count: number }[];
  stepStats?: { nodeId: string; status: string; count: number }[];
  linkStats?: { nodeId: string; buttonId: string; clicks: number; runsClicked: number }[];
  canEdit?: boolean;
}
export interface NewCampaignFlow {
  definition: FlowDefinition;
  onChange: (definition: FlowDefinition) => void;
  campaign: FlowPayload["campaign"];
  onConfigure: () => void;
  onSave: () => void;
  saving: boolean;
}
export interface FlowBuilderHandle { reviewIssues: () => void }
const secondary = "flow-button";
const STATUS_LABELS: Record<string, string> = { RUNNING: "En curso", WAITING: "Esperando respuesta", WAITING_WINDOW: "Esperando nueva interacción", DELAYED: "En espera", PAUSED: "Pausado", COMPLETED: "Finalizado", FAILED: "Error", CANCELLED: "Cancelado", EXPIRED: "Vencido", UNCERTAIN: "Envío sin confirmar", PENDING: "Pendiente", SENT: "Enviado", CLAIMED: "En proceso" };
const statusLabel = (value: string) => STATUS_LABELS[value.toUpperCase()] || value;

export default function FlowBuilder({ campaignId, demo = false, creation, ref }: { campaignId: string; demo?: boolean; creation?: NewCampaignFlow; ref?: Ref<FlowBuilderHandle> }) {
  const isCreating = !!creation;
  const [storedPayload, setPayload] = useState<FlowPayload | null>(null);
  const payload: FlowPayload | null = creation ? { campaign: creation.campaign, draft: null, publishedVersion: null, versions: [], runs: [], capabilities: { initialButtons: false, media: { image: true, video: true, audio: true, pdf: false } }, canEdit: true } : storedPayload;
  const [storedDefinition, setStoredDefinition] = useState<FlowDefinition>(() => creation?.definition ?? createDefaultFlow());
  const definition = creation?.definition ?? storedDefinition;
  function setDefinition(next: FlowDefinition) { if (creation) creation.onChange(next); else setStoredDefinition(next); }
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customFields, setCustomFields] = useState<MessageField[]>([]);
  const [loading, setLoading] = useState(!creation), [working, setBusy] = useState(false), [error, setError] = useState("");
  const busy = working || !!creation?.saving;
  const [notice, setNotice] = useState(""); const [saved, setSaved] = useState(() => creation ? flowContent(creation.definition) : "");
  const [revision, setRevision] = useState(0); const [history, setHistory] = useState<FlowDefinition[]>([]), [future, setFuture] = useState<FlowDefinition[]>([]);
  const [preview, setPreview] = useState(false), [showIssues, setShowIssues] = useState(false), [panel, setPanel] = useState<"edit" | "runs" | "versions">("edit");
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  const [viewMode, setViewMode] = useState<"steps" | "map">("map");
  const [picker, setPicker] = useState<{ at?: InsertionPoint; position?: { x: number; y: number } } | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const inspector = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [confirm, setConfirm] = useState<{ title: string; description: string; action: () => void } | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const api = `/api/automations/${encodeURIComponent(campaignId)}/flow`;
  const dirty = flowContent(definition) !== saved;
  const selected = definition.nodes.find((node) => node.id === selectedId);
  const selectedLinkStats = payload?.linkStats?.filter((stat) => stat.nodeId === selectedId) ?? [];
  const openingNodes = useMemo(() => findOpeningNodes(definition), [definition]);
  const validation = useMemo(() => validateFlowDefinition(definition), [definition]);
  const issueNodes = useMemo(() => new Set(validation.issues.flatMap((issue) => issue.nodeId ? [issue.nodeId] : [])), [validation]);
  const canEdit = demo || payload?.canEdit !== false;

  function applyPayload(data: FlowPayload) {
    setPayload(data); const next = data.draft?.definition || data.publishedVersion?.definition || createDefaultFlow();
    setDefinition(next); setSaved(flowContent(next)); setRevision(data.draft?.revision || 0); setHistory([]); setFuture([]); setSelectedId(null);
  }
  const loadPayload = useEffectEvent((data: FlowPayload) => applyPayload(data));
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    fetch("/api/contacts/options", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const body = await response.json();
        if (!controller.signal.aborted && body.success && Array.isArray(body.data?.fields)) {
          setCustomFields(body.data.fields.filter((field: MessageField) => typeof field?.key === "string" && typeof field?.label === "string"));
        }
      }).catch(() => { /* The built-in variables and fields in this flow remain available. */ });
    return () => controller.abort();
  }, [demo, campaignId]);
  useEffect(() => {
    if (isCreating) return;
    let active = true;
    if (demo) {
      Promise.resolve().then(() => {
        let sample = createTemplate("lead");
        try { const previous = localStorage.getItem("openreply-demo-flow"); if (previous) sample = parseFlowDefinition(JSON.parse(previous)); } catch { /* Use the sample when a saved demo is incompatible. */ }
        if (active) { loadPayload({ campaign: { id: campaignId, name: "Del comentario al recurso", isActive: false, flowEnabled: false, keywords: ["GUIA"], instagramAccount: { username: "tu_cuenta" } }, draft: { definition: sample, revision: 0 }, publishedVersion: null, versions: [], runs: [], capabilities: { initialButtons: false, media: { image: true, video: true, audio: true, pdf: false } }, canEdit: true }); setLoading(false); }
      });
      return () => { active = false; };
    }
    fetch(api, { cache: "no-store" }).then(async (response) => { const body = await response.json(); if (!response.ok || !body.success) throw new Error(body.error || "No se pudo cargar el flujo."); if (active) loadPayload(body.data); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "No se pudo cargar el flujo."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, campaignId, demo, isCreating]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (dirty && !loading) event.preventDefault(); };
    window.addEventListener("beforeunload", handler); return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, loading]);
  const onShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (preview || confirm || picker || templatesOpen || loading || busy) return;
    if (event.key === "Escape") { setExpanded(false); return; }
    if (!(event.ctrlKey || event.metaKey) || !canEdit) return;
    if (event.key.toLowerCase() === "s") { event.preventDefault(); if (creation) creation.onSave(); else if (dirty) void persist("save"); return; }
    if ((event.target as HTMLElement).closest("input,textarea,select,[contenteditable=true]")) return;
    if (event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
  });
  useEffect(() => {
    const handler = (event: KeyboardEvent) => onShortcut(event);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  function checkpoint() { if (!canEdit) return; setHistory((past) => [...past.slice(-79), cloneFlow(definition)]); setFuture([]); }
  function change(next: FlowDefinition, transient = false) { if (!canEdit) return; if (!transient) checkpoint(); setDefinition(next); setNotice(""); }
  function undo() { const previous = history.at(-1); if (!previous || !canEdit) return; setFuture((next) => [...next, cloneFlow(definition)]); setHistory(history.slice(0, -1)); setDefinition(previous); setCanvasEpoch((value) => value + 1); setNotice("Cambio deshecho."); setError(""); }
  function redo() { const next = future.at(-1); if (!next || !canEdit) return; setHistory((previous) => [...previous, cloneFlow(definition)]); setFuture(future.slice(0, -1)); setDefinition(next); setCanvasEpoch((value) => value + 1); setNotice("Cambio recuperado."); setError(""); }
  function selectNode(id: string | null) {
    setSelectedId(id); setPanel("edit");
    if (id && viewMode === "steps" && window.innerWidth < 900) requestAnimationFrame(() => inspector.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  function closeStep() {
    setSelectedId(null);
    if (viewMode === "steps" && window.innerWidth < 900) requestAnimationFrame(() => stage.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" }));
  }
  useImperativeHandle(ref, () => ({ reviewIssues() {
    setShowIssues(true);
    selectNode(validation.issues.find((issue) => issue.nodeId)?.nodeId || null);
    requestAnimationFrame(() => document.querySelector(".flow-issues")?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  } }));
  function addNode(type: BuilderNode["type"], position?: { x: number; y: number }) {
    if (!canEdit || busy) return;
    const result = insertNode(definition, type, picker?.at, position || picker?.position);
    change(result.definition); setPicker(null); selectNode(result.node.id);
    setNotice(picker?.at ? "Paso agregado y conectado. Personalizalo en el panel de edición." : "Paso agregado. Elegí cómo conectarlo al recorrido.");
  }
  function openPicker() {
    if (viewMode === "map") {
      const viewport = definition.viewport || { x: 40, y: 50, zoom: .8 };
      setPicker({ position: { x: ((stage.current?.clientWidth || 900) / 2 - viewport.x) / viewport.zoom - 130, y: ((stage.current?.clientHeight || 600) / 2 - viewport.y) / viewport.zoom - 70 } });
      return;
    }
    const source = selected || definition.nodes.find((node) => node.id === definition.entryNodeId);
    const port = source && primaryPort(source);
    setPicker({ at: source && port ? { source: source.id, handle: port.id } : undefined });
  }
  function updateNode(node: BuilderNode) {
    const allowed = new Set(ports(node).map((port) => port.id));
    change({ ...definition, nodes: definition.nodes.map((current) => current.id === node.id ? node : current), edges: definition.edges.filter((edge) => edge.source !== node.id || allowed.has(edge.sourceHandle)) });
  }
  function connect(handle: string, target: string) { if (!selected) return; change({ ...definition, edges: [...definition.edges.filter((edge) => edge.source !== selected.id || edge.sourceHandle !== handle), ...(target ? [{ id: uid("edge"), source: selected.id, target, sourceHandle: handle }] : [])] }); }
  function duplicate() { if (!selected || selected.type === "start") return; const node = { ...structuredClone(selected), id: uid(), label: `${selected.label} (copia)`.slice(0, 100), position: { x: selected.position.x + 35, y: selected.position.y + 220 } } as BuilderNode; change({ ...definition, nodes: [...definition.nodes, node] }); setSelectedId(node.id); }
  function remove() { if (!selected || selected.type === "start") return; change({ ...definition, nodes: definition.nodes.filter((node) => node.id !== selected.id), edges: definition.edges.filter((edge) => edge.source !== selected.id && edge.target !== selected.id) }); setSelectedId(null); }
  async function persist(action: "save" | "publish" | "restore" | "disable", versionId?: string) {
    if (action === "save") { try { parseFlowDefinition(definition); } catch { setError("Completá los textos, datos y direcciones de los pasos antes de guardar. Podés guardar un borrador con conexiones pendientes."); setShowIssues(true); return; } }
    if (demo) { if (action !== "save") return; try { localStorage.setItem("openreply-demo-flow", JSON.stringify(definition)); setSaved(flowContent(definition)); setError(""); setNotice("Borrador de prueba guardado en este navegador."); } catch { setError("El navegador no permite guardar el borrador de prueba."); } return; }
    if (action === "publish" && !validation.valid) { setShowIssues(true); setError("Revisá los pasos marcados antes de publicar."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(api, { method: action === "save" ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "save" ? { definition, expectedRevision: revision } : { action, ...(action === "publish" ? { definition } : {}), expectedRevision: revision, ...(versionId ? { versionId } : {}) }) });
      const body = await response.json();
      if (!response.ok || !body.success) { if (body.issues) setShowIssues(true); throw new Error(response.status === 409 ? `${body.error || "Otra persona modificó este borrador."} Exportá tus cambios antes de recargar.` : body.error || "No se pudo guardar el flujo."); }
      if (typeof body.data?.revision === "number") { setRevision(body.data.revision); setSaved(flowContent(definition)); }
      const latest = await fetch(api, { cache: "no-store" }); const current = await latest.json();
      if (!latest.ok || !current.success) throw new Error("El cambio se guardó, pero no se pudo actualizar la vista. Recargá la página.");
      if (action === "restore" || action === "disable") applyPayload(current.data);
      else {
        setPayload(current.data);
        // Keep the revision acknowledged by our write. A later read may already
        // contain another editor's changes and must not authorize overwriting them.
        const stored = body.data.definition as FlowDefinition;
        setDefinition(stored); setSaved(flowContent(stored));
        if (current.data.draft?.revision !== body.data.revision) {
          setError("Tu cambio se guardó, pero otra sesión volvió a modificar el borrador. Exportá tu versión y recargá antes de seguir editando.");
          return;
        }
      }
      setNotice(action === "publish" ? "Flujo publicado y activo. Los nuevos comentarios usarán esta versión." : action === "restore" ? "Versión restaurada como borrador. Publicala para activarla." : action === "disable" ? "La campaña volvió al editor simple." : "Borrador guardado. La versión publicada sigue atendiendo los comentarios.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo completar la operación."); }
    finally { setBusy(false); }
  }
  async function runAction(runId: string, action: "cancel" | "resume") {
    if (demo) return;
    setBusy(true); setError("");
    try { const response = await fetch(`${api}/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId, action }) }); const body = await response.json(); if (!response.ok || !body.success) throw new Error(body.error || "No se pudo modificar el recorrido."); const fresh = await fetch(api, { cache: "no-store" }); const data = await fresh.json(); if (fresh.ok && data.success) setPayload(data.data); setNotice(action === "cancel" ? "Recorrido cancelado." : "Recorrido reanudado."); } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo modificar el recorrido."); } finally { setBusy(false); }
  }
  async function refreshActivity() {
    if (demo) return;
    try { const response = await fetch(api, { cache: "no-store" }); const body = await response.json(); if (!response.ok || !body.success) throw new Error(body.error || "No se pudo actualizar la actividad."); setPayload(body.data); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo actualizar la actividad."); }
  }
  function exportFlow() { const blob = new Blob([JSON.stringify(definition, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `openreply-${campaignId}.json`; link.click(); URL.revokeObjectURL(url); }
  async function importFlow(file: File) {
    try { if (file.size > 1024 * 1024) throw new Error("El archivo de flujo debe pesar menos de 1 MB."); const value = parseFlowDefinition(JSON.parse(await file.text())); setConfirm({ title: "Importar flujo", description: "Reemplaza el borrador abierto. Podés recuperar el cambio con Deshacer.", action: () => { change(value); setSelectedId(null); setCanvasEpoch((count) => count + 1); setNotice("Flujo importado como borrador."); } }); } catch (cause) { setError(cause instanceof Error ? cause.message : "El archivo no contiene un flujo válido."); } finally { if (uploadInput.current) uploadInput.current.value = ""; }
  }
  function template(kind: "resource" | "lead" | "qualification") { setTemplatesOpen(false); setConfirm({ title: "Usar plantilla", description: "Reemplaza el borrador por un recorrido listo para personalizar. Podés recuperar el anterior con Deshacer. Revisá los enlaces y campos antes de publicar.", action: () => { change(createTemplate(kind)); setSelectedId(null); setPanel("edit"); setCanvasEpoch((count) => count + 1); } }); }

  if (loading) return <div className="flow-workspace flow-loading" role="status"><span className="flow-loading-dot" /><h2>Preparando tu flujo</h2><p>Cargando pasos y conexiones…</p></div>;
  if (!payload) return <div className="panel space-y-4 p-6"><p role="alert" className="text-error">{error || "No se encontró la campaña."}</p><Link href="/campaigns" className={secondary}>Volver a campañas</Link></div>;
  const trigger = `${payload.campaign.matchAnyWord ? "Cualquier comentario" : `Comentario con ${(payload.campaign.keywords || []).join(", ") || "las palabras de tu campaña"}`} · ${payload.campaign.pendingNextReel ? "Próximo Reel" : payload.campaign.matchAnyPost ? "Cualquier publicación" : "Reel de la campaña"}`;
  const pickerSource = definition.nodes.find((node) => node.id === picker?.at?.source);
  return <div className={`flow-workspace ${isCreating ? "flow-creation" : ""} ${expanded ? "flow-is-expanded" : ""}`}>
    <header className="flow-header">
      {isCreating ? <div className="flow-title-area"><p className="flow-eyebrow">LA CONVERSACIÓN</p><h2 className="flow-creation-title">Diseñá tu flujo</h2><p className="flow-save-state">Se guarda junto con la campaña. Podés probarlo antes de activarlo.</p></div> :
      <div className="flow-title-area"><Link href={demo ? "/demo" : `/campaigns/${campaignId}`} className="flow-back"><FlowIcon name="back" size={14} />{demo ? "Volver a la demo" : "Volver a la campaña"}</Link><div className="flow-title-line"><h1>{payload.campaign.name}</h1><span className={`flow-status ${payload.campaign.flowEnabled && payload.campaign.isActive ? "is-live" : ""}`}><i />{payload.campaign.flowEnabled ? payload.campaign.isActive ? "Activo" : "Pausado" : "Borrador"}</span></div><p className="flow-save-state" aria-live="polite"><span className={dirty ? "text-warning" : ""}>{dirty ? "● Cambios sin guardar" : "✓ Todos los cambios guardados"}</span>{payload.publishedVersion && <span>Versión {payload.publishedVersion.version} publicada</span>}</p></div>
      }
      <div className="flow-header-actions"><button className="flow-button" onClick={() => setPreview(true)} disabled={busy}><FlowIcon name="play" size={15} />Probar flujo</button>{!isCreating && <><button className="flow-button" disabled={busy || !dirty || !canEdit} onClick={() => void persist("save")}><FlowIcon name="save" size={15} />{busy ? "Guardando…" : "Guardar"}</button><button title={demo ? "Conectá tu cuenta para publicar" : undefined} className="flow-button flow-button-primary" disabled={busy || demo || !canEdit} onClick={() => void persist("publish")}>Publicar y activar<FlowIcon name="arrow" size={15} /></button></>}</div>
    </header>
    {demo && <div className="flow-demo-note"><span className="flow-demo-label">MODO DEMO</span><span>Explorá, editá y probá. Tus cambios se guardan en este navegador.</span><Link href="/login">Conectar mi cuenta <span aria-hidden="true">↗</span></Link></div>}
    {!canEdit && <div className="flow-feedback text-warning">Vista de lectura. Necesitás permisos de administrador para editar o publicar.</div>}
    <div className="flow-top-nav">{!isCreating && <nav aria-label="Secciones del flujo">{([['edit', 'Editor', 'map'], ['runs', 'Actividad', 'activity'], ['versions', 'Versiones', 'history']] as const).map(([key, label, icon]) => <button key={key} aria-current={panel === key ? "page" : undefined} className={panel === key ? "is-active" : ""} onClick={() => setPanel(key)}><FlowIcon name={icon} size={16} />{label}</button>)}</nav>}<button className={`flow-health ${validation.valid ? "is-valid" : ""}`} aria-expanded={showIssues} onClick={() => setShowIssues(!showIssues)}><FlowIcon name={validation.valid ? "check" : "warning"} size={15} />{validation.valid ? isCreating ? "Flujo completo" : "Listo para publicar" : `${validation.issues.length} ${validation.issues.length === 1 ? "punto a revisar" : "puntos a revisar"}`}<FlowIcon name="down" size={13} /></button></div>
    {error && <div role="alert" className="flow-feedback text-error"><FlowIcon name="warning" /><span>{error}</span><button aria-label="Cerrar error" className="flow-icon-button" onClick={() => setError("")}><FlowIcon name="close" size={15} /></button></div>}
    {notice && <div role="status" className="flow-feedback text-success"><FlowIcon name="check" /><span>{notice}</span><button aria-label="Cerrar aviso" className="flow-icon-button" onClick={() => setNotice("")}><FlowIcon name="close" size={15} /></button></div>}
    {showIssues && <section className="flow-issues"><div><strong>{validation.valid ? "Tu flujo está listo" : "Un último repaso antes de publicar"}</strong><button aria-label="Cerrar revisión" className="flow-icon-button" onClick={() => setShowIssues(false)}><FlowIcon name="close" size={15} /></button></div><p>{validation.valid ? "Todos los pasos y sus conexiones están completos. Probá la conversación para revisar el resultado." : "Seleccioná un punto para ir al paso que necesita atención. Podés guardar el borrador mientras lo terminás."}</p>{validation.issues.map((issue, index) => <button key={index} className="flow-issue-row" disabled={!issue.nodeId} onClick={() => { if (issue.nodeId) selectNode(issue.nodeId); }}><FlowIcon name="warning" size={14} /><span>{issue.nodeId && <strong>{definition.nodes.find((node) => node.id === issue.nodeId)?.label}: </strong>}{issue.message}</span><FlowIcon name="arrow" size={14} /></button>)}</section>}
    {panel === "edit" && <section className="flow-editor-shell" aria-busy={busy}>
      <div className="flow-editor-toolbar"><div className="flow-view-switch" role="group" aria-label="Vista del editor"><button aria-pressed={viewMode === "map"} onClick={() => setViewMode("map")}><FlowIcon name="map" size={15} />Lienzo</button><button aria-pressed={viewMode === "steps"} onClick={() => setViewMode("steps")}><FlowIcon name="list" size={15} />Lista</button></div><span className="flow-step-count">{definition.nodes.length} pasos</span><div className="flow-toolbar-actions"><button className="flow-icon-button" aria-label="Deshacer" title="Deshacer (Ctrl / ⌘ + Z)" disabled={!history.length || busy || !canEdit} onClick={undo}><FlowIcon name="undo" size={16} /></button><button className="flow-icon-button" aria-label="Rehacer" title="Rehacer (Ctrl / ⌘ + Shift + Z)" disabled={!future.length || busy || !canEdit} onClick={redo}><FlowIcon name="redo" size={16} /></button><button className="flow-icon-button flow-expand-button" aria-label={expanded ? "Reducir editor" : "Ampliar editor"} title={expanded ? "Reducir editor (Esc)" : "Ampliar editor"} onClick={() => setExpanded(!expanded)}><FlowIcon name={expanded ? "collapse" : "expand"} size={16} /></button><span className="flow-toolbar-divider" /><button className="flow-button flow-template-button" disabled={!canEdit || busy} onClick={() => setTemplatesOpen(true)}><FlowIcon name="template" size={15} />Plantillas</button><details className="flow-more"><summary className="flow-icon-button" aria-label="Más opciones" title="Más opciones"><FlowIcon name="more" /></summary><div><button onClick={(event) => { exportFlow(); event.currentTarget.closest("details")?.removeAttribute("open"); }}>Exportar flujo</button><button disabled={busy || !canEdit} onClick={(event) => { uploadInput.current?.click(); event.currentTarget.closest("details")?.removeAttribute("open"); }}>Importar flujo</button></div></details><button className="flow-button flow-button-primary" disabled={!canEdit || busy} onClick={openPicker}><FlowIcon name="plus" size={16} />Agregar paso</button></div></div>
      <input ref={uploadInput} type="file" accept="application/json,.json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFlow(file); }} />
      <div className={`flow-editor-body ${viewMode === "map" ? "flow-map-body" : ""}`} inert={busy}>
        <div ref={stage} className="flow-stage">{viewMode === "steps" ? <FlowJourney definition={definition} selectedId={selectedId} onSelect={selectNode} onInsert={(at) => setPicker({ at })} issueNodes={issueNodes} editable={canEdit} trigger={trigger} /> : <FlowCanvas key={`${campaignId}-${canvasEpoch}`} definition={definition} selectedId={selectedId} onSelect={selectNode} onChange={change} onCheckpoint={checkpoint} issueNodes={issueNodes} onRequestAdd={(at, position) => setPicker({ at, position })} editable={canEdit} trigger={trigger} />}</div>
        {(selected || viewMode === "steps") && <aside ref={inspector} className="flow-inspector" aria-label="Configuración del paso"><div className="flow-inspector-heading"><div><p className="flow-eyebrow">{selected ? "PERSONALIZÁ ESTE PASO" : "EMPEZÁ POR ACÁ"}</p><h2>{selected ? "Editar paso" : "Diseñá la conversación"}</h2></div>{selected && <button className="flow-icon-button flow-inspector-close" aria-label="Cerrar edición del paso" onClick={closeStep}><FlowIcon name="close" size={18} /><span>Volver al recorrido</span></button>}</div>
          <div className="flow-inspector-content">{selected ? <>
            {!!validation.issues.filter((issue) => issue.nodeId === selected.id).length && <div className="flow-node-issues">{validation.issues.filter((issue) => issue.nodeId === selected.id).map((issue, index) => <p key={index}><FlowIcon name="warning" size={13} />{issue.message}</p>)}</div>}
            <fieldset disabled={!canEdit} className="min-w-0"><NodeEditor key={selected.id} node={selected} definition={definition} onChange={updateNode} onConnect={connect} onInsert={(handle) => setPicker({ at: { source: selected.id, handle } })} onDuplicate={duplicate} onDelete={() => setConfirm({ title: `¿Eliminar “${selected.label}”?`, description: "Se quitarán este paso y sus conexiones. Podés recuperarlos con Deshacer.", action: remove })} firstMessage={openingNodes.has(selected.id)} media={payload.capabilities?.media} demo={demo} customFields={customFields} /></fieldset>
            {selected.type === "start" && creation && <button className="flow-button mt-4" onClick={creation.onConfigure}>Configurar Reel y palabras<FlowIcon name="arrow" size={14} /></button>}
            {selected.type === "start" && !demo && !isCreating && <Link href={`/campaigns/${campaignId}/edit`} className="flow-button mt-4">Configurar Reel y palabras<FlowIcon name="arrow" size={14} /></Link>}
            {!isCreating && <details className="flow-advanced mt-5"><summary>Actividad de este paso</summary><div>{payload.stepStats?.filter((stat) => stat.nodeId === selected.id).length ? payload.stepStats.filter((stat) => stat.nodeId === selected.id).map((stat) => <p key={stat.status} className="text-xs text-muted">{statusLabel(stat.status)}: {stat.count}</p>) : <p className="text-xs text-muted">Todavía no hay actividad en este paso.</p>}{!!selectedLinkStats.length && <div className="mt-3 space-y-2">{selectedLinkStats.map((stat) => <div key={stat.buttonId} className="rounded-lg border border-border p-2"><p className="text-xs font-medium">{selected.type === "message" ? [...selected.data.buttons, ...(selected.data.quickReplies || [])].find((button) => button.id === stat.buttonId)?.label || stat.buttonId : stat.buttonId}</p><p className="mt-1 text-xs text-muted">{stat.clicks} clics · {stat.runsClicked} recorridos</p></div>)}</div>}</div></details>}
          </> : <div className="flow-guide"><div className="flow-guide-illustration"><FlowIcon name="message" size={28} /><span /><FlowIcon name="input" size={24} /><span /><FlowIcon name="check" size={24} /></div><h3>Un buen flujo se siente como una charla.</h3><p>Personalizá cada mensaje y decidí qué pasa después de cada respuesta.</p><ol><li><span>1</span><div><strong>Revisá cómo empieza</strong><p>{trigger}</p></div></li><li><span>2</span><div><strong>Dale tu voz a los mensajes</strong><p>Elegí un paso para editarlo. Usá el + para agregar uno en ese lugar.</p></div></li><li><span>3</span><div><strong>Probalo como tu contacto</strong><p>Recorré la conversación antes de activarla.</p></div></li></ol><button className="flow-button flow-button-wide" onClick={() => { const first = definition.nodes.find((node) => openingNodes.has(node.id)); selectNode(first?.id || definition.entryNodeId); }}>Editar primer mensaje<FlowIcon name="arrow" size={15} /></button><button className="flow-guide-link" disabled={!canEdit} onClick={() => setTemplatesOpen(true)}>Empezar con una plantilla</button><div className="flow-tip"><FlowIcon name="delay" size={17} /><p>Una respuesta de tu contacto habilita la conversación durante 24 horas.</p></div></div>}</div>
        </aside>}
      </div>
      <footer className="flow-editor-footer"><span><span className="flow-small-dot" />Instagram Direct{payload.campaign.instagramAccount?.username ? ` · @${payload.campaign.instagramAccount.username}` : ""}</span>{creation ? <button className="flow-guide-link" onClick={creation.onConfigure}>Configurar entrada ↗</button> : !demo ? <Link href={`/campaigns/${campaignId}/edit`}>Configurar entrada <span aria-hidden="true">↗</span></Link> : <span>Entorno de prueba · Sin envíos reales</span>}</footer>
    </section>}
    {panel === "runs" && <section className="flow-section"><div className="flow-section-heading"><div><h2>Lo que pasa en tu flujo</h2><p>Seguí a cada contacto y detectá dónde necesita ayuda.</p></div><button className="flow-button" disabled={busy || demo} onClick={() => void refreshActivity()}><FlowIcon name="history" size={15} />Actualizar</button></div>{!!payload.summary?.length && <div className="flow-stat-grid">{payload.summary.map((item) => <div key={item.status}><span>{statusLabel(item.status)}</span><strong>{item.count}</strong></div>)}</div>}{payload.runs.length ? <div className="flow-run-list">{payload.runs.map((run) => <details key={run.id}><summary><span className="flow-contact-avatar">{(run.contact?.username || run.contact?.email || "C")[0].toUpperCase()}</span><strong>{run.contact?.username ? `@${run.contact.username}` : run.contact?.email || "Contacto"}</strong><span className={`flow-status ${run.status.toUpperCase() === "COMPLETED" ? "is-live" : ""}`}>{statusLabel(run.status)}</span><time>{new Date(run.createdAt).toLocaleString("es-AR")}</time><FlowIcon name="down" size={15} /></summary><div className="flow-run-detail">{run.error && <p className="text-error">{run.error}</p>}{run.steps?.map((step) => <button key={step.id} className="flow-run-step" onClick={() => selectNode(step.nodeId)}><FlowIcon name="arrow" size={14} /><span>{definition.nodes.find((node) => node.id === step.nodeId)?.label || step.nodeId}</span><span>{statusLabel(step.status)}{step.error ? ` · ${step.error}` : ""}</span></button>)}<div className="mt-4 flex gap-2">{canEdit && run.status.toUpperCase() === "PAUSED" && <button className="flow-button" disabled={busy} onClick={() => void runAction(run.id, "resume")}>Reanudar</button>}{canEdit && ["RUNNING", "WAITING", "WAITING_WINDOW", "PAUSED"].includes(run.status.toUpperCase()) && <button className="flow-button text-error" disabled={busy} onClick={() => void runAction(run.id, "cancel")}>Cancelar recorrido</button>}</div></div></details>)}</div> : <div className="flow-empty"><span className="flow-empty-icon"><FlowIcon name="activity" size={32} /></span><h3>Tu primera conversación empieza acá</h3><p>Cuando un contacto entre al flujo, vas a ver sus respuestas, los pasos que recorrió y su estado.</p><button className="flow-button" onClick={() => setPreview(true)}><FlowIcon name="play" size={15} />Probar una conversación</button></div>}</section>}
    {panel === "versions" && <section className="flow-section"><div className="flow-section-heading"><div><h2>Historial de publicaciones</h2><p>Volvé a una versión anterior cuando lo necesites. Los recorridos en curso conservan su versión.</p></div></div>{payload.versions.length ? <div className="flow-version-list">{payload.versions.map((version) => <article key={version.id}><span className="flow-empty-icon"><FlowIcon name="history" size={21} /></span><div><h3>Versión {version.version} {payload.publishedVersion?.id === version.id && <span className="flow-status is-live">Publicada</span>}</h3><p>{new Date(version.createdAt).toLocaleString("es-AR")}</p></div><button className="flow-button" disabled={!canEdit || busy} onClick={() => setConfirm({ title: `Restaurar versión ${version.version}`, description: "La versión elegida reemplaza el borrador. Luego podés revisarla y publicarla.", action: () => void persist("restore", version.id) })}>Restaurar como borrador</button></article>)}</div> : <div className="flow-empty"><span className="flow-empty-icon"><FlowIcon name="history" size={32} /></span><h3>Cada publicación, una versión guardada</h3><p>Cuando publiques tu flujo, vas a poder consultar su historial y recuperar una versión anterior.</p><button className="flow-button" onClick={() => setPanel("edit")}>Volver al editor<FlowIcon name="arrow" size={15} /></button></div>}{payload.campaign.flowEnabled && <div className="flow-section-bottom"><button className="flow-button text-warning" disabled={!canEdit || busy} onClick={() => setConfirm({ title: "Volver al editor simple", description: "Desactiva el flujo visual y cancela los recorridos pendientes. La campaña utiliza la configuración del editor simple.", action: () => void persist("disable") })}>Desactivar flujo visual</button></div>}</section>}
    {picker && <StepPicker onClose={() => setPicker(null)} onAdd={addNode} context={pickerSource ? `“${pickerSource.label}” · ${ports(pickerSource).find((port) => port.id === picker.at?.handle)?.label || ""}` : undefined} replacing={!!definition.edges.find((edge) => edge.source === picker.at?.source && edge.sourceHandle === picker.at?.handle)} />}
    {templatesOpen && <FlowDialog onClose={() => setTemplatesOpen(false)} labelledBy="template-title" className="flow-picker"><div className="flow-modal-heading"><div><p className="flow-eyebrow">UN PUNTO DE PARTIDA</p><h2 id="template-title">¿Qué querés lograr?</h2><p>Elegí un recorrido listo para adaptar a tu marca.</p></div><button className="flow-icon-button" aria-label="Cerrar plantillas" onClick={() => setTemplatesOpen(false)}><FlowIcon name="close" /></button></div><div className="flow-template-list">{([['resource', 'message', 'Entregar un recurso', 'De un comentario a una guía, un enlace o un regalo.', 'Comentario → Respuesta → Recurso'], ['lead', 'input', 'Capturar email + recurso', 'Pedí un email y entregá contenido de valor.', 'Comentario → Email → Recurso'], ['qualification', 'condition', 'Calificar y derivar', 'Distinguí clientes y derivá a una persona cuando haga falta.', 'Comentario → Datos → Dos caminos']] as const).map(([kind, icon, title, description, route]) => <button key={kind} onClick={() => template(kind)}><span className="flow-type-icon"><FlowIcon name={icon} size={23} /></span><span><strong>{title}</strong><p>{description}</p><small>{route}</small></span><FlowIcon name="arrow" size={18} /></button>)}</div></FlowDialog>}
    {preview && <FlowPreview definition={definition} onClose={() => setPreview(false)} onSelect={(id) => { setPreview(false); selectNode(id); }} />}
    {confirm && <FlowDialog onClose={() => setConfirm(null)} labelledBy="flow-confirm-title" className="flow-confirm"><span className="flow-empty-icon"><FlowIcon name="warning" size={25} /></span><h2 id="flow-confirm-title">{confirm.title}</h2><p>{confirm.description}</p><div className="flow-confirm-actions"><button className="flow-button" onClick={() => setConfirm(null)}>Cancelar</button><button className="flow-button flow-button-primary" onClick={() => { const action = confirm.action; setConfirm(null); action(); }}>Continuar</button></div></FlowDialog>}
  </div>;
}
