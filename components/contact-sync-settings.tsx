"use client";

import { useI18n } from "@/lib/i18n/provider";
import { useEffect, useState } from "react";

interface SyncState {
  configured: boolean;
  url?: string | null;
  enabled?: boolean;
  lastSuccessAt?: string | null;
  lastErrorAt?: string | null;
  lastError?: string | null;
  script?: string;
}

/**
 * Settings → Google Sheets: a guided setup that hands out the Apps Script,
 * takes the web app URL back, and shows whether updates are getting through.
 */
export function ContactSyncSettings({ canManage }: { canManage: boolean }) {
  const { t, locale } = useI18n();
  const [sync, setSync] = useState<SyncState | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!canManage) return;
    fetch("/api/contacts/sync", { cache: "no-store" })
      .then((res) => res.json())
      .then((result) => {
        if (!result.success) return;
        setSync(result.data);
        setUrl(result.data.url ?? "");
      })
      .catch(() => setError(t("Could not load the Google Sheets settings.")));
  }, [canManage, t]);

  async function call(key: string, method: string, body?: unknown) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/contacts/sync", {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = await res.json();
      if (result.data && "configured" in result.data) {
        setSync(result.data);
        setUrl(result.data.url ?? "");
      }
      if (!result.success) {
        setError(result.error ?? t("Something went wrong. Try again."));
        return null;
      }
      return result;
    } catch {
      setError(t("Something went wrong. Try again."));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function saveUrl(event: React.FormEvent) {
    event.preventDefault();
    const result = await call("url", "PUT", { url });
    if (result) setNotice(t("Connected. The test reached your sheet."));
  }

  async function test() {
    const result = await call("test", "POST", { action: "test" });
    if (result) setNotice(t("The test reached your sheet."));
  }

  async function resend() {
    const result = await call("resend", "POST", { action: "resend" });
    if (result) {
      setNotice(
        t("{count} contacts are on their way to your sheet.", { count: result.data.queued })
      );
    }
  }

  async function copyScript() {
    if (!sync?.script) return;
    try {
      await navigator.clipboard.writeText(sync.script);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t("Could not copy. Select the script and copy it by hand."));
    }
  }

  function formatDate(value: string) {
    return new Date(value).toLocaleString(locale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const failing =
    sync?.lastErrorAt &&
    (!sync.lastSuccessAt || new Date(sync.lastErrorAt) > new Date(sync.lastSuccessAt));

  return (
    <section id="google-sheets" className="panel rounded p-4 sm:p-6 space-y-4">
      <div>
        <h2 className="text-base font-semibold">{t("Google Sheets")}</h2>
        <p className="mt-1 text-sm text-muted">
          {t("Keep a Google Sheet up to date with your contacts. New people, the data they share and their tags show up there within seconds.")}
        </p>
      </div>

      {!canManage ? (
        <p className="text-sm text-muted">
          {t("Ask your workspace owner or admin to connect a Google Sheet.")}
        </p>
      ) : !sync ? (
        <div className="h-10 rounded bg-surface-hover" />
      ) : !sync.configured ? (
        <button
          type="button"
          onClick={() => void call("setup", "POST", { action: "setup" })}
          disabled={busy !== null}
          className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {busy === "setup" ? t("Setting up…") : t("Set up")}
        </button>
      ) : (
        <>
          <p
            className={`text-sm ${
              !sync.url || !sync.enabled ? "text-muted" : failing ? "text-error" : "text-success"
            }`}
          >
            {!sync.url
              ? t("Not connected yet. Follow the steps below.")
              : !sync.enabled
                ? t("Paused. Contacts are not being sent.")
                : failing && sync.lastErrorAt
                  ? t("The last update failed ({date}): {error}", {
                      date: formatDate(sync.lastErrorAt),
                      error: sync.lastError ?? "",
                    })
                  : sync.lastSuccessAt
                    ? t("Connected. Last update {date}.", { date: formatDate(sync.lastSuccessAt) })
                    : t("Connected.")}
          </p>

          <ol className="list-decimal space-y-4 pl-5 text-sm text-foreground">
            <li className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{t("Copy this script. It includes your secret key, so don't share it.")}</span>
                <button
                  type="button"
                  onClick={copyScript}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:border-border-hover hover:text-foreground"
                >
                  {copied ? t("Copied") : t("Copy script")}
                </button>
              </div>
              <textarea
                readOnly
                value={sync.script ?? ""}
                rows={5}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full resize-y rounded border border-border bg-surface px-3 py-2 font-mono text-xs text-muted outline-none"
              />
            </li>
            <li>
              {t("Open your Google Sheet (a new one is best) and go to Extensions → Apps Script. Replace the code there with the script and save.")}
            </li>
            <li>
              {t("Choose Deploy → New deployment → Web app. Set “Execute as: Me” and “Who has access: Anyone”, then Deploy and allow access when Google asks.")}
            </li>
            <li className="space-y-2">
              <span>{t("Paste the Web app URL here:")}</span>
              <form onSubmit={saveUrl} className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://script.google.com/macros/s/…/exec"
                  required
                  className="min-w-0 flex-1 rounded border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent/40"
                />
                <button
                  type="submit"
                  disabled={busy !== null || !url.trim()}
                  className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  {busy === "url" ? t("Testing…") : t("Save and test")}
                </button>
              </form>
            </li>
          </ol>

          {sync.url && (
            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              <button
                type="button"
                onClick={() => void test()}
                disabled={busy !== null}
                className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:border-border-hover hover:text-foreground disabled:opacity-50"
              >
                {busy === "test" ? t("Testing…") : t("Send a test")}
              </button>
              {sync.enabled && (
                <button
                  type="button"
                  onClick={() => void resend()}
                  disabled={busy !== null}
                  className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:border-border-hover hover:text-foreground disabled:opacity-50"
                >
                  {busy === "resend" ? t("Sending…") : t("Send all contacts")}
                </button>
              )}
              <button
                type="button"
                onClick={() => void call("toggle", "PUT", { enabled: !sync.enabled })}
                disabled={busy !== null}
                className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:border-border-hover hover:text-foreground disabled:opacity-50"
              >
                {sync.enabled ? t("Pause") : t("Resume")}
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              if (confirm(t("Stop sending contacts to this sheet? The sheet keeps what it already has.")))
                void call("remove", "DELETE");
            }}
            disabled={busy !== null}
            className="text-xs text-muted underline underline-offset-4 hover:text-foreground disabled:opacity-50"
          >
            {t("Disconnect the sheet")}
          </button>
        </>
      )}

      {error && (
        <p role="alert" className="rounded border border-error/20 bg-error/10 p-3 text-sm text-error">
          {error}
        </p>
      )}
      {notice && <p className="text-sm text-success">{notice}</p>}
    </section>
  );
}
