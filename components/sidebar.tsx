"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import LanguageSwitcher from "@/components/language-switcher";
import AppIcon from "@/components/app-icon";
import { workspaceHref, workspaceNavigation } from "@/components/workspace-navigation";
import { useI18n } from "@/lib/i18n/provider";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onSearch: () => void;
  workspaceName: string;
  profileImage: string | null;
  avatarEditable: boolean;
}

export default function Sidebar({ isOpen, onClose, onSearch, workspaceName, profileImage: initialProfileImage, avatarEditable }: SidebarProps) {
  const { t } = useI18n();
  const pathname = usePathname();
  const drawer = useRef<HTMLElement>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const [profileImage, setProfileImage] = useState(initialProfileImage);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const isDemo = pathname.startsWith("/demo");

  useEffect(() => {
    if (!isOpen) return;
    const activeElement = document.activeElement as HTMLElement | null;
    const previousFocus = activeElement && activeElement !== document.body
      ? activeElement : document.querySelector<HTMLElement>('button[aria-controls="workspace-navigation"]');
    const element = drawer.current;
    const focusFrame = requestAnimationFrame(() => element?.querySelector<HTMLElement>('a[aria-current="page"], button, a')?.focus());
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab" || !element) return;
      const focusable = Array.from(element.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), select:not(:disabled), input:not(:disabled):not([type="file"])')).filter(item => item.tabIndex >= 0 && item.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!element.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", handleKey);
    return () => { cancelAnimationFrame(focusFrame); document.removeEventListener("keydown", handleKey); previousFocus?.focus(); };
  }, [isOpen, onClose]);

  async function uploadAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setAvatarError("");
    if (!file.type.startsWith("image/")) { setAvatarError(t("Choose an image file to use as your profile photo.")); return; }
    if (file.size > 15 * 1024 * 1024) { setAvatarError(t("Choose an image under 15 MB.")); return; }
    setAvatarBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      const crop = Math.min(bitmap.width, bitmap.height);
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 512;
      const context = canvas.getContext("2d");
      if (!context) throw new Error(t("Could not save your profile photo."));
      context.fillStyle = "#f7f8fa";
      context.fillRect(0, 0, 512, 512);
      context.drawImage(bitmap, (bitmap.width - crop) / 2, (bitmap.height - crop) / 2, crop, crop, 0, 0, 512, 512);
      bitmap.close();
      let image = canvas.toDataURL("image/jpeg", 0.82);
      if (image.length > 650_000) image = canvas.toDataURL("image/jpeg", 0.65);
      const response = await fetch("/api/profile/avatar", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image }) });
      const result = (await response.json()) as { error?: string; image?: string };
      if (!response.ok || !result.image) throw new Error(result.error ?? t("Could not save your profile photo."));
      setProfileImage(result.image);
    } catch (error) { setAvatarError(error instanceof Error ? error.message : t("Could not save your profile photo.")); }
    finally { setAvatarBusy(false); }
  }

  function navLink(item: typeof workspaceNavigation[number]) {
    const active = pathname === item.href || pathname.startsWith(item.href + "/") || (item.href === "/dashboard" && pathname === "/demo") || (item.href === "/campaigns" && pathname.startsWith("/automations"));
    return <Link key={item.href} href={workspaceHref(item.href, isDemo)} onClick={onClose} title={isDemo && item.href !== "/dashboard" ? t("Sign in to open this section") : undefined} aria-current={active ? "page" : undefined} className="nav-link"><AppIcon name={item.icon} /><span>{t(item.label)}</span></Link>;
  }

  return <>
    {isOpen && <button type="button" className="fixed inset-0 z-40 bg-slate-950/25 backdrop-blur-[2px] lg:hidden" onClick={onClose} aria-label={t("Close navigation")} tabIndex={-1} />}
    <aside ref={drawer} id="workspace-navigation" aria-label={t("Workspace")} role={isOpen ? "dialog" : undefined} aria-modal={isOpen ? true : undefined} className={`brand-sidebar fixed top-0 left-0 z-50 flex h-dvh w-[236px] max-w-[85vw] shrink-0 flex-col border-r border-border transition-transform duration-200 lg:static lg:z-auto lg:h-full lg:translate-x-0 lg:visible ${isOpen ? "translate-x-0 visible" : "-translate-x-full invisible"}`}>
      <div className="px-5 pb-5 pt-7" style={{ paddingTop: "calc(1.75rem + env(safe-area-inset-top))" }}>
        <div className="flex items-center justify-between">
          <Link href={isDemo ? "/demo" : "/dashboard"} onClick={onClose} className="flex items-center gap-2.5 text-[17px] font-semibold tracking-[-0.6px]"><span className="flex size-8 items-center justify-center rounded-[10px] bg-accent text-white"><AppIcon name="inbox" className="size-[19px]" /></span>OpenReply<span className="text-muted">.</span></Link>
          <button type="button" onClick={onClose} aria-label={t("Close navigation")} className="rounded-lg p-2 text-muted hover:bg-surface-hover lg:hidden"><AppIcon name="close" /></button>
        </div>
        <button type="button" onClick={() => { onClose(); onSearch(); }} className="mt-7 flex w-full items-center gap-2 rounded-lg border border-border bg-white px-3 py-2.5 text-xs text-muted hover:border-border-hover" aria-label={t("Quick navigation")}><AppIcon name="search" className="size-3.5" /><span>{t("Search")}</span><kbd className="keyboard-hint ml-auto">Ctrl / ⌘ K</kbd></button>
      </div>
      <nav aria-label={t("Quick navigation")} className="flex-1 space-y-7 overflow-y-auto px-3 pb-4">
        <div><p className="nav-section-label mb-2">{t("Workspace")}</p><div className="space-y-1">{workspaceNavigation.filter(item => item.section === "workspace").map(navLink)}</div></div>
        <div><p className="nav-section-label mb-2">{t("Insights")}</p><div className="space-y-1">{workspaceNavigation.filter(item => item.section === "insights").map(navLink)}</div></div>
      </nav>
      <div className="space-y-1 px-3 pb-4">{workspaceNavigation.filter(item => item.section === "manage").map(navLink)}</div>
      <div className="border-t border-border p-4">
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={avatarEditable ? () => avatarInput.current?.click() : undefined} disabled={!avatarEditable || avatarBusy} aria-label={t("Change profile photo")} title={t("Change profile photo")} className="brand-avatar-frame flex size-9 shrink-0 items-center justify-center overflow-hidden text-xs font-semibold text-muted disabled:cursor-default">
            {avatarBusy ? <span className="size-4 animate-spin rounded-full border-2 border-border border-t-accent" /> : profileImage ? (
              // User-uploaded data URLs are already resized before saving.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profileImage} alt="" className="size-full object-cover" />
            ) : workspaceName.trim().slice(0, 2).toUpperCase()}
          </button>
          <input ref={avatarInput} type="file" accept="image/*" className="hidden" onChange={uploadAvatar} aria-label={t("Change profile photo")} />
          <div className="min-w-0"><p className="truncate text-xs font-semibold text-foreground">{workspaceName}</p><p className="mt-0.5 text-[11px] text-muted">{t("Self-hosted")}</p></div>
        </div>
        {avatarError && <p role="alert" className="mt-2 text-xs text-error">{avatarError}</p>}
        <div className="mt-4"><LanguageSwitcher /></div>
      </div>
    </aside>
  </>;
}
