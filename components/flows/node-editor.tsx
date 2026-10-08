"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { FlowDefinition, FlowDelayData } from "@/lib/flows/definition";
import { durationFromMinutes, durationToMinutes, getDurationUnit, MAX_DELAY_MINUTES, type DurationUnit } from "@/lib/flows/duration";
import { ACTION_LABELS, NODE_CATALOG, ports, uid, type ActionData, type BuilderNode, type ConditionData, type FlowButton, type InputData, type MessageData, type RandomizerData, type Rule } from "./model";
import AssetUpload from "./asset-upload";
import FlowIcon from "./flow-icon";
import VariableTextarea from "./variable-textarea";
import { getMessageVariables, type MessageField, type MessageVariable } from "@/lib/flows/message-variables";
import "./node-editor.css";

const control = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-accent";
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block space-y-1.5 text-xs text-muted"><span>{label}</span>{children}</label>; }
type TextLimits = { maxCharacters?: number; maxBytes?: number };
function textExceedsLimit(value: string, { maxCharacters, maxBytes }: TextLimits) {
  return Boolean((maxCharacters !== undefined && value.length > maxCharacters) || (maxBytes !== undefined && new TextEncoder().encode(value).length > maxBytes));
}
function TextFeedback({ id, value, maxCharacters, maxBytes }: { id: string; value: string } & TextLimits) {
  const bytes = maxBytes !== undefined ? new TextEncoder().encode(value).length : 0;
  const exceedsCharacters = maxCharacters !== undefined && value.length > maxCharacters;
  const exceedsBytes = maxBytes !== undefined && bytes > maxBytes;
  return <span id={id} className="flow-field-feedback">
    <span className={exceedsCharacters || exceedsBytes ? "flow-field-count is-over-limit" : "flow-field-count"}>
      {maxCharacters !== undefined && <span>{value.length} / {maxCharacters} caracteres</span>}
      {maxCharacters !== undefined && maxBytes !== undefined && <span aria-hidden="true"> · </span>}
      {maxBytes !== undefined && <span>{bytes} / {maxBytes} bytes</span>}
    </span>
    {exceedsCharacters && <span className="flow-field-warning">Acortá el texto: admite hasta {maxCharacters} caracteres.</span>}
    {exceedsBytes && <span className="flow-field-warning">Este texto supera el espacio permitido. Acortalo o dividilo en varios mensajes.</span>}
    {maxBytes !== undefined && !exceedsBytes && <span className="flow-field-hint">Emojis y acentos ocupan más espacio.</span>}
  </span>;
}
function Text({ label, value, onChange, placeholder, maxCharacters, maxBytes }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string } & TextLimits) {
  const feedbackId = useId();
  const hasLimits = maxCharacters !== undefined || maxBytes !== undefined;
  return <Field label={label}><input aria-label={label} className={control} value={value} placeholder={placeholder} aria-invalid={textExceedsLimit(value, { maxCharacters, maxBytes }) || undefined} aria-describedby={hasLimits ? feedbackId : undefined} onChange={(event) => onChange(event.target.value)} />{hasLimits && <TextFeedback id={feedbackId} value={value} maxCharacters={maxCharacters} maxBytes={maxBytes} />}</Field>;
}
function NumberField({ label, value, onChange, min = 0, max }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number }) { return <Field label={label}><input aria-label={label} type="number" step="any" min={min} max={max} className={control} value={value} onChange={(event) => onChange(Number(event.target.value))} /></Field>; }
function Area({ label, value, onChange, onBlur, maxCharacters, maxBytes, variables }: { label: string; value: string; onChange: (value: string) => void; onBlur?: () => void; variables?: readonly MessageVariable[] } & TextLimits) {
  const feedbackId = useId();
  const inputId = `${feedbackId}-input`;
  const hasLimits = maxCharacters !== undefined || maxBytes !== undefined;
  return <div className="block space-y-1.5 text-xs text-muted"><label htmlFor={inputId}>{label}</label>{variables ? <VariableTextarea id={inputId} label={label} value={value} onChange={onChange} onBlur={onBlur} className={control} variables={variables} invalid={textExceedsLimit(value, { maxCharacters, maxBytes })} describedBy={hasLimits ? feedbackId : undefined} /> : <textarea id={inputId} aria-label={label} rows={3} className={control} value={value} aria-invalid={textExceedsLimit(value, { maxCharacters, maxBytes }) || undefined} aria-describedby={hasLimits ? feedbackId : undefined} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} />}{hasLimits && <TextFeedback id={feedbackId} value={value} maxCharacters={maxCharacters} maxBytes={maxBytes} />}</div>;
}
function Select({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (value: string) => void }) { return <Field label={label}><select aria-label={label} className={control} value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></Field>; }
const smallButton = "rounded-lg border border-border px-2.5 py-1.5 text-xs hover:border-accent";

