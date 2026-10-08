"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { FlowDefinition } from "@/lib/flows/definition";
import { NODE_CATALOG, nodeSummary, ports, uid, type BuilderNode } from "./model";
import { canConnectPort, connectPort, disconnectPort } from "./canvas-model";
import { findOpeningNodes, type InsertionPoint } from "./editor-model";
import FlowIcon from "./flow-icon";
import "./flow-canvas.css";

type Point = { x: number; y: number };
type View = Point & { zoom: number };
type Wire = InsertionPoint & { point: Point; target?: string };
type Gesture = { kind: "pan" | "node" | "wire"; id?: string; pointerId: number; start: Point; origin: Point; moved: boolean };
const WIDTH = 260, HEADER = 56, BODY = 112, PORT = 36;
const height = (node: BuilderNode) => HEADER + BODY + ports(node).length * PORT;
const output = (node: BuilderNode, handle: string): Point => ({ x: node.position.x + WIDTH, y: node.position.y + HEADER + BODY + PORT / 2 + Math.max(0, ports(node).findIndex((port) => port.id === handle)) * PORT });
const input = (node: BuilderNode): Point => ({ x: node.position.x, y: node.position.y + HEADER / 2 });
function curve(a: Point, b: Point) { const bend = Math.max(60, Math.abs(b.x - a.x) * .45); return `M${a.x},${a.y} C${a.x + bend},${a.y} ${b.x - bend},${b.y} ${b.x},${b.y}`; }

