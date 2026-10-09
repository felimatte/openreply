"use client";

import type { StaticMessageKey } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/provider";
import { usePathname } from "next/navigation";
import Link from "next/link";
import AppIcon from "@/components/app-icon";
import { workspaceHref } from "@/components/workspace-navigation";

const pageTitles: Record<string, StaticMessageKey> = {
  "/dashboard": "Dashboard", "/demo": "Dashboard", "/overview": "Overview", "/inbox": "Inbox",
  "/campaigns/import": "Import campaigns", "/campaigns": "Campaigns", "/campaigns/new": "New Campaign",
  "/automations": "Campaigns", "/automations/new": "New Campaign", "/contacts": "Contacts", "/logs": "DM Logs", "/settings": "Settings", "/diagnostics": "Diagnostics",
};
interface TopBarProps { onMenuClick: () => void; onSearchClick: () => void; sidebarOpen: boolean; instagramUsername: string | null; instagramAccountCount: number; }

export default function TopBar({ onMenuClick, onSearchClick, sidebarOpen, instagramUsername, instagramAccountCount }: TopBarProps) {
  const { t } = useI18n();
  const pathname = usePathname();
  const settingsHref = workspaceHref("/settings", pathname.startsWith("/demo"));
  const title = pageTitles[pathname] ?? (pathname.endsWith("/edit") ? "Edit campaign" : pathname.startsWith("/campaigns/") ? "Campaign details" : "Dashboard");
  const campaignDetail = pathname.startsWith("/campaigns/");
  return <header className="dashboard-top-bar sticky top-0 z-30 flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 sm:px-6 lg:px-9" style={{ height: "calc(4rem + env(safe-area-inset-top))", paddingTop: "env(safe-area-inset-top)" }}>
    <div className="flex min-w-0 items-center gap-3">
      <button type="button" onClick={onMenuClick} className="shrink-0 rounded-lg p-2 text-muted hover:bg-surface-hover lg:hidden" aria-label={t("Toggle sidebar")} aria-expanded={sidebarOpen} aria-controls="workspace-navigation"><AppIcon name="menu" /></button>
      <nav aria-label={t("Navigate")} className="flex min-w-0 items-center gap-2 text-xs"><Link href={campaignDetail ? "/campaigns" : pathname.startsWith("/demo") ? "/demo" : "/dashboard"} className="hidden text-muted hover:text-foreground sm:inline">{t(campaignDetail ? "Campaigns" : "Workspace")}</Link><AppIcon name="chevron" className="hidden size-3 text-muted sm:block" /><span className="truncate font-medium text-foreground" aria-current="page">{t(title)}</span></nav>
    </div>
    <div className="flex shrink-0 items-center gap-2 sm:gap-4">
      <button type="button" onClick={onSearchClick} aria-label={t("Quick navigation")} className="rounded-lg p-2 text-muted hover:bg-surface-hover"><AppIcon name="search" className="size-4" /></button>
      {instagramAccountCount > 0 ? <Link href={settingsHref} className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted hover:border-border-hover"><span className="size-1.5 rounded-full bg-success" /><span className="max-w-32 truncate">{instagramAccountCount > 1 ? t("{count} accounts", { count: instagramAccountCount }) : `@${instagramUsername}`}</span></Link> : <Link href={settingsHref} className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hover"><AppIcon name="instagram" className="size-3.5" /><span className="sm:hidden">{t("Connect")}</span><span className="hidden sm:inline">{t("Connect Instagram")}</span></Link>}
    </div>
  </header>;
}
