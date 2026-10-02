"use client";

import { useEffect, useRef } from "react";
import type { FlowDefinition } from "@/lib/flows/definition";
import { NODE_CATALOG, nodeSummary, ports } from "./model";
import { orderedNodes, type InsertionPoint } from "./editor-model";
import FlowIcon from "./flow-icon";

export default function FlowJourney({ definition, selectedId, onSelect, onInsert, issueNodes, editable, trigger }: { definition: FlowDefinition; selectedId: string | null; onSelect: (id: string) => void; onInsert: (point: InsertionPoint) => void; issueNodes: Set<string>; editable: boolean; trigger: string }) {
  const { nodes, connected } = orderedNodes(definition);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selectedId || !container.current) return;
    const list = container.current;
    const target = list.querySelector<HTMLElement>(`[data-journey-node="${CSS.escape(selectedId)}"]`);
    if (!target) return;
    const bounds = list.getBoundingClientRect(), card = target.getBoundingClientRect();
    if (card.top < bounds.top || card.bottom > bounds.bottom) list.scrollTo({ top: list.scrollTop + card.top - bounds.top - 20, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, [selectedId]);
  return <div ref={container} className="flow-journey" aria-label="Pasos del flujo"><div className="flow-journey-intro"><span className="flow-eyebrow">TU CONVERSACIÓN, PASO A PASO</span><p>Elegí un paso para editarlo. Cada salida te muestra cómo sigue.</p></div>
    <ol className="flow-step-list">{nodes.map((node, index) => {
      const catalog = NODE_CATALOG.find((item) => item.type === node.type)!;
      const outputs = ports(node);
      return <li key={node.id} data-journey-node={node.id} className={`flow-step ${selectedId === node.id ? "is-selected" : ""} ${issueNodes.has(node.id) ? "has-issue" : ""}`}>
        <span className="flow-step-number">{String(index + 1).padStart(2, "0")}</span>
        <div className="flow-step-card">
          <button className="flow-step-main" onClick={() => onSelect(node.id)} aria-pressed={selectedId === node.id} aria-label={`Editar ${node.label}`}>
            <span className="flow-type-icon" style={{ color: catalog.color, background: `${catalog.color}14` }}><FlowIcon name={node.type} size={21} /></span>
            <span className="flow-step-text"><span className="flow-step-kind">{catalog.title}{!connected.has(node.id) && <span className="text-warning"> · Sin conectar al inicio</span>}</span><strong>{node.label}</strong><span className="flow-step-summary">{node.type === "start" ? trigger : nodeSummary(node)}</span></span>
            {issueNodes.has(node.id) ? <span title="Este paso necesita revisión" className="text-warning"><FlowIcon name="warning" size={17} /></span> : <FlowIcon name="arrow" size={17} className="flow-step-arrow" />}
          </button>
          {!!outputs.length && <div className="flow-step-routes">{outputs.map((port) => {
            const edge = definition.edges.find((item) => item.source === node.id && item.sourceHandle === port.id);
            const target = nodes.find((item) => item.id === edge?.target);
            const optional = node.type === "action" && port.id === "error" && !["webhook", "start_flow"].includes(node.data.action);
            if (optional && !target && selectedId !== node.id) return null;
            return <div className="flow-route" key={port.id}><span className="flow-route-label">{port.label}</span><FlowIcon name="arrow" size={12} />{target ? <button className="flow-route-target" onClick={() => onSelect(target.id)} title={`Editar ${target.label}`}>{target.label}</button> : <button disabled={!editable} className={`flow-route-target ${optional ? "" : "text-warning"}`} onClick={() => onInsert({ source: node.id, handle: port.id })}>{optional ? "Opcional" : "Elegir próximo paso"}</button>}<button disabled={!editable} className="flow-route-add" aria-label={`Agregar paso: ${node.label} · ${port.label}`} title={target ? `Insertar antes de ${target.label}` : "Agregar y conectar un paso"} onClick={() => onInsert({ source: node.id, handle: port.id })}><FlowIcon name="plus" size={14} /></button></div>;
          })}</div>}
        </div>
      </li>;
    })}</ol>
    <div className="flow-journey-end"><FlowIcon name="check" size={14} /><span>{nodes.length} pasos · Podés probar el recorrido en cualquier momento</span></div>
  </div>;
}