type RouteProps = { node: BuilderNode; definition: FlowDefinition; onConnect: (handle: string, target: string) => void; onInsert?: (handle: string) => void };

function RouteEditor({ node, definition, onConnect, onInsert, handle, label }: RouteProps & { handle: string; label: string }) {
  const destination = definition.edges.find((edge) => edge.source === node.id && edge.sourceHandle === handle)?.target || "";
  const target = definition.nodes.find((candidate) => candidate.id === destination);
  return <div className="flow-inline-route">
    <Select label={label} value={destination} options={[["", "Elegir próximo paso…"], ...definition.nodes.filter((candidate) => candidate.id !== node.id && candidate.type !== "start").map((candidate) => [candidate.id, `${candidate.label} · ${NODE_CATALOG.find((item) => item.type === candidate.type)?.title}`] as [string, string])]} onChange={(next) => onConnect(handle, next)} />
    {onInsert && <button type="button" className="flow-button flow-route-create" onClick={() => onInsert(handle)} title={target ? `Insertar un paso antes de ${target.label}` : "Crear y conectar un paso"}><FlowIcon name="plus" size={14} />{target ? "Insertar un paso" : "Agregar paso"}</button>}
  </div>;
}

export default function NodeEditor({ node, definition, onChange, onConnect, onInsert, onDuplicate, onDelete, firstMessage, media, demo = false, customFields }: RouteProps & { onChange: (node: BuilderNode) => void; onDuplicate: () => void; onDelete: () => void; firstMessage: boolean; media?: Record<string, boolean>; demo?: boolean; customFields?: readonly MessageField[] }) {
  const latestNode = useRef(node);
  const variables = useMemo(() => getMessageVariables(definition, customFields), [definition, customFields]);
  useEffect(() => { latestNode.current = node; }, [node]);
  function setData(data: unknown) { onChange({ ...latestNode.current, data } as BuilderNode); }
  const catalog = NODE_CATALOG.find((item) => item.type === node.type)!;
  const footerPorts = ports(node).filter((port) => node.type !== "message" || port.id === "next");
  const waitsForReply = node.type === "message" && (firstMessage || ports(node).some((port) => port.id.startsWith("button.")));
  const nextConnected = definition.edges.some((edge) => edge.source === node.id && edge.sourceHandle === "next");
  const replyHelp = firstMessage ? "La respuesta escrita habilita los mensajes siguientes. Elegí cómo continuar."
    : nextConnected ? "La respuesta escrita continúa por el destino que elijas acá."
    : ports(node).filter((port) => port.id.startsWith("button.")).length === 1 ? "Si no elegís otro destino, la respuesta escrita sigue el camino de la única opción."
    : "Conectá este camino para continuar con una respuesta escrita. Si lo dejás sin conectar, la persona debe elegir una opción.";
  return <div className="flow-node-editor space-y-5">
    <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-xs font-semibold" style={{ color: catalog.color }}><FlowIcon name={node.type} size={16} />{catalog.title}</span><div className="flex gap-1">{node.type !== "start" && <><button className="flow-icon-button" aria-label="Duplicar paso" title="Duplicar paso" onClick={onDuplicate}><FlowIcon name="copy" size={15} /></button><button className="flow-icon-button" aria-label="Eliminar paso" title="Eliminar paso" onClick={onDelete}><FlowIcon name="trash" size={15} /></button></>}</div></div>
    <Text label="Nombre del paso" value={node.label} onChange={(label) => onChange({ ...node, label })} />
    {node.type === "start" && <div className="rounded-lg border border-border bg-background p-3 text-xs leading-relaxed text-muted">El flujo empieza cuando llega un comentario que coincide con el Reel y las palabras configuradas en tu campaña. Podés cambiar esa entrada desde “Configurar campaña”.</div>}
    {node.type === "message" && <MessageEditor node={node} definition={definition} onConnect={onConnect} onInsert={onInsert} data={node.data as MessageData} onChange={setData} firstMessage={firstMessage} media={media} demo={demo} variables={variables} />}
    {node.type === "input" && <InputEditor data={node.data as InputData} onChange={setData} variables={variables} />}
    {node.type === "condition" && <ConditionEditor data={node.data as ConditionData} onChange={setData} />}
    {node.type === "delay" && <DelayEditor data={node.data} onChange={setData} />}
    {node.type === "action" && <ActionEditor data={node.data as ActionData} onChange={setData} />}
    {node.type === "randomizer" && <RandomEditor data={node.data as RandomizerData} onChange={setData} />}
    {node.type === "end" && <p className="text-sm text-muted">Finaliza la ejecución actual para este contacto.</p>}
    {footerPorts.length > 0 && <div className="space-y-3 border-t border-border pt-5"><p className="text-sm font-semibold">{node.type === "message" ? waitsForReply ? "Si escribe una respuesta" : "Después de enviar el mensaje" : "¿Cómo sigue?"}</p><p className="text-xs leading-relaxed text-muted">{node.type === "message" ? waitsForReply ? replyHelp : "El recorrido sigue automáticamente por este camino." : onInsert ? "Elegí un paso existente o agregá uno nuevo desde acá." : "Elegí un paso existente o usá el + del recorrido para crear uno."}</p>{footerPorts.map((port) => <RouteEditor key={port.id} node={node} definition={definition} onConnect={onConnect} onInsert={onInsert} handle={port.id} label={node.type === "message" ? waitsForReply ? "Después de su respuesta" : "Próximo paso" : port.label} />)}</div>}
  </div>;
}

