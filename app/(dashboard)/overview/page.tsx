"use client";

/**
 * Instagram Overview Page
 *
 * Aggregate reach/engagement across your recent posts, plus a per-post table.
 * Views / reach / saved / shares come from Instagram media insights (requires
 * the insights permission); likes and comments are always available.
 */

import type { Locale } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/provider";
import { useEffect, useState } from "react";
import AccountSelect from "@/components/account-select";
import StatCard from "@/components/stat-card";
import FollowerChart from "@/components/follower-chart";
import type { OverviewResponse } from "@/app/api/instagram/overview/route";

function formatNumber(n: number | null, locale: Locale): string {
  if (n === null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString(locale);
}

function formatDate(iso: string, locale: Locale): string {
  const d = new Date(iso);
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

const COUNT_OPTIONS = [
  { value: "25", label: "Last 25" },
  { value: "50", label: "Last 50" },
  { value: "100", label: "Last 100" },
  { value: "all", label: "All time" },
] as const;

export default function OverviewPage() {
  const { t, locale } = useI18n();
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState("all");
  const [count, setCount] = useState("50");
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"timestamp" | "views" | "likes" | "comments">("timestamp");

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (selectedAccountId !== "all") {
      params.set("instagramAccountId", selectedAccountId);
    }
    params.set("count", count);

    fetch(`/api/instagram/overview?${params}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((res) => {
        if (controller.signal.aborted) return;
        if (res.success) {
          setData(res.data);
          setError(null);
        } else {
          setError(res.error ?? "Failed to load overview");
        }
      })
      .catch(() => { if (!controller.signal.aborted) setError("Failed to load overview"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selectedAccountId, count, retry]);

  function handleAccountChange(accountId: string) {
    setLoading(true);
    setSelectedAccountId(accountId);
  }

  function handleCountChange(next: string) {
    setLoading(true);
    setCount(next);
  }

  if (loading && !data) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="panel rounded p-4 h-24 sm:p-5">
            <div className="h-4 w-16 bg-zinc-200 rounded" />
            <div className="mt-3 h-6 w-20 bg-zinc-200/60 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="panel p-8 text-center" role="alert">
        <p className="text-sm text-error">{error === "Failed to load overview" ? t("Failed to load overview") : error}</p>
        <button type="button" onClick={() => { setLoading(true); setRetry((value) => value + 1); }} className="mt-4 rounded-lg border border-border px-4 py-2 text-sm font-medium">{t("Try again")}</button>
        {error.includes("connect") && (
          <a
            href="/api/instagram/connect"
            className="mt-4 inline-block text-sm text-accent hover:underline"
          >
            {t("Connect Instagram")}
          </a>
        )}
      </div>
    );
  }

  if (!data) return null;

  const { totals, posts, accounts, insightsAvailable, followers, followerHistory } =
    data;
  const visiblePosts = posts
    .filter((post) => !search.trim() || (post.caption ?? "").toLowerCase().includes(search.trim().toLowerCase()))
    .toSorted((a, b) => sort === "timestamp" ? new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime() : (b[sort] ?? -1) - (a[sort] ?? -1));

  return (
    <div className="space-y-7" aria-busy={loading}>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{t("Account performance")}</h1>
          <p className="mt-2 text-sm text-muted">{t("Track your content and audience in one place.")}</p>
          <p className="text-sm text-muted mt-1">
            {data.provider !== "ZERNIO" && data.requestedCount === "all" ? t("All-time") : t("Recent")} —{" "}
            {t(totals.posts === 1 ? "{count} post" : "{count} posts", { count: totals.posts })} {t("from @")}
            {data.account.username}
            {data.truncated ? t(" (capped at {count})", { count: totals.posts }) : ""}
          </p>
          {followers !== null && (
            // Kept out of the tile row below: that row sums the selected posts,
            // whereas this is a current account-level total.
            <p className="mt-1 text-sm text-muted">
              {followers.toLocaleString(locale)} {t("followers")}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {t("Range")}
            </span>
            <select
              value={count}
              onChange={(e) => handleCountChange(e.target.value)}
              className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground"
            >
              {COUNT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(o.label)}
                </option>
              ))}
            </select>
          </label>
          {accounts.length > 1 && (
            <AccountSelect
              accounts={accounts.map((a) => ({
                id: a.id,
                username: a.username,
                instagramId: a.id,
              }))}
              value={selectedAccountId}
              onChange={handleAccountChange}
            />
          )}
        </div>
      </div>

      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-error/20 bg-error/5 p-4 text-sm text-error"><p>{error === "Failed to load overview" ? t("Failed to load overview") : error}</p><button type="button" onClick={() => { setLoading(true); setRetry((value) => value + 1); }} className="rounded-lg border border-border bg-surface px-3 py-2 text-foreground">{t("Try again")}</button></div>}
      {data.limitations?.map((note) => <p key={note} className="rounded-xl border border-border bg-surface px-4 py-3 text-xs leading-relaxed text-muted">{note}</p>)}
      {!insightsAvailable && (
        <div className="panel rounded p-4 border border-border">
          <p className="text-sm text-foreground">
            {t("Views, reach, saved and shares need the insights permission.")}
          </p>
          <p className="text-sm text-muted mt-1">
            {t("Reconnect your account to grant it — likes and comments are shown in the meantime.")}
          </p>
          <a
            href="/api/instagram/connect"
            className="mt-3 inline-block text-sm text-accent hover:underline"
          >
            {t("Reconnect Instagram")}
          </a>
        </div>
      )}

      {/* Aggregate totals */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        <StatCard label={t("Views")} value={formatNumber(totals.views, locale)} />
        <StatCard label={t("Reach")} value={formatNumber(totals.reach, locale)} />
        <StatCard label={t("Likes")} value={formatNumber(totals.likes, locale)} />
        <StatCard label={t("Comments")} value={formatNumber(totals.comments, locale)} />
        <StatCard label={t("Saved")} value={formatNumber(totals.saved, locale)} />
        <StatCard label={t("Shares")} value={formatNumber(totals.shares, locale)} />
      </div>

      {/* Follower trend — account-level, independent of the post range */}
      <FollowerChart data={followerHistory} followers={followers} />

      {/* Per-post table */}
      <div className="panel overflow-hidden p-5 sm:p-6">
        <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <h2 className="text-sm font-semibold text-foreground">{t("Posts")} <span className="ml-2 font-normal text-muted">{visiblePosts.length}</span></h2>
          <div className="flex flex-col gap-2 sm:flex-row"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} aria-label={t("Search your posts by caption…")} placeholder={t("Search your posts by caption…")} className="min-h-10 rounded-xl border border-border bg-background px-3 py-2 text-sm placeholder:text-muted" /><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label={t("Sort by")} className="min-h-10 rounded-xl border border-border bg-surface px-3 py-2 text-sm"><option value="timestamp">{t("Date")}</option><option value="views">{t("Views")}</option><option value="likes">{t("Likes")}</option><option value="comments">{t("Comments")}</option></select></div>
        </div>
        {visiblePosts.length === 0 ? (
          <p className="text-sm text-muted py-8 text-center">{t("No posts found")}</p>
        ) : (
          // Eight metric columns can't compress into a phone; let the table keep
          // its natural width and scroll inside the panel instead.
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-medium text-muted">
                  <th className="py-2 pr-4 font-medium">{t("Post")}</th>
                  <th className="py-2 px-3 font-medium text-right">{t("Views")}</th>
                  <th className="py-2 px-3 font-medium text-right">{t("Reach")}</th>
                  <th className="py-2 px-3 font-medium text-right">{t("Likes")}</th>
                  <th className="py-2 px-3 font-medium text-right">{t("Comments")}</th>
                  <th className="py-2 px-3 font-medium text-right">{t("Saved")}</th>
                  <th className="py-2 px-3 font-medium text-right">{t("Shares")}</th>
                  <th className="py-2 pl-3 font-medium text-right">{t("Date")}</th>
                </tr>
              </thead>
              <tbody>
                {visiblePosts.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-border transition-colors last:border-0 hover:bg-background"
                  >
                    <td className="py-3 pr-4 max-w-xs">
                      {p.permalink ? (
                        <a
                          href={p.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block truncate font-medium text-foreground hover:underline"
                        >
                          {p.caption || t("{type} post", { type: p.mediaType })}
                        </a>
                      ) : (
                        <span className="text-foreground truncate block">
                          {p.caption || t("{type} post", { type: p.mediaType })}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-4 text-right tabular-nums text-muted">
                      {formatNumber(p.views, locale)}
                    </td>
                    <td className="px-3 py-4 text-right tabular-nums text-muted">
                      {formatNumber(p.reach, locale)}
                    </td>
                    <td className="px-3 py-4 text-right tabular-nums text-muted">
                      {formatNumber(p.likes, locale)}
                    </td>
                    <td className="px-3 py-4 text-right tabular-nums text-muted">
                      {formatNumber(p.comments, locale)}
                    </td>
                    <td className="px-3 py-4 text-right tabular-nums text-muted">
                      {formatNumber(p.saved, locale)}
                    </td>
                    <td className="px-3 py-4 text-right tabular-nums text-muted">
                      {formatNumber(p.shares, locale)}
                    </td>
                    <td className="py-3 pl-3 text-right text-zinc-500">
                      {formatDate(p.timestamp, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
