import type { StaticMessageKey } from "@/lib/i18n";
import type { AppIconName } from "@/components/app-icon";

/** Public previews must explicitly enter sign-in before opening a real workspace. */
export function workspaceHref(href: string, demo: boolean): string {
  if (!demo) return href;
  if (href === "/dashboard") return "/demo";
  return `/login?${new URLSearchParams({ callbackUrl: href, preview: "1" })}`;
}

export function accountScopedHref(href: string, accountId: string | null): string {
  if (!accountId || accountId === "all") return href;
  const url = new URL(href, "https://openreply.local");
  if (!["/dashboard", "/campaigns", "/campaigns/new"].includes(url.pathname) || url.origin !== "https://openreply.local") {
    return href;
  }
  url.searchParams.set("instagramAccountId", accountId);
  return url.pathname + url.search + url.hash;
}

export function initialCampaignAccount(
  accounts: { id: string }[],
  requestedAccountId: string | undefined,
  defaultAccountId: string | null,
): string {
  if (requestedAccountId) return accounts.find(({ id }) => id === requestedAccountId)?.id ?? "";
  return accounts.find(({ id }) => id === defaultAccountId)?.id ?? accounts[0]?.id ?? "";
}

export const workspaceNavigation: { label: StaticMessageKey; href: string; icon: AppIconName; section: "workspace" | "insights" | "manage" }[] = [
  { label: "Dashboard", href: "/dashboard", icon: "home", section: "workspace" },
  { label: "Campaigns", href: "/campaigns", icon: "campaign", section: "workspace" },
  { label: "Inbox", href: "/inbox", icon: "inbox", section: "workspace" },
  { label: "Contacts", href: "/contacts", icon: "contacts", section: "workspace" },
  { label: "Overview", href: "/overview", icon: "chart", section: "insights" },
  { label: "DM Logs", href: "/logs", icon: "activity", section: "insights" },
  { label: "Settings", href: "/settings", icon: "settings", section: "manage" },
  { label: "Diagnostics", href: "/diagnostics", icon: "activity", section: "manage" },
];
