"use client";

import { useState } from "react";
import { accountScopedHref } from "@/components/workspace-navigation";
import { useWorkspaceId } from "@/components/workspace-request-boundary";
import { useI18n } from "@/lib/i18n/provider";

export interface WorkspaceProfile {
  id: string;
  name: string;
  instagramAccounts: { id: string; username: string }[];
}

export default function WorkspaceProfileSwitcher({ profiles, accountId }: {
  profiles: WorkspaceProfile[];
  accountId: string | null;
}) {
  const { t } = useI18n();
  const workspaceId = useWorkspaceId();
  const [pending, setPending] = useState("");
  const [failed, setFailed] = useState(false);
  const options = profiles.flatMap(({ id, name, instagramAccounts }) => [
    ...(instagramAccounts.length === 1 ? [] : [{
      key: `workspace:${id}`,
      workspaceId: id,
      accountId: null,
      label: instagramAccounts.length ? `${name} · ${t("All accounts")}` : name,
    }]),
    ...instagramAccounts.map((account) => ({
      key: `account:${account.id}`,
      workspaceId: id,
      accountId: account.id,
      label: `@${account.username} · ${name}`,
    })),
  ]);
  const active = options.find((option) => option.workspaceId === workspaceId && option.accountId === accountId)
    ?? options.find((option) => option.workspaceId === workspaceId);

  async function switchProfile(key: string) {
    const next = options.find((option) => option.key === key);
    if (!next || next.key === active?.key || pending) return;
    setPending(key);
    setFailed(false);
    try {
      if (next.workspaceId !== workspaceId) {
        const response = await fetch("/api/workspaces/select", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId: next.workspaceId }),
        });
        if (!response.ok) throw new Error("Workspace switch failed");
      }
      // A document navigation installs the selected workspace's request and cache scope.
      window.location.assign(accountScopedHref("/dashboard", next.accountId));
    } catch {
      setPending("");
      setFailed(true);
    }
  }

  return <div className="relative min-w-0">
    <select
      aria-label={t("Switch workspace")}
      title={active?.label}
      value={pending || active?.key || ""}
      onChange={(event) => void switchProfile(event.target.value)}
      disabled={Boolean(pending)}
      className="min-h-10 w-full max-w-40 truncate rounded-lg border border-border bg-surface px-2 text-xs font-medium text-foreground focus-visible:outline-accent sm:max-w-64 sm:px-3"
    >
      {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
    </select>
    {failed && <p role="alert" className="absolute right-0 top-full mt-2 w-48 rounded-lg border border-border bg-surface p-2 text-xs text-error shadow-md">{t("Something went wrong. Try again.")}</p>}
  </div>;
}
