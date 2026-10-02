"use client";

import { useEffect, useRef, useState } from "react";
import FlowDialog from "./flow-dialog";
import FlowIcon from "./flow-icon";
import type { FlowButton, FlowDefinition } from "@/lib/flows/definition";
import { clickSimulationLink, respondSimulation, startSimulation, type SimulationEvent } from "@/lib/flows/simulator";

function MediaPreview({ media }: { media: NonNullable<SimulationEvent["media"]> }) {
  if (media.type === "image") {
    // Uploaded and external message URLs are displayed directly in this chat preview.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={media.url} alt={media.name || "Imagen del mensaje"} className="mb-2 max-h-40 rounded-lg" />;
  }
  if (media.type === "audio") return <audio controls src={media.url} className="mb-2 max-w-full" />;
  if (media.type === "video") return <video controls src={media.url} className="mb-2 max-h-48 max-w-full rounded-lg" />;
  return <span className="mr-2">▤ PDF</span>;
}

export default function FlowPreview({ definition, onClose, onSelect }: { definition: FlowDefinition; onClose: () => void; onSelect: (id: string) => void }) {
  const [username, setUsername] = useState("felipe");
  const [comment, setComment] = useState("GUIA");
  const [follows, setFollows] = useState("true");
  const [fields, setFields] = useState("{}");
  const [state, setState] = useState(() => startSimulation(definition));
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [state.events.length]);
  const current = definition.nodes.find((node) => node.id === state.nodeId);
  function reply(value: { text?: string; handle?: string }) { setState(respondSimulation(definition, state, value)); setText(""); }
  function clickButton(event: SimulationEvent, button: FlowButton) {
    if (button.kind === "url") setState((previous) => clickSimulationLink(previous, event.nodeId!, button));
    else reply({ handle: `button.${button.id}` });
  }
  function restart() {
    try {
      const parsed = JSON.parse(fields);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      setState(startSimulation(definition, { ...Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)])), username, comment, follows }));
      setError(""); setText("");
    } catch { setError("Revisá el formato de los campos adicionales. Por ejemplo: {\"interes\":\"curso\"}."); }
  }
  return <FlowDialog onClose={onClose} labelledBy="preview-title" className="flow-preview-dialog">
    <div className="flow-preview-heading"><div><span className="flow-eyebrow">ANTES DE PUBLICAR</span><h2 id="preview-title">Viví el flujo como tu contacto</h2><p>Simulación local · No envía mensajes reales</p></div><button aria-label="Cerrar simulador" className="flow-icon-button" onClick={onClose}><FlowIcon name="close" /></button></div>
    <div className="flow-preview-layout">
      <div className="flow-chat"><div className="flow-chat-header"><span className="flow-chat-avatar"><FlowIcon name="message" size={21} /></span><div><strong>Tu cuenta de Instagram</strong><p>Vista previa de la conversación</p></div><span className="flow-chat-live" /></div>
        <div className="flow-chat-messages" role="log" aria-label="Conversación de prueba" aria-live="polite"><div className="flow-chat-start">Tu contacto comentó “{state.fields.comment || "GUIA"}”</div>
          {state.events.filter((event) => event.kind !== "action").map((event) => <div key={event.id} className={`flow-chat-event is-${event.kind}`}><div className="flow-chat-bubble">{event.media && <MediaPreview media={event.media} />}{event.text}</div>
            {!!event.buttons?.length && <div className="flow-chat-buttons">{event.buttons.map((button) => <button key={button.id} disabled={button.kind === "continue" && (state.finished || state.nodeId !== event.nodeId || state.waiting !== "message")} onClick={() => clickButton(event, button)}>{button.label}{button.kind === "url" && <FlowIcon name="start" size={12} />}</button>)}</div>}
            {event.kind !== "user" && event.nodeId && <button className="flow-chat-edit" onClick={() => onSelect(event.nodeId!)}>Editar este paso <span aria-hidden="true">↗</span></button>}
          </div>)}<div ref={bottom} />
        </div>
        <div className="flow-chat-composer">{state.finished ? <div className="flow-chat-finished"><FlowIcon name={state.events.some((event) => event.kind === "warning") ? "warning" : "check"} size={18} /><p>{state.events.some((event) => event.kind === "warning") ? "La prueba encontró un punto a revisar." : "Completaste el recorrido."}</p><button className="flow-button" onClick={restart}><FlowIcon name="history" size={14} />Volver a probar</button></div> : state.waiting === "delay" ? <div className="flow-chat-finished"><FlowIcon name="delay" size={18} /><p>El flujo está esperando. En la prueba podés adelantar el tiempo.</p><button onClick={() => reply({})} className="flow-button flow-button-primary">Avanzar la espera<FlowIcon name="arrow" size={14} /></button></div> : <>
          {current?.type === "input" && current.data.inputType === "choice" && <div className="flow-chat-buttons mb-3">{current.data.options?.map((option) => <button key={option} onClick={() => reply({ text: option })}>{option}</button>)}</div>}
          <form onSubmit={(event) => { event.preventDefault(); if (text.trim()) reply({ text }); }}><input autoComplete="off" aria-label="Respuesta de prueba" value={text} onChange={(event) => setText(event.target.value)} placeholder={current?.type === "input" && current.data.inputType === "email" ? "Escribí un email de prueba…" : "Escribí una respuesta…"} /><button aria-label="Enviar respuesta de prueba" disabled={!text.trim()}><FlowIcon name="arrow" size={19} /></button></form>
          <p className="flow-chat-hint">{state.waiting === "input" ? "Respondé como lo haría tu contacto." : "Respondé al primer mensaje para continuar."}</p>
          {state.waiting === "input" && <div className="flow-chat-scenarios"><button onClick={() => reply({ handle: "skip" })}>Omitir dato</button><button onClick={() => reply({ handle: "timeout" })}>Simular sin respuesta</button></div>}
        </>}</div>
      </div>
      <aside className="flow-test-contact"><h3>Contacto de prueba</h3><p>Cambiá el perfil para explorar otros caminos del flujo.</p><label>Nombre de usuario<input value={username} onChange={(event) => setUsername(event.target.value)} /></label><label>Comentario inicial<input value={comment} onChange={(event) => setComment(event.target.value)} /></label><label>¿Sigue tu cuenta?<select value={follows} onChange={(event) => setFollows(event.target.value)}><option value="true">Sí, ya me sigue</option><option value="false">No, todavía no</option></select></label>
        <details className="flow-advanced"><summary>Campos adicionales</summary><div><p className="mb-2 text-xs text-muted">Para probar condiciones con otros datos del contacto.</p><label>Datos en formato JSON<textarea rows={3} value={fields} onChange={(event) => setFields(event.target.value)} /></label></div></details>
        {error && <p role="alert" className="text-error">{error}</p>}<button className="flow-button flow-button-wide" onClick={restart}><FlowIcon name="history" size={15} />Aplicar y reiniciar</button>
        <div className="flow-test-results"><h3>Lo que guardó el flujo</h3><dl>{Object.entries(state.fields).filter(([key]) => !["username", "follows", "comment"].includes(key)).map(([key, value]) => <div key={key}><dt>{key === "last_input" ? "Última respuesta" : key === "email" ? "Email" : key === "phone" ? "Teléfono" : key}</dt><dd>{value}</dd></div>)}</dl>{!Object.keys(state.fields).some((key) => !["username", "follows", "comment"].includes(key)) && <p>Los datos aparecerán a medida que respondas.</p>}<div className="flow-test-tags">{state.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></div>
        <details className="flow-advanced"><summary>Recorrido de la prueba · {state.steps} pasos</summary><div className="flow-test-events">{state.events.filter((event) => event.kind === "action" || event.kind === "warning").map((event) => <button key={event.id} disabled={!event.nodeId} onClick={() => event.nodeId && onSelect(event.nodeId)} className={event.kind === "warning" ? "text-warning" : ""}><FlowIcon name={event.kind === "warning" ? "warning" : "check"} size={12} />{event.text}</button>)}</div></details>
        <p className="flow-test-window">Permiso para enviar: {state.windowMinutesRemaining === null ? "esperando la primera respuesta" : `${Math.max(0, Math.round(state.windowMinutesRemaining))} minutos restantes`}</p>
      </aside>
    </div>
  </FlowDialog>;
}