function DelayEditor({ data, onChange }: { data: FlowDelayData; onChange: (data: FlowDelayData) => void }) {
  const unit = getDurationUnit(data);
  const amount = durationFromMinutes(data.minutes, unit);
  const date = data.until ? new Date(data.until) : null;
  const localDate = date && !Number.isNaN(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
  const presets: { amount: number; unit: DurationUnit; label: string }[] = [
    { amount: 30, unit: "seconds", label: "30 seg" }, { amount: 5, unit: "minutes", label: "5 min" },
    { amount: 1, unit: "hours", label: "1 hora" }, { amount: 24, unit: "hours", label: "24 horas" },
  ];
  return <div className="space-y-4">
    <Select label="Cuándo continuar" value={data.until ? "date" : "duration"} options={[["duration", "Después de un tiempo"], ["date", "En una fecha y hora"]]} onChange={(value) => onChange({ ...data, until: value === "date" ? new Date(Date.now() + data.minutes * 60000).toISOString() : undefined })} />
    {data.until ? <Field label="Fecha y hora local"><input type="datetime-local" className={control} value={localDate} onChange={(event) => { if (event.target.value) { const next = new Date(event.target.value); if (!Number.isNaN(next.getTime())) onChange({ ...data, until: next.toISOString() }); } }} /></Field> : <>
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Tiempo de espera" value={amount} onChange={(value) => onChange({ ...data, minutes: durationToMinutes(value, unit), unit })} max={durationFromMinutes(MAX_DELAY_MINUTES, unit)} />
        <Select label="Unidad de tiempo" value={unit} options={[["seconds", "Segundos"], ["minutes", "Minutos"], ["hours", "Horas"]]} onChange={(value) => onChange({ ...data, minutes: durationToMinutes(amount, value as DurationUnit), unit: value as DurationUnit })} />
      </div>
      <div className="flex flex-wrap gap-2">{presets.map((preset) => <button type="button" key={preset.label} className={smallButton} onClick={() => onChange({ ...data, minutes: durationToMinutes(preset.amount, preset.unit), unit: preset.unit })}>{preset.label}</button>)}</div>
      {(data.minutes < 0 || data.minutes > MAX_DELAY_MINUTES) && <p role="alert" className="text-xs text-warning">Elegí un tiempo entre 0 y {durationFromMinutes(MAX_DELAY_MINUTES, unit).toLocaleString("es-AR")} {unit === "seconds" ? "segundos" : unit === "hours" ? "horas" : "minutos"} (máximo 7 días).</p>}
    </>}
    <p className="text-xs leading-relaxed text-muted">La espera no renueva el permiso para enviar mensajes. El envío se comprueba otra vez cuando termina.</p>
  </div>;
}

const BLOCK_LABELS = { text: "Texto", image: "Imagen", video: "Video", audio: "Audio", pdf: "PDF" };

function MessageEditor({ node, definition, onConnect, onInsert, data, onChange, firstMessage, media, demo, variables }: RouteProps & { data: MessageData; onChange: (data: MessageData) => void; firstMessage: boolean; media?: Record<string, boolean>; demo: boolean; variables: readonly MessageVariable[] }) {
  const latestData = useRef(data);
  useEffect(() => { latestData.current = data; }, [data]);
  const patch = (partial: Partial<MessageData>) => onChange({ ...data, ...partial });
  const updateBlock = (index: number, value: MessageData["blocks"][number]) => onChange({ ...latestData.current, blocks: latestData.current.blocks.map((block, offset) => offset === index ? value : block) });
  const [emptyReplyMode, setEmptyReplyMode] = useState(Boolean(data.quickReplies?.length));
  const replyMode = data.quickReplies?.length ? true : data.buttons.length ? false : emptyReplyMode;
  const replies = replyMode ? data.quickReplies || [] : data.buttons;
  const hasReplies = Boolean(data.buttons.length || data.quickReplies?.length);
  const updateReplies = (values: FlowButton[]) => patch(replyMode ? { quickReplies: values, buttons: [] } : { buttons: values, quickReplies: [] });
  function moveBlock(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= data.blocks.length) return;
    const blocks = [...data.blocks];
    [blocks[destination], blocks[index]] = [blocks[index], blocks[destination]];
    patch({ blocks });
  }
  return <div className="space-y-4">
    {firstMessage && <div className="flow-opening-tip"><FlowIcon name="message" size={16} /><p><strong>Primero, abrí la conversación</strong><span>Pedí una respuesta para continuar. Este mensaje lleva solo texto.</span></p></div>}
    {data.blocks.map((block, index) => <div key={index} className="flow-message-block space-y-2 rounded-xl border border-border p-3">
      <div className="flow-block-heading"><span className="flow-block-title">{BLOCK_LABELS[block.type]} · Bloque {index + 1}</span><div className="flow-block-actions"><button type="button" aria-label={`Subir bloque ${index + 1}`} disabled={index === 0} className="flow-block-control" onClick={() => moveBlock(index, -1)}><FlowIcon name="down" size={13} className="flow-block-up" />Subir</button><button type="button" aria-label={`Bajar bloque ${index + 1}`} disabled={index === data.blocks.length - 1} className="flow-block-control" onClick={() => moveBlock(index, 1)}><FlowIcon name="down" size={13} />Bajar</button><button type="button" aria-label={`Quitar bloque ${index + 1}`} className="flow-block-control is-destructive" onClick={() => patch({ blocks: data.blocks.filter((_, offset) => offset !== index) })}><FlowIcon name="trash" size={13} />Quitar</button></div></div>
      {block.type === "text" ? <><Area label="Mensaje" value={block.text} maxBytes={1000} maxCharacters={hasReplies ? 640 : undefined} onChange={(text) => updateBlock(index, { ...block, text })} variables={variables} />{hasReplies && <p className="text-[11px] text-muted">El texto con botones admite hasta 640 caracteres.</p>}</> : <><Text label="URL del archivo" value={block.url} placeholder="https://…" onChange={(url) => updateBlock(index, { ...block, url })} /><Text label="Nombre" value={block.name || ""} onChange={(name) => updateBlock(index, { ...block, name })} /><AssetUpload type={block.type} demo={demo} onUploaded={(asset) => updateBlock(index, { ...block, ...asset })} />{block.type === "pdf" && media?.pdf === false && <p className="text-xs text-warning">Esta conexión entrega el PDF como un enlace para descargarlo.</p>}</>}
    </div>)}
    {(!firstMessage || !data.blocks.length) && <div className="flow-message-additions">{(["text", "image", "video", "audio", "pdf"] as const).map((type) => <button type="button" key={type} className={smallButton} disabled={firstMessage && (data.blocks.length >= 1 || type !== "text")} onClick={() => patch({ blocks: [...data.blocks, type === "text" ? { type, text: "" } : { type, url: "" }] })}><FlowIcon name="plus" size={13} />{BLOCK_LABELS[type]}</button>)}</div>}
    {!firstMessage && <Select label="Opciones para responder" value={replyMode ? "quick" : "buttons"} options={[["buttons", "Botones permanentes (hasta 3)"], ["quick", "Respuestas rápidas (hasta 11)"]]} onChange={(value) => { setEmptyReplyMode(value === "quick"); patch(value === "quick" ? { buttons: [], quickReplies: replies.filter((reply) => reply.kind === "continue").length ? replies.filter((reply) => reply.kind === "continue") : [{ id: uid("reply"), label: "Continuar", kind: "continue" }] } : { buttons: replies.slice(0, 3), quickReplies: [] }); }} />}
    {replies.map((button, index) => <div key={button.id} className="flow-message-reply space-y-2 rounded-xl border border-border p-3"><div className="flow-reply-heading"><span className="text-xs text-muted">{replyMode ? "Respuesta rápida" : "Botón"} {index + 1}</span><button type="button" aria-label={`Quitar ${replyMode ? "respuesta rápida" : "botón"} ${index + 1}`} className="flow-block-control is-destructive" onClick={() => { setEmptyReplyMode(replyMode); updateReplies(replies.filter((item) => item.id !== button.id)); }}><FlowIcon name="trash" size={13} />Quitar</button></div><Text label={replyMode ? "Texto de la respuesta" : "Texto del botón"} maxCharacters={20} value={button.label} onChange={(label) => updateReplies(replies.map((item) => item.id === button.id ? { ...item, label } : item))} />{!replyMode && <Select label="Al tocar" value={button.kind} options={[["continue", "Continuar el flujo"], ["url", "Abrir un enlace"]]} onChange={(kind) => updateReplies(replies.map((item) => item.id === button.id ? { ...item, kind: kind as FlowButton["kind"] } : item))} />}{button.kind === "url" ? <Text label="Enlace" value={button.url || ""} onChange={(url) => updateReplies(replies.map((item) => item.id === button.id ? { ...item, url } : item))} /> : <RouteEditor node={node} definition={definition} onConnect={onConnect} onInsert={onInsert} handle={`button.${button.id}`} label={`Después de tocar «${button.label || (replyMode ? "esta respuesta" : "este botón")}»`} />}</div>)}
    {!firstMessage && <button type="button" className="flow-button flow-reply-add" disabled={replies.length >= (replyMode ? 11 : 3)} onClick={() => updateReplies([...replies, { id: uid("button"), label: "Continuar", kind: "continue" }])}><FlowIcon name="plus" size={14} />{replyMode ? "Respuesta rápida" : "Botón"}</button>}
  </div>;
}

