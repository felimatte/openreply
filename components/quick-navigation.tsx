"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AppIcon from "@/components/app-icon";
import { workspaceHref, workspaceNavigation } from "@/components/workspace-navigation";
import { useI18n } from "@/lib/i18n/provider";

export default function QuickNavigation({ open, onClose, demo = false }: { open: boolean; onClose: () => void; demo?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const actions = [
    { label: t("New Campaign"), href: demo ? "/demo/flow" : "/campaigns/new", icon: "plus" as const },
    ...workspaceNavigation.map(item => ({ ...item, label: t(item.label), href: workspaceHref(item.href, demo) })),
  ].filter(item => `${item.label} ${item.href}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const activeIndex = Math.min(selected, Math.max(actions.length - 1, 0));

  useEffect(() => {
    const element = dialog.current;
    if (open) { element?.showModal(); input.current?.focus(); }
    else element?.close();
    return () => element?.close();
  }, [open]);

  function navigate(href: string) { onClose(); router.push(href); }

  return <dialog ref={dialog} className="quick-navigation" aria-label={t("Quick navigation")} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    <div className="flex items-center gap-3 border-b border-border px-5 py-4">
      <AppIcon name="search" className="size-5 shrink-0 text-muted" />
      <input ref={input} value={query} onChange={event => { setQuery(event.target.value); setSelected(0); }} placeholder={t("Search pages and actions")} aria-label={t("Search pages and actions")} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls="navigation-results" aria-activedescendant={actions.length ? `navigation-option-${activeIndex}` : undefined} className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none focus-visible:outline-none" onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); const next = (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + actions.length) % (actions.length || 1); setSelected(next); document.getElementById(`navigation-option-${next}`)?.scrollIntoView({ block: "nearest" }); }
        if (event.key === "Enter" && actions[activeIndex]) { event.preventDefault(); navigate(actions[activeIndex].href); }
      }} />
      <button type="button" aria-label={t("Close")} onClick={onClose} className="rounded p-1.5 text-muted hover:bg-surface-hover"><AppIcon name="close" className="size-4" /></button>
    </div>
    <div id="navigation-results" role="listbox" aria-label={t("Navigate")} className="min-h-0 max-h-[45dvh] flex-1 overflow-y-auto p-2">
      {actions.length ? actions.map((item, index) => <button type="button" key={item.href} id={`navigation-option-${index}`} role="option" aria-selected={index === activeIndex} tabIndex={-1} onMouseMove={() => setSelected(index)} onClick={() => navigate(item.href)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm ${index === activeIndex ? "bg-surface-hover text-foreground" : "text-muted"}`}><AppIcon name={item.icon} /><span>{item.label}</span><AppIcon name="arrow" className="ml-auto size-4 text-muted" /></button>) : <p className="px-4 py-10 text-center text-sm text-muted">{t("No pages found. Try another search.")}</p>}
    </div>
    <div className="flex items-center gap-4 border-t border-border bg-background px-5 py-3 text-[11px] text-muted"><span><kbd className="keyboard-hint">↑↓</kbd> {t("Navigate")}</span><span><kbd className="keyboard-hint">↵</kbd> {t("Open")}</span><span className="ml-auto"><kbd className="keyboard-hint">esc</kbd> {t("Close")}</span></div>
  </dialog>;
}
