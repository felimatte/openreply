"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { AccountOption } from "@/components/account-select";
import { useWorkspaceId } from "@/components/workspace-request-boundary";
import { useI18n } from "@/lib/i18n/provider";

interface CatalogStatus {
  workspaceId: string;
  accountId: string;
  retry: number;
  value: "connected" | "disconnected" | "error";
}

export function ReelAudioSettings({ accounts, canManage }: {
  accounts: readonly AccountOption[];
  canManage: boolean;
}) {
  const { t } = useI18n();
  const workspaceId = useWorkspaceId();
  const params = useSearchParams();
  const result = params.get("reelAudio");
  const returnedAccount = params.get("reelAudioAccountId");
  const title = useRef<HTMLHeadingElement>(null);
  const [selectedId, select] = useState("");
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState<CatalogStatus | null>(null);
  const selected = accounts.find(account => account.id === selectedId) ??
    accounts.find(account => account.id === returnedAccount) ?? accounts[0];
  const accountId = selected?.id;
  const current = status?.workspaceId === workspaceId && status?.accountId === accountId && status?.retry === retry ? status : null;
  const isReturnedAccount = accountId === returnedAccount || (!returnedAccount && accounts.length === 1);

  useEffect(() => {
    if (window.location.hash !== "#reel-audio") return;
    title.current?.scrollIntoView({ block: "start" });
    if (result === "connected" || result === "error") title.current?.focus({ preventScroll: true });
  }, [result]);

  useEffect(() => {
    if (!workspaceId || !accountId || !canManage) return;
    const controller = new AbortController();
    async function readStatus(id: string, workspace: string) {
      let value: CatalogStatus["value"] = "error";
      try {
        const response = await fetch(`/api/instagram/reel-audio/status?${new URLSearchParams({ accountId: id })}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json() as { success?: boolean; data?: { connected?: boolean } };
        const connected = payload.data?.connected;
        if (response.ok && payload.success && typeof connected === "boolean") value = connected ? "connected" : "disconnected";
      } catch {
        // Keep the authorization form usable when status cannot be loaded.
      }
      if (!controller.signal.aborted) setStatus({ workspaceId: workspace, accountId: id, retry, value });
    }
    void readStatus(accountId, workspaceId);
    return () => controller.abort();
  }, [workspaceId, accountId, canManage, retry]);

  return <section id="reel-audio" aria-labelledby="reel-audio-title" className="space-y-3 border-t border-border pt-5">
    <h3 ref={title} tabIndex={-1} id="reel-audio-title" className="scroll-mt-24 text-sm font-semibold">
      {t("Music for Instagram Reels")}
    </h3>
    <p className="text-sm text-muted">{t("Authorize the Facebook Page linked to your Instagram account to search the music catalog in MUSA.")}</p>
    {result === "error" && <p role="alert" className="text-sm text-error">{t("Could not authorize Reel music. Confirm that you selected the Facebook Page linked to this Instagram account.")}</p>}
    {canManage && selected && workspaceId ? <>
      <form method="post" action="/api/instagram/reel-audio/connect" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        {accounts.length > 1 ? <label className="grid min-w-0 flex-1 gap-1.5 text-sm">
          {t("Instagram account")}
          <select name="accountId" value={selected.id} onChange={event => select(event.target.value)}
            className="min-h-11 w-full rounded-lg border border-border bg-background px-3">
            {accounts.map(account => <option key={account.id} value={account.id}>@{account.username}</option>)}
          </select>
        </label> : <>
          <input type="hidden" name="accountId" value={selected.id} />
          <p className="min-w-0 break-words py-2 text-sm font-medium">@{selected.username}</p>
        </>}
        <button type="submit" className="min-h-11 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:border-border-hover">
          {t(current?.value === "connected" ? "Reconnect Facebook for Reel music" : "Connect Facebook for Reel music")}
        </button>
      </form>
      <p role="status" className={current?.value === "connected" ? "text-sm text-success" : "text-sm text-muted"}>
        {current?.value === "connected" && t("Music catalog authorized")}
        {!current && t("Checking music authorization…")}
        {current?.value === "disconnected" && t(result === "connected" && isReturnedAccount ? "Facebook authorization returned. The music catalog still needs to be confirmed for this account." : "Music catalog not authorized")}
        {current?.value === "error" && t("Could not check music authorization.")}
      </p>
      {current?.value === "error" && <button type="button" className="min-h-11 text-sm underline underline-offset-4"
        onClick={() => setRetry(value => value + 1)}>{t("Try again")}</button>}
    </> : <p className="text-sm text-muted">{t(canManage ? "Connect an Instagram professional account to authorize music for Reels." : "Only workspace owners and admins can authorize music for Reels.")}</p>}
  </section>;
}
