"use client";

import { useI18n } from "@/lib/i18n/provider";
import { useEffect, useState } from "react";
import Link from "next/link";
import AppIcon from "@/components/app-icon";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import StatCard from "@/components/stat-card";
import StatusBadge from "@/components/status-badge";

interface DashboardStats {
  userName: string | null;
  contactsCount: number;
  totalAutomations: number;
  activeAutomations: number;
  dmsSentToday: number;
  dmsSentWeek: number;
  dmsSentMonth: number;
  dmsSkippedMonth: number;
  dmsFailedMonth: number;
  totalDMs: number;
  clicksThisMonth: number;
  totalClicks: number;
  ctrThisMonth: number;
  instagramAccounts: AccountOption[];
  selectedInstagramAccountId: string | null;
  topKeywords: { keyword: string; count: number }[];
  dailyDMs: { date: string; count: number }[];
  recentLogs: Array<{
    id: string;
    commenterName: string | null;
    commentText: string;
    status: string;
    createdAt: string;
    automation: { name: string };
    instagramAccount?: { username: string };
  }>;
}

export default function DashboardPage() {
  const { t, label, locale } = useI18n();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selectedAccountId, setSelectedAccountId] = useState("all");

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (selectedAccountId !== "all") params.set("instagramAccountId", selectedAccountId);

    fetch(`/api/dashboard/stats${params.size ? `?${params}` : ""}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload.success) throw new Error("Dashboard unavailable");
        if (!controller.signal.aborted) {
          setStats(payload.data);
          setError(false);
        }
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selectedAccountId, retry]);

  if (loading && !stats) {
    return (
      <div className="space-y-8" aria-busy="true" aria-label={t("Loading…")}>
        <div className="space-y-3"><div className="h-8 w-56 animate-pulse rounded-lg bg-surface-hover" /><div className="h-4 w-72 max-w-full animate-pulse rounded bg-surface-hover" /></div>
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="panel h-36 animate-pulse" />)}</div>
        <div className="panel h-72 animate-pulse" />
      </div>
    );
  }

  const maxDM = Math.max(...(stats?.dailyDMs.map((day) => day.count) ?? [1]), 1);
  const connectedCount = stats?.instagramAccounts.length ?? 0;

  return (
    <div className="space-y-7" aria-busy={loading}>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{t("Hello, {name}!", { name: stats?.userName ?? t("there") })}</h1>
          <p className="mt-2 text-sm text-muted">{t("Your conversations, at a glance.")}</p>
        </div>
        <Link href="/campaigns/new" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover">
          <AppIcon name="plus" className="h-4 w-4" />{t("New Campaign")}
        </Link>
      </div>

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-error/20 bg-error/5 p-4 text-sm">
          <p className="text-error">{t("Unable to load your dashboard.")}</p>
          <button type="button" onClick={() => { setLoading(true); setRetry((value) => value + 1); }} className="rounded-lg border border-border bg-surface px-3 py-2 font-medium">{t("Try again")}</button>
        </div>
      )}

      {stats && <>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted sm:text-sm">
            <span className="inline-flex items-center gap-2"><span className={`h-1.5 w-1.5 rounded-full ${connectedCount > 0 ? "bg-success" : "bg-muted"}`} />{t(connectedCount === 1 ? "{count} connected account" : "{count} connected accounts", { count: connectedCount })}</span>
            <Link href="/contacts" className="hover:text-foreground">{t(stats.contactsCount === 1 ? "{count} contact" : "{count} contacts", { count: stats.contactsCount })} <span aria-hidden="true">↗</span></Link>
          </div>
          {stats.instagramAccounts.length > 1 && <AccountSelect accounts={stats.instagramAccounts} value={selectedAccountId} onChange={(accountId) => { setLoading(true); setSelectedAccountId(accountId); }} />}
        </div>

        {connectedCount === 0 && (
          <div className="panel flex flex-col items-start justify-between gap-5 p-6 sm:flex-row sm:items-center">
            <div><h2 className="font-semibold">{t("Connect Instagram")}</h2><p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">{t("Create your first comment-to-DM campaign to turn a post or reel into a measurable conversation flow.")}</p></div>
            <a href="/api/instagram/connect" className="shrink-0 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white">{t("Connect Instagram")} <span aria-hidden="true">↗</span></a>
          </div>
        )}

        <div className={`space-y-3 transition-opacity ${loading ? "opacity-50" : ""}`}>
          <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">{t("Campaign performance")}</h2><span className="text-xs text-muted">{t("This month")}</span></div>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 sm:gap-4">
            <StatCard label={t("DMs Sent")} value={stats.dmsSentMonth.toLocaleString(locale)} />
            <StatCard label={t("Clicks")} value={stats.clicksThisMonth.toLocaleString(locale)} />
            <StatCard label={t("CTR")} value={`${stats.ctrThisMonth}%`} />
            <StatCard label={t("Active Campaigns")} value={stats.activeAutomations} />
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
          <section className="panel min-w-0 p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">{t("DMs — Last 7 Days")}</h2><span className="text-xs tabular-nums text-muted">{stats.dmsSentWeek.toLocaleString(locale)} {t("sent")}</span></div>
            <div className="mt-7 flex h-48 items-stretch gap-2 sm:gap-4" role="img" aria-label={`${t("DMs — Last 7 Days")}: ${stats.dailyDMs.map((day) => `${label(day.date)} ${day.count}`).join(", ")}`}>
              {stats.dailyDMs.map((day) => (
                <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2">
                  <span className="text-xs font-medium tabular-nums text-muted">{day.count}</span>
                  <div className="w-full max-w-14 rounded-t-md bg-accent/85 transition-all hover:bg-accent" style={{ height: `${Math.max((day.count / maxDM) * 132, 3)}px` }} />
                  <span className="w-full truncate border-t border-border pt-2 text-center text-[11px] text-muted">{label(day.date)}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="panel p-5 sm:p-6">
            <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">{t("Delivery overview")}</h2><span className="text-xs text-muted">{t("This month")}</span></div>
            <dl className="mt-6 divide-y divide-border">
              {[{ name: t("Sent"), value: stats.dmsSentMonth, color: "bg-success" }, { name: t("Skipped"), value: stats.dmsSkippedMonth, color: "bg-muted/60" }, { name: t("Failed"), value: stats.dmsFailedMonth, color: "bg-error" }].map((item) => <div key={item.name} className="flex items-center justify-between py-3.5"><dt className="flex items-center gap-2.5 text-sm text-muted"><span className={`h-1.5 w-1.5 rounded-full ${item.color}`} />{item.name}</dt><dd className="text-sm font-semibold tabular-nums">{item.value.toLocaleString(locale)}</dd></div>)}
            </dl>
            <Link href="/logs" className="mt-4 inline-flex items-center gap-2 text-xs font-medium hover:underline">{t("See activity")} <span aria-hidden="true">→</span></Link>
          </section>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
          <section className="panel min-w-0 overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-5 sm:px-6"><h2 className="text-sm font-semibold">{t("Recent Activity")}</h2><Link href="/logs" className="text-xs text-muted hover:text-foreground">{t("See activity")} <span aria-hidden="true">→</span></Link></div>
            {stats.recentLogs.length === 0 ? <div className="px-6 py-12 text-center"><p className="text-sm text-muted">{t("No activity yet")}</p><Link href="/campaigns" className="mt-3 inline-block text-sm font-medium hover:underline">{t("View campaigns")} →</Link></div> : <ul className="divide-y divide-border">{stats.recentLogs.slice(0, 5).map((log) => <li key={log.id} className="flex items-center gap-3 px-5 py-4 sm:px-6"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-hover text-xs font-semibold text-muted" aria-hidden="true">{(log.commenterName ?? "?").slice(0, 1).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">@{log.commenterName ?? "unknown"}<span className="ml-2 hidden font-normal text-muted sm:inline">· {log.automation.name}</span></p><p className="mt-0.5 truncate text-xs text-muted">{log.commentText}</p></div><StatusBadge status={log.status} /></li>)}</ul>}
          </section>
          <section className="panel p-5 sm:p-6">
            <h2 className="text-sm font-semibold">{t("Top Keywords")}</h2>
            {stats.topKeywords.length === 0 ? <p className="py-10 text-sm text-muted">{t("No keyword matches yet")}</p> : <ol className="mt-5 space-y-4">{stats.topKeywords.map((keyword, index) => <li key={keyword.keyword} className="flex items-center gap-3"><span className="w-4 text-xs tabular-nums text-muted">{String(index + 1).padStart(2, "0")}</span><span className="min-w-0 flex-1 truncate text-sm font-medium">{keyword.keyword}</span><span className="text-sm tabular-nums text-muted">{keyword.count}</span></li>)}</ol>}
          </section>
        </div>
      </>}
    </div>
  );
}
