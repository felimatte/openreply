"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/provider";
import QuickNavigation from "@/components/quick-navigation";
import Sidebar from "@/components/sidebar";
import TopBar from "@/components/top-bar";

interface DashboardShellProps {
  children: React.ReactNode;
  workspaceName: string;
  profileImage: string | null;
  avatarEditable?: boolean;
  instagramUsername: string | null;
  instagramAccountCount: number;
}

export default function DashboardShell({
  children,
  workspaceName,
  profileImage,
  avatarEditable = true,
  instagramUsername,
  instagramAccountCount,
}: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const pathname = usePathname();
  const { t } = useI18n();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); setSidebarOpen(false); setSearchOpen(value => !value);
      }
    }
    const desktop = window.matchMedia("(min-width: 1024px)");
    function onResize() { if (desktop.matches) setSidebarOpen(false); }
    desktop.addEventListener("change", onResize);
    document.addEventListener("keydown", onKey);
    return () => { desktop.removeEventListener("change", onResize); document.removeEventListener("keydown", onKey); };
  }, []);

  return (
    // h-dvh, not h-screen: on mobile browsers the URL bar eats into 100vh, which
    // would push the composer and pagination controls below the fold.
    <div className="dashboard-shell flex h-dvh overflow-hidden bg-background">
      <a href="#workspace-content" className="skip-link">{t("Skip to content")}</a>
      <Sidebar
        isOpen={sidebarOpen}
        onClose={closeSidebar}
        onSearch={() => setSearchOpen(true)}
        workspaceName={workspaceName}
        profileImage={profileImage}
        avatarEditable={avatarEditable}
      />

      <div inert={sidebarOpen} className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          onMenuClick={() => setSidebarOpen(true)}
          onSearchClick={() => setSearchOpen(true)}
          sidebarOpen={sidebarOpen}
          instagramUsername={instagramUsername}
          instagramAccountCount={instagramAccountCount}
        />

        {/* overflow-x-hidden: enabling vertical scrolling makes the browser
            allow horizontal scrolling too, which lets a wide child drag the
            whole page sideways on a phone. */}
        <main id="workspace-content" tabIndex={-1} className="workspace-content flex-1 overflow-y-auto overflow-x-hidden focus:outline-none">
          <div key={pathname} className="px-4 sm:px-6 lg:px-9 py-6 sm:py-8 max-w-[1440px] mx-auto">
            {children}
          </div>
        </main>
      </div>
      {searchOpen && <QuickNavigation open={searchOpen} onClose={closeSearch} demo={pathname.startsWith("/demo")} />}
    </div>
  );
}
