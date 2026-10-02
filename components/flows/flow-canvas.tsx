"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { FlowDefinition } from "@/lib/flows/definition";
import { NODE_CATALOG, nodeSummary, ports, type BuilderNode } from "./model";
import FlowIcon from "./flow-icon";

const WIDTH = 250;
const PORT_TOP = 126;
const PORT_GAP = 28;
export default function FlowCanvas({ definition, selectedId, onSelect, onChange, onCheckpoint, issueNodes, onAdd, editable = true }: { definition: FlowDefinition; selectedId: string | null; onSelect: (id: string | null) => void; onChange: (flow: FlowDefinition, transient?: boolean) => void; onCheckpoint: () => void; issueNodes: Set<string>; onAdd: (type: BuilderNode["type"], position?: { x: number; y: number }) => void; editable?: boolean }) {
  const canvas = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ kind: "pan" | "node"; id?: string; pointerX: number; pointerY: number; x: number; y: number; checkpointed?: boolean } | null>(null);
  const initialDefinition = useRef(definition);
  const [view, setView] = useState(definition.viewport || { x: 30, y: 60, zoom: 0.8 });
  const [connecting, setConnecting] = useState<{ source: string; handle: string } | null>(null);
  useEffect(() => {
    const element = canvas.current;
    const preventPageScroll = (event: WheelEvent) => event.preventDefault();
    element?.addEventListener("wheel", preventPageScroll, { passive: false });
    return () => element?.removeEventListener("wheel", preventPageScroll);
  }, []);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let fitted = false;
    const observer = new ResizeObserver(() => {
      if (fitted || !element.clientWidth) return;
      fitted = true;
      const nodes = initialDefinition.current.nodes;
      if (!nodes.length) return;
      const minX = Math.min(...nodes.map((node) => node.position.x)), maxX = Math.max(...nodes.map((node) => node.position.x + WIDTH));
      const minY = Math.min(...nodes.map((node) => node.position.y)), maxY = Math.max(...nodes.map((node) => node.position.y + PORT_TOP + ports(node).length * PORT_GAP + 20));
      const zoom = Math.min(1, Math.max(0.2, Math.min((element.clientWidth - 70) / (maxX - minX), (element.clientHeight - 120) / (maxY - minY))));
      setView({ x: (element.clientWidth - (maxX - minX) * zoom) / 2 - minX * zoom, y: (element.clientHeight - (maxY - minY) * zoom) / 2 - minY * zoom, zoom });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("[data-flow-node],button,a")) return;
    gesture.current = { kind: "pan", pointerX: event.clientX, pointerY: event.clientY, x: view.x, y: view.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function startDrag(event: PointerEvent, node: BuilderNode) {
    if (!editable) { onSelect(node.id); return; }
    if ((event.target as HTMLElement).closest("button")) return;
    event.stopPropagation(); onSelect(node.id);
    gesture.current = { kind: "node", id: node.id, pointerX: event.clientX, pointerY: event.clientY, x: node.position.x, y: node.position.y };
    canvas.current?.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current) return;
    const dx = event.clientX - current.pointerX, dy = event.clientY - current.pointerY;
    if (current.kind === "pan") setView({ ...view, x: current.x + dx, y: current.y + dy });
    else {
      if (!current.checkpointed && Math.abs(dx) + Math.abs(dy) < 4) return;
      if (!current.checkpointed) { onCheckpoint(); current.checkpointed = true; }
      onChange({ ...definition, nodes: definition.nodes.map((node) => node.id === current.id ? { ...node, position: { x: Math.round(current.x + dx / view.zoom), y: Math.round(current.y + dy / view.zoom) } } : node) }, true);
    }
  }
  function finish() { if (gesture.current?.kind === "pan") onChange({ ...definition, viewport: view }, true); gesture.current = null; }
  function zoom(next: number) {
    const value = Math.min(2, Math.max(0.2, next));
    const rect = canvas.current?.getBoundingClientRect();
    const centerX = (rect?.width || 800) / 2, centerY = (rect?.height || 600) / 2;
    const result = { x: centerX - (centerX - view.x) * value / view.zoom, y: centerY - (centerY - view.y) * value / view.zoom, zoom: value };
    setView(result); onChange({ ...definition, viewport: result }, true);
  }
  function fit() {
    const rect = canvas.current?.getBoundingClientRect();
    if (!rect || !definition.nodes.length) return;
    const minX = Math.min(...definition.nodes.map((node) => node.position.x)), maxX = Math.max(...definition.nodes.map((node) => node.position.x + WIDTH));
    const minY = Math.min(...definition.nodes.map((node) => node.position.y)), maxY = Math.max(...definition.nodes.map((node) => node.position.y + PORT_TOP + ports(node).length * PORT_GAP + 20));
    const next = Math.min(1, Math.max(0.2, Math.min((rect.width - 80) / (maxX - minX), (rect.height - 100) / (maxY - minY))));
    const result = { x: (rect.width - (maxX - minX) * next) / 2 - minX * next, y: (rect.height - (maxY - minY) * next) / 2 - minY * next, zoom: next };
    setView(result); onChange({ ...definition, viewport: result }, true);
  }
  function connect(target: string) {
    if (!editable) return;
    if (!connecting || target === connecting.source || definition.nodes.find((node) => node.id === target)?.type === "start") return;
    onChange({ ...definition, edges: [...definition.edges.filter((edge) => edge.source !== connecting.source || edge.sourceHandle !== connecting.handle), { id: `edge_${crypto.randomUUID().slice(0, 12)}`, source: connecting.source, sourceHandle: connecting.handle, target }] });
    setConnecting(null);
  }
  function focusSelected() {
    const node = definition.nodes.find((item) => item.id === selectedId);
    const rect = canvas.current?.getBoundingClientRect();
    if (!node || !rect) return;
    setView({ x: rect.width / 2 - (node.position.x + WIDTH / 2), y: rect.height / 2 - (node.position.y + (PORT_TOP + ports(node).length * PORT_GAP) / 2), zoom: 1 });
  }
  return <div data-flow-canvas ref={canvas} className="relative min-h-[650px] flex-1 overflow-hidden rounded-xl border border-border bg-[#0d0a11] touch-none" style={{ backgroundImage: "radial-gradient(#382536 1px, transparent 1px)", backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`, backgroundPosition: `${view.x}px ${view.y}px` }} onPointerDown={pointerDown} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onWheel={(event) => { if (event.ctrlKey || event.metaKey) zoom(view.zoom - event.deltaY * 0.001); else { const result = { ...view, x: view.x - event.deltaX, y: view.y - event.deltaY }; setView(result); onChange({ ...definition, viewport: result }, true); } }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const type = event.dataTransfer.getData("application/openreply-node") as BuilderNode["type"]; if (editable && NODE_CATALOG.some((item) => item.type === type && type !== "start")) { const rect = canvas.current!.getBoundingClientRect(); onAdd(type, { x: (event.clientX - rect.left - view.x) / view.zoom, y: (event.clientY - rect.top - view.y) / view.zoom }); } }}>
    <div className="absolute left-3 top-3 z-20 max-w-[80%] rounded-lg border border-border bg-surface/95 px-3 py-2 text-[11px] text-muted">{connecting ? <span className="text-accent">Elegí el paso de destino. <button className="ml-2 underline" onClick={() => setConnecting(null)}>Cancelar</button></span> : "Arrastrá los pasos para ordenar · Arrastrá el fondo para moverte"}</div>
    <div className="absolute bottom-3 left-3 z-20 flex items-center gap-1 rounded-lg border border-border bg-surface p-1"><button aria-label="Alejar" className="h-8 w-8 hover:bg-surface-hover" onClick={() => zoom(view.zoom - 0.1)}>−</button><span className="w-12 text-center text-xs">{Math.round(view.zoom * 100)}%</span><button aria-label="Acercar" className="h-8 w-8 hover:bg-surface-hover" onClick={() => zoom(view.zoom + 0.1)}>+</button><button className="px-2 text-xs hover:text-accent" onClick={fit}>Ver todo</button><button disabled={!selectedId} className="px-2 text-xs hover:text-accent disabled:opacity-30" onClick={focusSelected}>Ver seleccionado</button></div>
    <div className="absolute left-0 top-0" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, transformOrigin: "0 0" }}>
      <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1" aria-label="Conexiones del flujo">
        {definition.edges.map((edge) => {
          const source = definition.nodes.find((node) => node.id === edge.source), target = definition.nodes.find((node) => node.id === edge.target);
          if (!source || !target) return null;
          const index = Math.max(0, ports(source).findIndex((port) => port.id === edge.sourceHandle));
          const x1 = source.position.x + WIDTH, y1 = source.position.y + PORT_TOP + 14 + index * PORT_GAP;
          const x2 = target.position.x, y2 = target.position.y + 30;
          const curve = Math.max(80, Math.abs(x2 - x1) * 0.45);
          const d = `M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`;
          return <g key={edge.id}><path d={d} fill="none" stroke={selectedId === edge.source || selectedId === edge.target ? "#ff9a75" : "#79718c"} strokeWidth="2" /><path d={d} fill="none" stroke="transparent" strokeWidth="16" className="pointer-events-auto cursor-pointer" onClick={() => { onSelect(edge.source); }} /><circle cx={x2} cy={y2} r="4" fill="#ff7a4a" /></g>;
        })}
      </svg>
      {definition.nodes.map((node) => {
        const catalog = NODE_CATALOG.find((item) => item.type === node.type)!;
        const outputs = ports(node);
        return <div key={node.id} data-flow-node role="button" tabIndex={0} aria-label={`Editar ${node.label}`} aria-pressed={selectedId === node.id} onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (connecting) connect(node.id); else onSelect(node.id); } if (event.key === "Escape") setConnecting(null); }} className={`absolute rounded-xl border bg-[#1c1d24] shadow-xl ${selectedId === node.id ? "border-accent ring-2 ring-accent/20" : issueNodes.has(node.id) ? "border-error" : "border-border"} ${connecting && node.id !== connecting.source && node.type !== "start" ? "cursor-crosshair ring-1 ring-accent/40" : ""}`} style={{ left: node.position.x, top: node.position.y, width: WIDTH }} onClick={() => connecting ? connect(node.id) : onSelect(node.id)}>
          {node.type !== "start" && <button aria-label={`Conectar a ${node.label}`} className="absolute -left-2 top-[23px] z-10 h-4 w-4 rounded-full border-2 border-accent bg-background" onClick={(event) => { event.stopPropagation(); if (connecting) connect(node.id); else onSelect(node.id); }} />}
          <div className="flex h-[60px] cursor-grab select-none items-center gap-2 border-b border-border px-4 active:cursor-grabbing" onPointerDown={(event) => startDrag(event, node)}><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-background text-lg" style={{ color: catalog.color }}><FlowIcon name={node.type} size={17} /></span><div className="min-w-0"><p className="text-[10px] uppercase tracking-wide" style={{ color: catalog.color }}>{catalog.title}</p><p className="truncate text-sm font-semibold">{node.label}</p></div>{issueNodes.has(node.id) && <span className="ml-auto text-error" title="Revisar este paso">!</span>}</div>
          <p className="h-[66px] overflow-hidden whitespace-pre-wrap px-4 py-2 text-xs leading-relaxed text-muted">{nodeSummary(node)}</p>
          {outputs.map((port) => <button key={port.id} type="button" disabled={!editable} className={`relative flex h-7 w-full items-center justify-end border-t border-border/50 px-4 text-[11px] hover:bg-surface-hover ${connecting?.source === node.id && connecting.handle === port.id ? "text-accent" : "text-muted"}`} onClick={(event) => { event.stopPropagation(); setConnecting({ source: node.id, handle: port.id }); }}><span className="truncate">{port.label}</span><span className="absolute -right-1.5 h-3 w-3 rounded-full border-2 border-accent bg-background" /></button>)}
        </div>;
      })}
    </div>
  </div>;
}
