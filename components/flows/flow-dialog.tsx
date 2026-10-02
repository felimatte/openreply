"use client";

import { useEffect, useRef, type ReactNode } from "react";

export default function FlowDialog({ children, onClose, labelledBy, className = "" }: { children: ReactNode; onClose: () => void; labelledBy: string; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const active = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => { dialog?.close(); if (active?.isConnected) active.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={ref} aria-labelledby={labelledBy} className={`flow-dialog ${className}`} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>{children}</dialog>;
}
