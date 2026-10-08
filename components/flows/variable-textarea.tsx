"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { filterMessageVariables, getSlashQuery, insertMessageVariable, type MessageVariable, type SlashQuery } from "@/lib/flows/message-variables";
import "./variable-textarea.css";

export default function VariableTextarea({ id, label, value, onChange, onBlur, className, invalid, describedBy, variables }: {
  id: string; label: string; value: string; onChange: (value: string) => void; onBlur?: () => void;
  className: string; invalid?: boolean; describedBy?: string; variables: readonly MessageVariable[];
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [cursor, setCursor] = useState({ start: 0, end: 0 });
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [manualRange, setManualRange] = useState<SlashQuery | null>(null);
  const [active, setActive] = useState(0);
  const query = focused && !dismissed ? manualRange ?? getSlashQuery(value, cursor.start, cursor.end) : null;
  const options = query ? filterMessageVariables(variables, query.query) : [];
  const index = Math.min(active, Math.max(0, options.length - 1));
  const listId = `${id}-variables`;
  const hintId = `${id}-hint`;

  useLayoutEffect(() => {
    if (pendingCaret.current === null || !textarea.current) return;
    const caret = pendingCaret.current;
    pendingCaret.current = null;
    textarea.current.focus();
    textarea.current.setSelectionRange(caret, caret);
  }, [value]);
  useEffect(() => {
    menu.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [index, query?.query]);

  function choose(variable: MessageVariable) {
    if (!query) return;
    const next = insertMessageVariable(value, query, variable.key);
    pendingCaret.current = next.caret;
    setCursor({ start: next.caret, end: next.caret });
    setDismissed(true);
    setManualRange(null);
    onChange(next.value);
  }
  function openPicker() {
    const start = textarea.current?.selectionStart ?? value.length;
    const end = textarea.current?.selectionEnd ?? start;
    setCursor({ start, end });
    setManualRange(getSlashQuery(value, start, end) ?? { start, end, query: "" });
    setActive(0);
    setDismissed(false);
    setFocused(true);
    textarea.current?.focus();
  }

  return <div className="flow-variable-field">
    <textarea ref={textarea} id={id} aria-label={label} className={className} rows={3} value={value}
      role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={!!query}
      aria-controls={query ? listId : undefined} aria-activedescendant={query && options.length ? `${listId}-${index}` : undefined}
      aria-invalid={invalid || undefined} aria-describedby={[describedBy, hintId].filter(Boolean).join(" ")}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); setManualRange(null); onBlur?.(); }}
      onSelect={(event) => {
        const { selectionStart: start, selectionEnd: end } = event.currentTarget;
        if (start !== cursor.start || end !== cursor.end) { setCursor({ start, end }); setManualRange(null); }
      }}
      onChange={(event) => {
        setCursor({ start: event.target.selectionStart, end: event.target.selectionEnd });
        setManualRange(null); setDismissed(false); setActive(0); onChange(event.target.value);
      }}
      onKeyDown={(event) => {
        if (!query || event.nativeEvent.isComposing) return;
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDismissed(true); setManualRange(null); }
        else if (options.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          event.preventDefault(); event.stopPropagation();
          setActive((index + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
        } else if (options.length && (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey))) {
          event.preventDefault(); event.stopPropagation(); choose(options[index]);
        }
      }}
    />
    <div className="flow-variable-tools"><span id={hintId}>Escribí / para personalizar</span><button type="button" aria-label={`Insertar dato en ${label}`} onMouseDown={(event) => event.preventDefault()} onClick={openPicker}>/ Insertar dato</button></div>
    {query && <div className="flow-variable-picker">
      <div className="flow-variable-heading"><span>Datos para este mensaje</span><small>↑ ↓ · Enter</small></div>
      <div ref={menu} role="listbox" id={listId} aria-label={`Datos para ${label}`} className="flow-variable-options">
        {options.map((variable, offset) => <button type="button" role="option" tabIndex={-1} aria-selected={offset === index} id={`${listId}-${offset}`} key={variable.key}
          onMouseDown={(event) => event.preventDefault()} onClick={() => choose(variable)} onMouseEnter={() => setActive(offset)}>
          <span className="flow-variable-title"><strong>{variable.label}</strong><small>{variable.source === "instagram" ? "Instagram" : variable.source === "flow" ? "Este flujo" : "Contacto"}</small></span>
          <span className="flow-variable-description">{variable.description}</span>
        </button>)}
      </div>
      {!options.length && <p role="status" className="flow-variable-empty">No hay datos con ese nombre. Podés agregar un paso “Pedir un dato” para guardarlo.</p>}
      <p className="flow-variable-footnote">Se reemplazan por los datos de cada persona al enviar.</p>
    </div>}
  </div>;
}