function InputEditor({ data, onChange, variables }: { data: InputData; onChange: (data: InputData) => void; variables: readonly MessageVariable[] }) {
  const patch = (partial: Partial<InputData>) => onChange({ ...data, ...partial });
  return <div className="space-y-3"><Area label="Pregunta" value={data.prompt} onChange={(prompt) => patch({ prompt })} variables={variables} /><Select label="Tipo de dato" value={data.inputType} options={[["email", "Email"], ["phone", "Teléfono"], ["text", "Texto"], ["number", "Número"], ["choice", "Elegir una opción"]]} onChange={(inputType) => patch({ inputType: inputType as InputData["inputType"] })} /><Text label="Guardar en el campo" value={data.fieldKey} placeholder="email, telefono, interes…" onChange={(fieldKey) => patch({ fieldKey })} />{data.inputType === "choice" && <Area label="Opciones (una por línea, hasta 10)" value={(data.options || []).join("\n")} onChange={(value) => patch({ options: value.split("\n") })} onBlur={() => patch({ options: (data.options || []).map((option) => option.trim()).filter(Boolean) })} />}<details className="flow-advanced"><summary>Si no responde o el dato es inválido</summary><div className="space-y-3"><Area label="Mensaje ante un dato inválido" value={data.retryMessage} onChange={(retryMessage) => patch({ retryMessage })} variables={variables} /><NumberField label="Intentos máximos" value={data.maxAttempts} min={1} max={5} onChange={(maxAttempts) => patch({ maxAttempts })} /><NumberField label="Esperar respuesta hasta (minutos)" value={data.timeoutMinutes} min={1} max={10080} onChange={(timeoutMinutes) => patch({ timeoutMinutes })} /></div></details><p className="text-xs text-muted">Recibir un email guarda el dato. El consentimiento para marketing debe pedirse explícitamente en el mensaje.</p></div>;
}

