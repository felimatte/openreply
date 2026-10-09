"use client";

/**
 * Import Campaigns Page
 *
 * Paste a CSV of everything except the post. Each row is queued and opened in
 * the campaign builder prefilled and editable, one at a time, so you review
 * each campaign and pick its reel before saving.
 */

import { useI18n } from "@/lib/i18n/provider";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { parseCsv } from "@/lib/utils/csv";
import { IMPORT_QUEUE_KEY, IMPORT_ACCOUNT_KEY } from "@/lib/import-queue";

const SAMPLE = `keywords,dm_message,public_reply,tracked_url,opening_dm,opening_dm_button
"yc","here it is: {link}","sent. check dms","https://events.ycombinator.com/startup-school-2026","hey! click below for the referral","send link"
"LINK,SHOP","grab it here: {link}","dmed u",,,`;

export default function ImportCampaignsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [csv, setCsv] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((res) => res.json())
      .then((payload) => {
        if (payload.success) {
          const next = payload.data.instagramAccounts ?? [];
          setAccounts(next);
          setSelectedAccountId(next[0]?.id ?? "");
        }
      })
      .catch(() => setAccounts([]));
  }, []);

  function startImport() {
    setError(null);
    const parsed = parseCsv(csv);
    if (parsed.length === 0) {
      setError(t("Paste a CSV with a header row and at least one campaign."));
      return;
    }

    const rows = [];
    for (let i = 0; i < parsed.length; i++) {
      const r = parsed[i];
      const keywords = (r.keywords ?? "")
        .split(/[,;]/)
        .map((k) => k.trim())
        .filter(Boolean)
        .slice(0, 10);
      const dmMessage = (r.dm_message ?? r.message ?? "").trim();
      if (keywords.length === 0 || !dmMessage) {
        setError(t("Row {row} is missing keywords or a message.", { row: i + 1 }));
        return;
      }
      rows.push({
        name: (r.name ?? "").trim(),
        keywords,
        dmMessage,
        publicReply: (r.public_reply ?? "").trim(),
        trackedUrl: (r.tracked_url ?? "").trim(),
        openingDmMessage: (r.opening_dm ?? "").trim(),
        openingDmButtonLabel: (r.opening_dm_button ?? "").trim(),
      });
    }

    try {
      window.localStorage.setItem(IMPORT_QUEUE_KEY, JSON.stringify(rows));
      if (selectedAccountId) {
        window.localStorage.setItem(IMPORT_ACCOUNT_KEY, selectedAccountId);
      }
    } catch {
      setError(t("Could not stage the import in this browser."));
      return;
    }
    router.push("/campaigns/new");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/campaigns" className="inline-flex text-xs font-medium text-muted hover:text-foreground">{t("← Campaigns")}</Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("Import campaigns")}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">{t("Paste one campaign per row. You can review each campaign before saving.")}</p>
        <details className="mt-4 rounded-xl border border-border bg-surface p-4"><summary className="text-sm font-medium text-foreground">{t("CSV format and optional columns")}</summary>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          {t("Paste a CSV with one row per campaign. Each row opens in the builder prefilled and editable, so you can review it and pick the reel before saving. Required columns are")}{" "}
          <code className="text-accent">keywords</code> {t("and")}{" "}
          <code className="text-accent">dm_message</code>{t(". Optional:")}{" "}
          <code className="text-accent">name</code>,{" "}
          <code className="text-accent">public_reply</code>,{" "}
          <code className="text-accent">tracked_url</code>,{" "}
          <code className="text-accent">opening_dm</code>,{" "}
          <code className="text-accent">opening_dm_button</code>{t(". Keywords go in one cell, separated by commas. Use")}{" "}
          <code className="text-accent">{"{link}"}</code> {t("in the message to insert the tracked link.")}
        </p>
        </details>
      </div>

      <div className="panel space-y-6 p-5 sm:p-7">
      {error && (
        <div role="alert" className="rounded-xl border border-error/20 bg-error/5 p-4 text-sm text-error">
          {error}
        </div>
      )}

      {accounts.length > 1 && (
        <div className="space-y-2">
          <AccountSelect
            accounts={accounts}
            value={selectedAccountId}
            onChange={setSelectedAccountId}
            includeAll={false}
            label={t("Instagram account")}
          />
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3"><label htmlFor="campaign-csv" className="block text-sm font-medium text-foreground">CSV</label><button type="button" onClick={() => setCsv(SAMPLE)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-hover hover:text-foreground">{t("Fill with a sample")}</button></div>
        <textarea id="campaign-csv" spellCheck={false}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={SAMPLE}
          rows={10}
          className="min-h-72 w-full resize-y rounded-xl border border-border bg-background px-4 py-4 font-mono text-xs leading-7 text-foreground placeholder:text-muted/60"
        />

      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
        <button
          onClick={startImport}
          disabled={!csv.trim()}
          className="min-h-11 rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("Review and import")}
        </button>
        <button
          onClick={() => router.push("/campaigns")}
          className="min-h-11 rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-muted hover:bg-surface-hover hover:text-foreground"
        >
          {t("Cancel")}
        </button>
      </div>
      </div>
    </div>
  );
}
