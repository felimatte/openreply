"use client";

import { useState } from "react";
import FlowDialog from "./flow-dialog";
import FlowIcon from "./flow-icon";
import { NODE_CATALOG, type NodeKind } from "./model";

export default function StepPicker({ onClose, onAdd, context, replacing }: { onClose: () => void; onAdd: (type: NodeKind) => void; context?: string; replacing?: boolean }) {
  const [search, setSearch] = useState("");
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const items = NODE_CATALOG.filter((item) => item.type !== "start" && normalize(`${item.title} ${item.description}`).includes(normalize(search)));
  return <FlowDialog onClose={onClose} labelledBy="step-picker-title" className="flow-picker">
    <div className="flow-modal-heading"><div><p className="flow-eyebrow">CONSTRUÍ TU RECORRIDO</p><h2 id="step-picker-title">¿Qué querés que pase?</h2><p>{context ? `Después de ${context}` : "Elegí el próximo paso de tu conversación."}</p></div><button className="flow-icon-button" aria-label="Cerrar selector de pasos" onClick={onClose}><FlowIcon name="close" /></button></div>
    <label className="flow-search"><FlowIcon name="search" /><input data-autofocus aria-label="Buscar un paso" placeholder="Buscar mensaje, email, espera…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    <div className="flow-picker-grid">{items.map((item) => <button key={item.type} className="flow-picker-item" onClick={() => onAdd(item.type)}><span className="flow-type-icon" style={{ color: item.color, background: `${item.color}15` }}><FlowIcon name={item.type} size={22} /></span><span><strong>{item.title}</strong><small>{item.description}</small>{item.type === "end" && replacing && <small className="text-warning">El recorrido terminará aquí.</small>}</span><FlowIcon name="plus" className="flow-picker-plus" /></button>)}</div>
    {!items.length && <div className="flow-empty"><FlowIcon name="search" size={28} /><p>No encontramos ese paso.</p><button className="flow-button" onClick={() => setSearch("")}>Ver todos los pasos</button></div>}
    <div className="flow-modal-footer">{context ? "El paso se conecta automáticamente. Después podés personalizarlo." : "Podés conectar este paso desde sus opciones."}</div>
  </FlowDialog>;
}
