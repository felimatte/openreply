"use client";

/**
 * Sidebar Navigation
 *
 * Text-only nav with active state and workspace section.
 */

import { useRef, useState, type ChangeEvent } from "react";
import LanguageSwitcher from "@/components/language-switcher";
import { useI18n } from "@/lib/i18n/provider";
import Link from "next/link";
import Image from "next/image";
import { zernioLink } from "@/lib/zernio-links";
import { usePathname } from "next/navigation";

const navItems = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Overview", href: "/overview" },
  { label: "Inbox", href: "/inbox" },
  { label: "Campaigns", href: "/campaigns" },
  { label: "Contacts", href: "/contacts" },
  { label: "DM Logs", href: "/logs" },
  { label: "Settings", href: "/settings" },
  { label: "Diagnostics", href: "/diagnostics" },
] as const;

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceName: string;
  profileImage: string | null;
  avatarEditable: boolean;
}

export default function Sidebar({
  isOpen,
  onClose,
  workspaceName,
  profileImage: initialProfileImage,
  avatarEditable,
}: SidebarProps) {
  const { t } = useI18n();
  const pathname = usePathname();
  const avatarInput = useRef<HTMLInputElement>(null);
  const [profileImage, setProfileImage] = useState(initialProfileImage);
  const [avatarBusy, setAvatarBusy] = useState(false);

  async function uploadAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      window.alert("Choose an image file to use as your profile photo.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      window.alert("Choose an image under 15 MB.");
      return;
    }

    setAvatarBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      const crop = Math.min(bitmap.width, bitmap.height);
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 512;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not process this image.");
      context.fillStyle = "#171018";
      context.fillRect(0, 0, 512, 512);
      context.drawImage(
        bitmap,
        (bitmap.width - crop) / 2,
        (bitmap.height - crop) / 2,
        crop,
        crop,
        0,
        0,
        512,
        512
      );
      bitmap.close();
      let image = canvas.toDataURL("image/jpeg", 0.82);
      if (image.length > 650_000) image = canvas.toDataURL("image/jpeg", 0.65);
      const response = await fetch("/api/profile/avatar", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
      });
      const result = (await response.json()) as { error?: string; image?: string };
      if (!response.ok || !result.image) {
        throw new Error(result.error ?? "Could not save your profile photo.");
      }
      setProfileImage(result.image);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not save your profile photo.");
    } finally {
      setAvatarBusy(false);
    }
  }

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          brand-sidebar fixed top-0 left-0 z-50 flex h-dvh w-64 max-w-[85vw] shrink-0 flex-col border-r border-border bg-surface
          transition-transform duration-200 ease-out
          lg:h-full lg:translate-x-0 lg:static lg:z-auto
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* Same reason as the top bar: the drawer is full height, so the
            wordmark would otherwise land under the status bar. */}
        <div
          className="px-6 py-5 border-b border-border"
          style={{ paddingTop: "calc(1.25rem + env(safe-area-inset-top))" }}
        >
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={avatarEditable ? () => avatarInput.current?.click() : undefined}
              disabled={!avatarEditable || avatarBusy}
              aria-label={avatarEditable ? "Change profile photo" : "Demo profile"}
              title={avatarEditable ? "Click to add your profile photo" : "Demo profile"}
              className="brand-avatar-frame group size-12 shrink-0 disabled:cursor-default"
            >
              <span className="relative flex size-full items-center justify-center overflow-hidden rounded-[0.88rem] bg-[#171018] text-lg font-black tracking-tight text-white">
                {profileImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={profileImage} alt="Your profile" className="size-full object-cover" />
                ) : (
                  <span className="bg-gradient-to-br from-[#ffd166] via-[#ff7a4a] to-[#ff3e92] bg-clip-text text-transparent">F.</span>
                )}
                {avatarEditable && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/50 group-hover:opacity-100">
                    {avatarBusy ? (
                      <span className="size-5 animate-spin rounded-full border-2 border-white/35 border-t-white" />
                    ) : (
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="size-5">
                        <path d="M4 8.5h3l1.4-2h7.2l1.4 2h3v10H4v-10Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                        <circle cx="12" cy="13.5" r="3.3" stroke="currentColor" strokeWidth="1.8" />
                      </svg>
                    )}
                  </span>
                )}
                {avatarEditable && !avatarBusy && (
                  <span className="absolute bottom-0.5 right-0.5 flex size-4 items-center justify-center rounded-full border border-[#171018] bg-hotpink text-[9px] font-bold text-white shadow-[0_0_12px_rgba(255,62,146,0.8)]">
                    +
                  </span>
                )}
              </span>
            </button>
            <input ref={avatarInput} type="file" accept="image/*" className="hidden" onChange={uploadAvatar} aria-label="Upload profile photo" />
            <Link href="/dashboard" className="min-w-0">
              <span className="block text-sm font-semibold tracking-tight text-foreground">OpenReply</span>
              <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-muted">by @felimattee</span>
            </Link>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href ||
              pathname.startsWith(item.href + "/") ||
              (item.href === "/dashboard" && pathname === "/demo");
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                aria-current={isActive ? "page" : undefined}
                className={`
                  block rounded-r-lg border-l-2 px-3 py-2.5 text-sm
                  ${
                    isActive
                      ? "border-hotpink bg-gradient-to-r from-hotpink/20 via-accent/10 to-transparent font-medium text-white shadow-[inset_0_0_20px_rgba(255,62,146,0.06)]"
                      : "border-transparent text-muted hover:bg-surface-hover hover:text-white"
                  }
                `}
              >
                {t(item.label)}
              </Link>
            );
          })}
        </nav>

        <div className="px-5 py-4 border-t border-border">
          <div className="mb-4"><LanguageSwitcher /></div>
          <p className="text-sm text-foreground truncate">{workspaceName}</p>
          <p className="text-xs text-muted">{t("Self-hosted")}</p>
          <a
            href={zernioLink({ placement: "sidebar" })}
            target="_blank"
            rel="sponsored noopener noreferrer"
            className="mt-4 flex items-center gap-3 text-xs text-muted hover:text-foreground"
          >
            <span>{t("Supported by")}</span>
            <Image
              src="/brand/zernio-primary.svg"
              alt="Zernio"
              width={64}
              height={20}
              className="m-2"
            />
          </a>
        </div>
      </aside>
    </>
  );
}