export default function FlowCanvas({ definition, selectedId, onSelect, onChange, onCheckpoint, issueNodes, onRequestAdd, editable = true, trigger }: {
  definition: FlowDefinition; selectedId: string | null; onSelect: (id: string | null) => void;
  onChange: (flow: FlowDefinition, transient?: boolean) => void; onCheckpoint: () => void; issueNodes: Set<string>;
  onRequestAdd: (at?: InsertionPoint, position?: Point) => void; editable?: boolean; trigger: string;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [view, setView] = useState<View>(definition.viewport || { x: 40, y: 50, zoom: .8 });
  const [wire, setWire] = useState<Wire | null>(null);
  const [edgeId, setEdgeId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const activeEdge = definition.edges.find((edge) => edge.id === edgeId);
  const byId = new Map(definition.nodes.map((node) => [node.id, node]));
  const openingNodes = findOpeningNodes(definition);
  const wireSource = wire && byId.get(wire.source);

  useEffect(() => {
    const element = canvas.current;
    const preventPageScroll = (event: WheelEvent) => event.preventDefault();
    element?.addEventListener("wheel", preventPageScroll, { passive: false });
    return () => element?.removeEventListener("wheel", preventPageScroll);
  }, []);

  function world(clientX: number, clientY: number): Point {
    const rect = canvas.current!.getBoundingClientRect();
    return { x: (clientX - rect.left - view.x) / view.zoom, y: (clientY - rect.top - view.y) / view.zoom };
  }
  function navigate(next: View) { setView(next); onChange({ ...definition, viewport: next }, true); }
  function zoom(value: number, anchor?: Point) {
    const rect = canvas.current!.getBoundingClientRect();
    const center = anchor || { x: rect.width / 2, y: rect.height / 2 };
    const next = Math.min(2, Math.max(.2, value));
    navigate({ x: center.x - (center.x - view.x) * next / view.zoom, y: center.y - (center.y - view.y) * next / view.zoom, zoom: next });
  }
  function fit() {
    const rect = canvas.current!.getBoundingClientRect();
    if (!definition.nodes.length) return;
    const left = Math.min(...definition.nodes.map((node) => node.position.x)), top = Math.min(...definition.nodes.map((node) => node.position.y));
    const right = Math.max(...definition.nodes.map((node) => node.position.x + WIDTH)), bottom = Math.max(...definition.nodes.map((node) => node.position.y + height(node)));
    const available = rect.width - (selectedId && rect.width > 899 ? 370 : 0);
    const next = Math.min(1, Math.max(.2, Math.min((available - 100) / (right - left), (rect.height - 160) / (bottom - top))));
    navigate({ x: (available - (right - left) * next) / 2 - left * next, y: (rect.height - (bottom - top) * next) / 2 - top * next, zoom: next });
  }
  function focusNode(id: string) {
    const node = byId.get(id), rect = canvas.current!.getBoundingClientRect();
    if (!node) return;
    const available = rect.width - (selectedId && rect.width > 899 ? 370 : 0);
    navigate({ x: available / 2 - (node.position.x + WIDTH / 2) * view.zoom, y: rect.height / 2 - (node.position.y + height(node) / 2) * view.zoom, zoom: view.zoom });
  }
  function capture(event: PointerEvent, kind: Gesture["kind"], origin: Point, id?: string) {
    event.preventDefault(); event.stopPropagation();
    gesture.current = { kind, id, pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin, moved: false };
    canvas.current?.setPointerCapture(event.pointerId);
    canvas.current?.focus({ preventScroll: true });
  }
  function beginNode(event: PointerEvent, node: BuilderNode) {
    if (event.button !== 0 || (event.target as Element).closest("button")) return;
    if (wire) { event.stopPropagation(); finishConnection(node.id); return; }
    setEdgeId(null);
    capture(event, "node", node.position, node.id);
  }
  function beginWire(event: PointerEvent, node: BuilderNode, handle: string) {
    if (!editable || event.button !== 0) return;
    const point = output(node, handle);
    setWire({ source: node.id, handle, point: { x: point.x + 70, y: point.y } });
    setEdgeId(null); onSelect(null);
    capture(event, "wire", point);
  }
  function targetAt(x: number, y: number) { return document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-flow-node]")?.dataset.flowNode; }
  function finishConnection(target: string) {
    if (!wire || !editable || !canConnectPort(definition, wire.source, wire.handle, target)) return;
    const next = connectPort(definition, wire.source, wire.handle, target, uid("edge"));
    if (next !== definition) onChange(next);
    setWire(null); setAnnouncement(`Conectado a ${byId.get(target)?.label}.`);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current) { if (wire) setWire({ ...wire, point: world(event.clientX, event.clientY), target: targetAt(event.clientX, event.clientY) }); return; }
    if (current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.start.x, dy = event.clientY - current.start.y;
    if (!current.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    if (!current.moved && current.kind === "node" && editable) onCheckpoint();
    current.moved = true; setDragging(true);
    if (current.kind === "pan") setView({ ...view, x: current.origin.x + dx, y: current.origin.y + dy });
    if (current.kind === "node" && editable) onChange({ ...definition, nodes: definition.nodes.map((node) => node.id === current.id ? { ...node, position: { x: Math.round(current.origin.x + dx / view.zoom), y: Math.round(current.origin.y + dy / view.zoom) } } : node) }, true);
    if (current.kind === "wire" && wire) setWire({ ...wire, point: world(event.clientX, event.clientY), target: targetAt(event.clientX, event.clientY) });
  }
  function finish(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    gesture.current = null; setDragging(false);
    if (canvas.current?.hasPointerCapture(event.pointerId)) canvas.current.releasePointerCapture(event.pointerId);
    if (cancelled) { setWire(null); return; }
    if (current.kind === "pan") {
      onChange({ ...definition, viewport: view }, true);
      if (!current.moved) { onSelect(null); setWire(null); setEdgeId(null); }
    }
    if (current.kind === "node" && !current.moved && current.id) onSelect(current.id);
    if (current.kind === "node" && current.moved) setAnnouncement("Caja movida. Sus conexiones se conservaron.");
    if (current.kind === "wire" && current.moved && wire) {
      const target = targetAt(event.clientX, event.clientY);
      if (target) { finishConnection(target); setWire(null); }
      else {
        const rect = canvas.current!.getBoundingClientRect();
        if (event.clientX > rect.left && event.clientX < rect.right && event.clientY > rect.top && event.clientY < rect.bottom && document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-flow-canvas]")) onRequestAdd({ source: wire.source, handle: wire.handle }, world(event.clientX, event.clientY));
        setWire(null);
      }
    }
  }
  function addAfter(at: InsertionPoint) {
    const source = byId.get(at.source)!;
    onRequestAdd(at, { x: source.position.x + WIDTH + 100, y: source.position.y + height(source) + 50 });
  }

  return <div ref={canvas} data-flow-canvas className={`flow-canvas ${dragging ? "is-dragging" : ""} ${wire ? "is-connecting" : ""}`} tabIndex={0} aria-label="Lienzo del flujo. Arrastrá las cajas para moverlas y sus conectores para unirlas."
    style={{ backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
    onPointerDown={(event) => { if (event.button === 0 && !(event.target as Element).closest("[data-flow-node],button,a,[data-flow-edge],[data-canvas-controls]")) capture(event, "pan", view); }}
    onPointerMove={move} onPointerUp={(event) => finish(event)} onPointerCancel={(event) => finish(event, true)}
    onDoubleClick={(event) => { if (editable && !(event.target as Element).closest("[data-flow-node],button,[data-flow-edge],[data-canvas-controls]")) onRequestAdd(undefined, world(event.clientX, event.clientY)); }}
    onKeyDown={(event) => { if ((event.target as Element).closest("button")) return; if (event.key === "Escape") { event.stopPropagation(); setWire(null); setEdgeId(null); onSelect(null); } if (editable && activeEdge && (event.key === "Delete" || event.key === "Backspace")) { event.preventDefault(); onChange(disconnectPort(definition, activeEdge.source, activeEdge.sourceHandle)); setEdgeId(null); } }}
    onWheel={(event) => { const rect = canvas.current!.getBoundingClientRect(); if (event.ctrlKey || event.metaKey) zoom(view.zoom * Math.exp(-event.deltaY * .002), { x: event.clientX - rect.left, y: event.clientY - rect.top }); else navigate({ ...view, x: view.x - event.deltaX, y: view.y - event.deltaY }); }}>
    <div className="flow-canvas-hint" data-canvas-controls>{wire ? <><span className="flow-connection-dot" />Arrastrá hasta otra caja o soltá en un espacio libre para agregar una.<button onClick={() => setWire(null)}>Cancelar</button></> : <><FlowIcon name="map" size={15} /><span>Mové las cajas · Uní los puntos · Doble clic para agregar</span></>}</div>
    {activeEdge && !wire && <div className="flow-edge-tools" data-canvas-controls role="group" aria-label="Editar conexión"><span>{byId.get(activeEdge.source)?.label} <FlowIcon name="arrow" size={12} /> {byId.get(activeEdge.target)?.label}</span><button onClick={() => { const source = byId.get(activeEdge.source)!; setWire({ source: source.id, handle: activeEdge.sourceHandle, point: input(byId.get(activeEdge.target)!) }); setEdgeId(null); }}>Cambiar destino</button><button onClick={() => addAfter({ source: activeEdge.source, handle: activeEdge.sourceHandle })}><FlowIcon name="plus" size={14} />Insertar caja</button><button aria-label="Eliminar conexión" title="Eliminar conexión" onClick={() => { onChange(disconnectPort(definition, activeEdge.source, activeEdge.sourceHandle)); setEdgeId(null); }}><FlowIcon name="trash" size={16} /></button><button aria-label="Cerrar opciones de conexión" onClick={() => setEdgeId(null)}><FlowIcon name="close" size={15} /></button></div>}
    <div className="flow-canvas-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
      <svg className="flow-canvas-lines" width="1" height="1" aria-label="Conexiones del flujo">
        <defs><marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#878b9c" /></marker></defs>
        {definition.edges.map((edge) => {
          const source = byId.get(edge.source), target = byId.get(edge.target);
          if (!source || !target) return null;
          const path = curve(output(source, edge.sourceHandle), input(target));
          return <g key={edge.id} data-flow-edge={edge.id} className={`flow-canvas-edge ${edge.id === edgeId || selectedId === edge.source || selectedId === edge.target ? "is-active" : ""} ${wire?.source === edge.source && wire.handle === edge.sourceHandle ? "is-replacing" : ""}`}><path d={path} className="flow-edge-line" markerEnd="url(#flow-arrow)" /><path d={path} className="flow-edge-hit" role="button" tabIndex={editable ? 0 : -1} aria-label={`Conexión de ${source.label}, ${ports(source, openingNodes.has(source.id)).find((port) => port.id === edge.sourceHandle)?.label}, a ${target.label}`} onClick={(event) => { event.stopPropagation(); if (editable) { setEdgeId(edge.id); setWire(null); onSelect(null); } }} onKeyDown={(event) => { if (editable && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setEdgeId(edge.id); onSelect(null); } }} /></g>;
        })}
        {wire && wireSource && <path className="flow-wire-preview" d={curve(output(wireSource, wire.handle), wire.target && canConnectPort(definition, wire.source, wire.handle, wire.target) ? input(byId.get(wire.target)!) : wire.point)} />}
      </svg>
      {definition.nodes.map((node) => {
        const catalog = NODE_CATALOG.find((item) => item.type === node.type)!;
        const validTarget = wire && canConnectPort(definition, wire.source, wire.handle, node.id);
        return <div key={node.id} data-flow-node={node.id} role="button" tabIndex={0} aria-label={`Editar ${node.label}`} aria-pressed={selectedId === node.id}
          className={`flow-box ${selectedId === node.id ? "is-selected" : ""} ${issueNodes.has(node.id) ? "has-issue" : ""} ${validTarget ? "is-target" : ""} ${validTarget && wire?.target === node.id ? "is-hover-target" : ""}`}
          style={{ left: node.position.x, top: node.position.y, width: WIDTH, "--node-color": catalog.color } as CSSProperties} onPointerDown={(event) => beginNode(event, node)}
          onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (wire) finishConnection(node.id); else onSelect(node.id); } if (editable && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); const step = event.shiftKey ? 40 : 10; onChange({ ...definition, nodes: definition.nodes.map((item) => item.id === node.id ? { ...item, position: { x: item.position.x + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0), y: item.position.y + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0) } } : item) }); } }}>
          {node.type !== "start" && <button className="flow-input-port" aria-label={`Conectar a ${node.label}`} title="Entrada de esta caja" onClick={(event) => { event.stopPropagation(); if (wire) finishConnection(node.id); else onSelect(node.id); }} />}
          <div className="flow-box-header"><span className="flow-box-icon"><FlowIcon name={node.type} size={19} /></span><div><small>{catalog.title}</small><strong>{node.label}</strong></div>{issueNodes.has(node.id) ? <span title="Revisar este paso" className="flow-box-warning"><FlowIcon name="warning" size={16} /></span> : <span className="flow-box-grip" aria-hidden="true">⠿</span>}</div>
          <div className={`flow-box-preview flow-box-preview-${node.type}`}>
            {node.type === "start" ? <><span className="flow-box-badge">CUANDO ALGUIEN COMENTA</span><p>{trigger}</p></> : node.type === "message" ? <><p className="flow-box-bubble">{node.data.blocks[0]?.type === "text" ? node.data.blocks[0].text : nodeSummary(node)}</p><small>{openingNodes.has(node.id) ? node.data.buttons.some((button) => button.kind === "continue") ? "Primer DM · Espera un clic o respuesta" : "Primer DM · Espera una respuesta" : node.data.blocks.length > 1 ? `${node.data.blocks.length} contenidos` : "Instagram Direct"}{node.data.buttons.some((button) => button.kind === "url") ? ` · ${node.data.buttons.find((button) => button.kind === "url")?.label} ↗` : ""}</small></> : node.type === "input" ? <><p className="flow-box-bubble">{node.data.prompt}</p><small>Guardar respuesta en <b>{node.data.fieldKey}</b></small></> : <><FlowIcon name={node.type} size={22} /><p>{nodeSummary(node)}</p></>}
          </div>
          {ports(node, openingNodes.has(node.id)).map((port) => {
            const connected = definition.edges.some((edge) => edge.source === node.id && edge.sourceHandle === port.id);
            return <div key={port.id} className={`flow-box-output ${connected ? "is-connected" : ""}`}><span>{port.label}</span><button className="flow-port-add" disabled={!editable} aria-label={`Agregar caja en ${node.label}: ${port.label}`} title="Agregar una caja conectada" onClick={(event) => { event.stopPropagation(); addAfter({ source: node.id, handle: port.id }); }}><FlowIcon name="plus" size={13} /></button><button className="flow-output-port" disabled={!editable} aria-label={`Conectar desde ${node.label}: ${port.label}`} title="Arrastrá para conectar o cambiar el destino" onPointerDown={(event) => beginWire(event, node, port.id)} onClick={(event) => { event.stopPropagation(); if (event.detail === 0) { const point = output(node, port.id); setWire({ source: node.id, handle: port.id, point: { x: point.x + 80, y: point.y } }); setEdgeId(null); onSelect(null); } }} /></div>;
          })}
        </div>;
      })}
    </div>
    <div className="flow-canvas-controls" data-canvas-controls><button aria-label="Alejar" onClick={() => zoom(view.zoom - .1)}>−</button><button className="flow-zoom-value" aria-label="Zoom al 100%" onClick={() => zoom(1)}>{Math.round(view.zoom * 100)}%</button><button aria-label="Acercar" onClick={() => zoom(view.zoom + .1)}>+</button><span /><button onClick={fit} title="Ver todas las cajas"><FlowIcon name="expand" size={15} />Ver todo</button><button onClick={() => focusNode(selectedId || definition.entryNodeId)}><FlowIcon name="start" size={14} />{selectedId ? "Ir al paso" : "Ir al inicio"}</button></div>
    {editable && <button className="flow-canvas-add" data-canvas-controls onClick={() => { const rect = canvas.current!.getBoundingClientRect(); onRequestAdd(undefined, world(rect.left + rect.width / 2 - WIDTH * view.zoom / 2, rect.top + rect.height / 2 - 70)); }}><FlowIcon name="plus" size={19} />Nueva caja</button>}
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  </div>;
}
