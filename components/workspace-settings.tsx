"use client";

import { useEffect, useState } from "react";
import type { StaticMessageKey } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/provider";
import { useWorkspaceId } from "@/components/workspace-request-boundary";

type WorkspaceOption = { id: string; name: string; role: "OWNER" | "ADMIN" | "MEMBER" };
type WorkspaceList = { workspaces: WorkspaceOption[]; canCreate: boolean };
const errorMessages: Record<string, StaticMessageKey> = {
  UNAUTHORIZED: "Sign in again to manage workspaces.",
  INVALID_ORIGIN: "Manage workspaces from OpenReply Settings.",
  CREATION_NOT_ALLOWED: "Your account can access invited workspaces but cannot create independent workspaces.",
  CREATION_RATE_LIMITED: "Too many workspaces created recently. Try again in one hour.",
  INVALID_NAME: "Enter a workspace name between 2 and 80 characters.",
  WORKSPACE_ACCESS_REQUIRED: "You no longer have access to that workspace.",
};

export function WorkspaceSettings() {
  const { t, label } = useI18n();
  const activeWorkspaceId = useWorkspaceId();
  const [data, setData] = useState<WorkspaceList | null>(null);
  const [selection, setSelection] = useState(activeWorkspaceId ?? "");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"create" | "select" | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/workspaces", { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error?.code ?? "INTERNAL_ERROR");
        if (!controller.signal.aborted) setData(result.data);
      })
      .catch((error) => { if (!controller.signal.aborted) setErrorCode(error instanceof Error ? error.message : "INTERNAL_ERROR"); });
    return () => controller.abort();
  }, []);

  async function changeWorkspace(kind: "create" | "select") {
    if (busy) return;
    setBusy(kind);
    setErrorCode(null);
    try {
      const response = await fetch(kind === "create" ? "/api/workspaces" : "/api/workspaces/select", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "create" ? { name } : { workspaceId: selection }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error?.code ?? "INTERNAL_ERROR");
      // A document navigation installs the new workspace's request and cache
      // scope. A client-side refresh would still carry this tab's old header.
      window.location.reload();
    } catch (error) {
      setErrorCode(error instanceof Error ? error.message : "INTERNAL_ERROR");
      setBusy(null);
    }
  }

  return (
    <section id="workspaces" className="panel scroll-mt-24 space-y-5 rounded-2xl p-5 sm:p-7" aria-busy={busy !== null}>
      <div>
        <h2 className="text-base font-semibold">{t("Client workspaces")}</h2>
        <p className="mt-2 text-sm text-muted">{t("Use a separate workspace for each client. Members can access the entire workspace.")}</p>
        <p className="mt-2 text-sm text-muted">{t("New Instagram accounts connect to the selected workspace. Existing accounts stay in their current workspace.")}</p>
      </div>
      {errorCode && <p role="alert" className="text-sm text-error">{t(errorMessages[errorCode] ?? "Something went wrong. Try again.")}</p>}
      {!data && !errorCode && <p role="status" className="text-sm text-muted">{t("Loading…")}</p>}
      {data && <>
        <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); void changeWorkspace("select"); }}>
          <label className="min-w-0 flex-1 space-y-2 text-sm font-medium">
            <span>{t("Selected workspace")}</span>
            <select value={selection} onChange={(event) => setSelection(event.target.value)} disabled={busy !== null} className="block w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent/40">
              {data.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name} · {label(workspace.role)}</option>)}
            </select>
          </label>
          <button type="submit" disabled={busy !== null || !selection || selection === activeWorkspaceId} className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-surface-hover disabled:opacity-50">
            {t(busy === "select" ? "Switching workspace…" : "Switch workspace")}
          </button>
        </form>
        {data.canCreate ? <form className="space-y-3 border-t border-border pt-5" onSubmit={(event) => { event.preventDefault(); void changeWorkspace("create"); }}>
          <label className="block space-y-2 text-sm font-medium">
            <span>{t("New client workspace name")}</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={80} disabled={busy !== null} className="block w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent/40" />
          </label>
          <button type="submit" disabled={busy !== null || name.trim().length < 2} className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50">
            {t(busy === "create" ? "Creating workspace…" : "Create and open workspace")}
          </button>
        </form> : <p className="text-sm text-muted">{t("Your account can access invited workspaces but cannot create independent workspaces.")}</p>}
      </>}
    </section>
  );
}
