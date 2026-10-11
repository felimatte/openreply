"use client";

import { useCallback, useEffect, useState } from "react";
import type { AccountOption } from "@/components/account-select";
import { useI18n } from "@/lib/i18n/provider";
import { useWorkspaceId } from "@/components/workspace-request-boundary";

type Connection = { id: string; businessName: string; allowedAccountIds: string[]; createdAt: string };
type PairingCode = { code: string; expiresAt: string };
type AccountCapability = { id: string; canPublish: boolean; publishUnavailableReason: string | null };

export function MusaConnectionSettings({ accounts, canManage }: { accounts: Array<AccountOption & { provider?: "META" | "ZERNIO" }>; canManage: boolean }) {
  const { t, locale } = useI18n();
  const workspaceId = useWorkspaceId();
  const [selected, setSelected] = useState<string[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [accountCapabilities, setAccountCapabilities] = useState<AccountCapability[]>([]);
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    fetch("/api/integrations/musa/settings", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message ?? t("Something went wrong. Try again."));
        if (!controller.signal.aborted) { setConnections(data.connections); setAccountCapabilities(data.accountCapabilities ?? []); setError(null); }
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t("Something went wrong. Try again.")); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [canManage, reload, t]);

  useEffect(() => {
    if (!pairing) return;
    const timer = window.setTimeout(() => setPairing(null), Math.max(0, Date.parse(pairing.expiresAt) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [pairing]);

  const generate = useCallback(async () => {
    setBusy("generate"); setError(null); setPairing(null); setCopied(false);
    try {
      const response = await fetch("/api/integrations/musa/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountIds: selected }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? t("Something went wrong. Try again."));
      setPairing({ code: data.code, expiresAt: data.expiresAt });
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Something went wrong. Try again.")); }
    finally { setBusy(null); }
  }, [selected, t]);

  async function revoke(connectionId: string) {
    setBusy(connectionId); setError(null);
    try {
      const response = await fetch("/api/integrations/musa/settings", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connectionId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? t("Something went wrong. Try again."));
      setConnections((current) => current.filter((item) => item.id !== connectionId));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Something went wrong. Try again.")); }
    finally { setBusy(null); }
  }

  async function copyCode() {
    if (!pairing) return;
    try { await navigator.clipboard.writeText(pairing.code); setCopied(true); }
    catch { setError(t("Copy the code manually if clipboard access is unavailable.")); }
  }

  return <section id="musa" className="panel scroll-mt-24 rounded-2xl p-5 sm:p-7">
    <h2 className="text-base font-semibold">MUSA</h2>
    <p className="mt-2 text-sm text-muted">{t("Connect a MUSA business to selected Instagram accounts for automation metrics and video publishing.")}</p>
    {!canManage ? <p className="mt-4 text-sm text-muted">{t("Only workspace owners and administrators can manage MUSA connections.")}</p> : <>
      {error && <div role="alert" className="mt-4 rounded-lg border border-error/20 bg-error/5 p-3 text-sm text-error">{error}<button type="button" className="ml-3 underline" onClick={() => setReload((value) => value + 1)}>{t("Try again")}</button></div>}
      <fieldset className="mt-5 space-y-2" disabled={Boolean(busy)}>
        <legend className="mb-2 text-sm font-medium">{t("Accounts shared with MUSA")}</legend>
        {accounts.length === 0 && <p className="text-sm text-muted">{t("Connect an Instagram professional account to launch campaigns.")}</p>}
        {accounts.map((account) => {
          const capability = accountCapabilities.find((item) => item.id === account.id);
          return <div key={account.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-sm">
            <label className="flex items-center gap-3"><input type="checkbox" checked={selected.includes(account.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, account.id] : current.filter((id) => id !== account.id))} /><span>@{account.username}</span></label>
            {capability?.canPublish ? <span className="text-xs text-success">{t("Video publishing authorized")}</span> : !loading && <div className="text-xs text-muted">
              <p>{t("Publishing permission could not be confirmed.")}</p>
              {account.provider !== "ZERNIO" && workspaceId && <a className="mt-1 inline-block font-medium text-accent underline" href={`/api/instagram/connect?${new URLSearchParams({ purpose: "publish", accountId: account.id, workspaceId })}`}>{t("Allow video publishing")}</a>}
            </div>}
          </div>;
        })}
      </fieldset>
      <button type="button" onClick={() => void generate()} disabled={Boolean(busy) || selected.length === 0} className="mt-4 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
        {busy === "generate" ? t("Creating pairing code…") : t("Create pairing code")}
      </button>
      {pairing && <div className="mt-4 space-y-3 rounded-xl border border-accent/30 bg-accent/5 p-4" role="status">
        <p className="text-sm">{t("Paste this code into the business's Content settings in MUSA. It can be used once and expires in ten minutes.")}</p>
        <label className="block text-xs text-muted">{t("Pairing code")}<input readOnly value={pairing.code} onFocus={(event) => event.target.select()} className="mt-2 w-full rounded-lg border border-border bg-background p-3 font-mono text-xs text-foreground" /></label>
        <p className="text-xs text-muted">{t("Expires at {time}", { time: new Date(pairing.expiresAt).toLocaleTimeString(locale) })}</p>
        <button type="button" onClick={() => void copyCode()} className="rounded-lg border border-border px-3 py-2 text-sm">{copied ? t("Copied") : t("Copy")}</button>
      </div>}
      <div className="mt-6 border-t border-border pt-5">
        <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium">{t("Connected MUSA businesses")}</h3><button type="button" onClick={() => setReload((value) => value + 1)} className="text-xs underline">{t("Refresh")}</button></div>
        {loading ? <p className="mt-3 text-sm text-muted">{t("Loading…")}</p> : connections.length === 0 ? <p className="mt-3 text-sm text-muted">{t("No MUSA businesses connected.")}</p> : <ul className="mt-3 space-y-3">
          {connections.map((connection) => <li key={connection.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div><p className="text-sm font-medium">{connection.businessName}</p><p className="mt-1 text-xs text-muted">{connection.allowedAccountIds.map((id) => accounts.find((account) => account.id === id)).filter((account): account is AccountOption => Boolean(account)).map((account) => `@${account.username}`).join(", ")}</p></div>
            <button type="button" disabled={Boolean(busy)} onClick={() => void revoke(connection.id)} className="rounded-lg border border-error/20 px-3 py-2 text-xs text-error disabled:opacity-50">{t("Revoke")}</button>
          </li>)}
        </ul>}
        <p className="mt-3 text-xs text-muted">{t("Revoking access prevents future requests from this business. Publishing also requires permission from Instagram or Zernio.")}</p>
      </div>
    </>}
  </section>;
}
