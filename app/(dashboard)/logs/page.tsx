"use client";

/**
 * DM Logs Page
 *
 * Filterable, paginated table of DM logs.
 */

import { useI18n } from "@/lib/i18n/provider";
import { useEffect, useState, useCallback, useRef } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import StatusBadge from "@/components/status-badge";

interface DmLog {
  id: string;
  commenterId: string;
  commenterName: string | null;
  commentText: string;
  status: string;
  errorMessage: string | null;
  createdAt: string;
  automation: { name: string; keywords: string[] };
  instagramAccount: { username: string };
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const STATUS_FILTERS = [
  "ALL",
  "SENT",
  "FAILED",
  "PENDING",
  "SKIPPED_RATE_LIMIT",
  "SKIPPED_PLAN_LIMIT",
  "SKIPPED_DEDUP",
];

export default function LogsPage() {
  const { t, label, locale } = useI18n();
  const [logs, setLogs] = useState<DmLog[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("all");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const fetchLogs = useCallback(async () => {
    const request = ++requestRef.current;
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (selectedAccountId !== "all") {
        params.set("instagramAccountId", selectedAccountId);
      }

      const res = await fetch(`/api/logs?${params}`);
      const data = await res.json();
      if (request !== requestRef.current) return;
      if (data.success) {
        setLogs(data.data.logs);
        setPagination(data.data.pagination);
        setError(null);
      } else {
        setError(data.error ?? t("Could not load activity."));
      }
    } catch {
      if (request === requestRef.current) setError(t("Could not load activity."));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [page, statusFilter, selectedAccountId, t]);

  useEffect(() => {
    fetch("/api/instagram/accounts")
      .then((res) => res.json())
      .then((payload) => {
        if (payload.success) setAccounts(payload.data.instagramAccounts ?? []);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchLogs();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchLogs]);

  function handleFilterChange(status: string) {
    if (status === statusFilter) return;
    setLoading(true);
    setStatusFilter(status);
    setPage(1);
  }

  function handleAccountChange(accountId: string) {
    setLoading(true);
    setSelectedAccountId(accountId);
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-3xl font-semibold tracking-tight">{t("DM Logs")}</h1><p className="mt-2 text-sm text-muted">{t("Track every reply and understand what happened.")}</p></div>
        <button type="button" disabled={loading} onClick={() => { setLoading(true); void fetchLogs(); }} className="rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium text-foreground hover:bg-surface-hover disabled:opacity-40">{loading ? t("Loading…") : t("Refresh")}</button>
      </div>
      {/* Filters */}
      <div className="panel flex flex-col gap-4 rounded-2xl p-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((status) => (
            <button
              key={status}
              onClick={() => handleFilterChange(status)}
              aria-pressed={statusFilter === status}
              className={`
                px-3 py-2.5 rounded-lg text-xs font-medium transition-colors
                ${
                  statusFilter === status
                    ? "bg-accent text-white"
                    : "text-muted hover:bg-surface-hover hover:text-foreground"
                }
              `}
            >
              {label(status)}
            </button>
          ))}
        </div>
        {accounts.length > 1 && (
          <AccountSelect
            accounts={accounts}
            value={selectedAccountId}
            onChange={handleAccountChange}
          />
        )}
      </div>

      {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-error/20 bg-error/5 p-4 text-sm text-error"><span>{error}</span><button onClick={() => { setLoading(true); void fetchLogs(); }} className="font-semibold underline">{t("Try again")}</button></div>}

      {/* Table */}
      <div className="panel overflow-hidden rounded-2xl" aria-busy={loading}>
        <div className="divide-y divide-border md:hidden">
          {loading ? [0,1,2,3].map((i) => <div key={i} className="animate-pulse space-y-3 p-5"><div className="h-4 w-1/2 rounded bg-surface-hover"/><div className="h-3 w-3/4 rounded bg-surface-hover"/></div>) : logs.length === 0 ? <p className="p-10 text-center text-sm text-muted">{t("No logs found")}</p> : logs.map((log) => <article key={log.id} className="space-y-3 p-5"><div className="flex items-center justify-between gap-3"><p className="min-w-0 truncate text-sm font-semibold">@{log.commenterName ?? log.commenterId.slice(0,8)}</p><StatusBadge status={log.status}/></div><p className="break-words text-sm leading-6 text-muted">{log.commentText}</p><div className="flex flex-wrap justify-between gap-2 text-xs text-muted"><span>{log.automation.name} · @{log.instagramAccount.username}</span><time dateTime={log.createdAt}>{new Date(log.createdAt).toLocaleString(locale, {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}</time></div>{log.errorMessage && <p className="rounded-lg bg-error/5 p-3 text-xs leading-5 text-error">{log.errorMessage}</p>}</article>)}
        </div>
        {/* Six columns don't fit a phone; the table keeps its width and scrolls
            horizontally inside the panel rather than crushing every cell. */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border bg-background/70 text-left">
                <th className="px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider sm:px-6">{t("Commenter")}</th>
                <th className="px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider sm:px-6">{t("Comment")}</th>
                <th className="px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider sm:px-6">{t("Campaign")}</th>
                <th className="px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider sm:px-6">{t("Account")}</th>
                <th className="px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider sm:px-6">{t("Status")}</th>
                <th className="px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider sm:px-6">{t("Time")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && (
                <>
                  {[...Array(5)].map((_, i) => (
                    <tr key={i}>
                      <td colSpan={6} className="px-4 py-4 sm:px-6">
                        <div className="h-4 bg-surface-hover rounded" />
                      </td>
                    </tr>
                  ))}
                </>
              )}
              {!loading && logs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted sm:px-6">
                    {t("No logs found")}
                  </td>
                </tr>
              )}
              {!loading &&
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-surface-hover/50 transition-colors">
                    <td className="px-4 py-4 sm:px-6">
                      <span className="font-medium text-foreground">
                        @{log.commenterName ?? log.commenterId.slice(0, 8)}
                      </span>
                    </td>
                    <td className="px-4 py-4 max-w-[200px] sm:px-6">
                      <details className="group"><summary className="cursor-pointer list-none truncate text-muted group-open:whitespace-normal group-open:break-words">{log.commentText}</summary></details>
                    </td>
                    <td className="px-4 py-4 sm:px-6">
                      <span className="text-muted">{log.automation.name}</span>
                    </td>
                    <td className="px-4 py-4 sm:px-6">
                      <span className="text-muted">@{log.instagramAccount.username}</span>
                    </td>
                    <td className="px-4 py-4 sm:px-6">
                      <StatusBadge status={log.status} />
                      {log.errorMessage && <details className="mt-2 max-w-xs text-xs text-error"><summary className="cursor-pointer">{t("Status")}</summary><p className="mt-2 break-words leading-5">{log.errorMessage}</p></details>}
                    </td>
                    <td className="px-4 py-4 text-muted whitespace-nowrap sm:px-6">
                      {new Date(log.createdAt).toLocaleString(locale, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 border-t border-border sm:px-6">
            <p className="text-xs text-muted">
              {t("Showing {start}–{end} of {total}", {
                start: (pagination.page - 1) * pagination.limit + 1,
                end: Math.min(pagination.page * pagination.limit, pagination.total),
                total: pagination.total,
              })}
            </p>
            <div className="flex items-center gap-2">
              <button
                disabled={loading || page <= 1}
                onClick={() => {
                  setLoading(true);
                  setPage(page - 1);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted border border-border hover:text-foreground hover:border-border-hover transition-all disabled:opacity-30 disabled:pointer-events-none"
              >
                {t("Previous")}
              </button>
              <span className="text-xs text-muted px-2">
                {page} / {pagination.totalPages}
              </span>
              <button
                disabled={loading || page >= pagination.totalPages}
                onClick={() => {
                  setLoading(true);
                  setPage(page + 1);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted border border-border hover:text-foreground hover:border-border-hover transition-all disabled:opacity-30 disabled:pointer-events-none"
              >
                {t("Next")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