function ConditionEditor({ data, onChange }: { data: ConditionData; onChange: (data: ConditionData) => void }) {
  const update = (index: number, partial: Partial<Rule>) => onChange({ ...data, rules: data.rules.map((rule, offset) => offset === index ? { ...rule, ...partial } : rule) });
  const fields: [string, string][] = [["follows", "Sigue mi cuenta"], ["tag", "Etiqueta del contacto"], ["email", "Email"], ["phone", "Teléfono"], ["comment", "Comentario inicial"], ["window_open", "Puede recibir mensajes"], ["custom", "Otro campo o clic en enlace…"]];
  return <div className="space-y-4"><Select label="Para tomar el camino «Sí»" value={data.match} options={[["all", "Se cumplen todas las condiciones"], ["any", "Se cumple al menos una condición"]]} onChange={(match) => onChange({ ...data, match: match as "all" | "any" })} />
    {data.rules.map((rule, index) => {
      const known = fields.some(([key]) => key === rule.field && key !== "custom");
      const boolean = ["follows", "window_open"].includes(rule.field);
      return <div key={index} className="space-y-3 rounded-xl border border-border p-3"><div className="flex items-center justify-between"><span className="text-xs font-medium">Condición {index + 1}</span><button className="flow-icon-button" aria-label={`Quitar condición ${index + 1}`} onClick={() => onChange({ ...data, rules: data.rules.filter((_, offset) => offset !== index) })}><FlowIcon name="trash" size={14} /></button></div><Select label="Qué querés comprobar" value={known ? rule.field : "custom"} options={fields} onChange={(field) => update(index, { field: field === "custom" ? "mi_campo" : field, ...(field === "follows" || field === "window_open" ? { operator: "equals", value: "true" } : {}) })} />
        {!known && <><Text label="Nombre del campo" value={rule.field} placeholder="interes, clicked:ID_BOTON…" onChange={(field) => update(index, { field })} /><p className="text-[11px] leading-relaxed text-muted">Usá el nombre de un campo guardado. Para comprobar un clic: clicked:ID_BOTON.</p></>}
        <Select label="Comparación" value={rule.operator} options={[["equals", "Es igual a"], ["not_equals", "Es distinto de"], ["contains", "Contiene"], ["exists", "Tiene un valor"], ["not_exists", "No tiene valor"], ["greater_than", "Es mayor que"], ["less_than", "Es menor que"]]} onChange={(operator) => update(index, { operator: operator as Rule["operator"] })} />
        {!["exists", "not_exists"].includes(rule.operator) && (boolean && ["true", "false"].includes(String(rule.value)) ? <Select label="Resultado esperado" value={String(rule.value)} options={[["true", "Sí"], ["false", "No"]]} onChange={(value) => update(index, { value })} /> : <Text label="Valor esperado" value={String(rule.value ?? "")} placeholder={rule.field === "tag" ? "Cliente, Interesado…" : "Escribí el valor…"} onChange={(value) => update(index, { value })} />)}
      </div>;
    })}<button className="flow-button flow-button-wide" onClick={() => onChange({ ...data, rules: [...data.rules, { field: "tag", operator: "contains", value: "Interesado" }] })}><FlowIcon name="plus" size={14} />Agregar condición</button></div>;
}
function ActionEditor({ data, onChange }: { data: ActionData; onChange: (data: ActionData) => void }) {
  const patch = (partial: Partial<ActionData>) => onChange({ ...data, ...partial });
  return <div className="space-y-3"><Select label="Acción" value={data.action} options={Object.entries(ACTION_LABELS)} onChange={(action) => patch({ action: action as ActionData["action"] })} />{["add_tag", "remove_tag"].includes(data.action) && <Text label="Etiqueta" value={data.tag || ""} onChange={(tag) => patch({ tag })} />}{["set_field", "clear_field", "increment_field"].includes(data.action) && <Text label="Campo" value={data.fieldKey || ""} onChange={(fieldKey) => patch({ fieldKey })} />}{["set_field", "increment_field", "goal"].includes(data.action) && <Text label={data.action === "goal" ? "Nombre del objetivo" : "Valor"} value={String(data.value ?? "")} onChange={(value) => patch({ value })} />}{data.action === "webhook" && <><Text label="URL de la integración" value={data.url || ""} placeholder="https://…" onChange={(url) => patch({ url })} /><p className="text-xs text-muted">Envía datos del contacto y del flujo a esta URL mediante POST.</p></>}{data.action === "start_flow" && <Text label="ID de la campaña de destino" value={data.automationId || ""} onChange={(automationId) => patch({ automationId })} />}{["handoff", "pause", "goal"].includes(data.action) && <Area label="Nota" value={data.note || ""} onChange={(note) => patch({ note })} />}{["handoff", "pause"].includes(data.action) && <p className="text-xs text-muted">Detiene este recorrido. Podés retomar desde la conversación.</p>}</div>;
}

function RandomEditor({ data, onChange }: { data: RandomizerData; onChange: (data: RandomizerData) => void }) {
  const total = data.branches.reduce((sum, branch) => sum + branch.weight, 0);
  return <div className="space-y-3">{data.branches.map((branch, index) => <div key={branch.id} className="space-y-2 rounded-xl border border-border p-3"><Text label="Nombre del camino" value={branch.label} onChange={(label) => onChange({ branches: data.branches.map((item, offset) => offset === index ? { ...item, label } : item) })} /><NumberField label="Porcentaje" value={branch.weight} min={1} max={100} onChange={(weight) => onChange({ branches: data.branches.map((item, offset) => offset === index ? { ...item, weight } : item) })} /><button className={`${smallButton} text-error`} onClick={() => onChange({ branches: data.branches.filter((item) => item.id !== branch.id) })}>Quitar camino</button></div>)}<p className={`text-xs ${total === 100 ? "text-success" : "text-warning"}`}>Total: {total}% {total !== 100 && "· Los caminos deben sumar 100%"}</p><button className={smallButton} onClick={() => onChange({ branches: [...data.branches, { id: uid("branch"), label: `Camino ${data.branches.length + 1}`, weight: 10 }] })}>+ Camino</button></div>;
}
