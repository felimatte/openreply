"use client";

/**
 * Campaigns List Page
 *
 * Shows all campaigns as cards with toggle and delete.
 */

import { useI18n } from "@/lib/i18n/provider";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import AppIcon from "@/components/app-icon";

import AccountSelect, { type AccountOption } from "@/components/account-select";
import { readCache, writeCache } from "@/lib/client-cache";

interface Campaign {
  id: string;
  name: string;
  goal: string | null;
  postId: string | null;
  postUrl: string | null;
  pendingNextReel: boolean;
  matchAnyPost: boolean;
  keywords: string[];
  matchAnyWord: boolean;
  dmMessage: string;
  openingDmEnabled: boolean;
  openingDmMessage: string | null;
  openingDmButtonLabel: string | null;
  publicReplyEnabled: boolean;
  publicReplyMessage: string | null;
  publicReplyMessages: string[];
  requireFollow: boolean;
  followPromptMessage: string | null;
  followPromptButtonLabel: string | null;
  isActive: boolean;
  wholeWordMatch: boolean;
  instagramAccountId: string;
  instagramAccount: {
    username: string;
    instagramId: string;
  };
  reportShareSlug: string | null;
  reportShareEnabled: boolean;
  reportUrl: string | null;
  createdAt: string;
  _count: { dmLogs: number };
  trackedLinks: Array<{
    id: string;
    slug: string;
    label: string | null;
    destinationUrl: string;
    trackedUrl: string;
    _count: { clicks: number };
  }>;
  analytics: {
    sent: number;
    skipped: number;
    failed: number;
    clicks: number;
    ctr: number;
    topKeywords: { keyword: string; count: number }[];
  };
}

export default function CampaignsPage() {
  const { t, label, locale } = useI18n();
  const [automations, setAutomations] = useState<Campaign[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("all");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [videos, setVideos] = useState<Record<string, string>>({});
  const [playingVideo, setPlayingVideo] = useState<{ url: string; postUrl: string | null } | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "paused">("all");
  const requestVersion = useRef(0);
  const videoDialog = useRef<HTMLDialogElement>(null);

  const fetchAutomations = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedAccountId !== "all") params.set("instagramAccountId", selectedAccountId);
      const res = await fetch(`/api/automations${params.size ? `?${params}` : ""}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error("Campaigns unavailable");
      if (version === requestVersion.current) {
        setAutomations(data.data);
        setLoadError(false);
      }
    } catch {
      if (version === requestVersion.current) setLoadError(true);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/dashboard/stats", { signal: controller.signal })
      .then((res) => res.json())
      .then((payload) => { if (payload.success) setAccounts(payload.data.instagramAccounts ?? []); })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchAutomations(); }, 0);
    return () => { window.clearTimeout(timer); requestVersion.current += 1; };
  }, [fetchAutomations]);

  // Instagram media URLs expire. Refresh them for just the accounts in view.
  useEffect(() => {
    if (automations.length === 0) return;
    let cancelled = false;
    const accountIds = Array.from(new Set(automations.map((campaign) => campaign.instagramAccountId))).sort();
    const cacheKey = `ig-media:${accountIds.join(",")}`;
    const cached = readCache<{ thumbs: Record<string, string>; videos: Record<string, string> }>(cacheKey, 15 * 60 * 1000);
    const timer = window.setTimeout(() => {
      if (cached?.data) { setThumbnails(cached.data.thumbs); setVideos(cached.data.videos); }
    }, 0);
    Promise.all(accountIds.map((accountId) => fetch(`/api/instagram/posts?instagramAccountId=${accountId}&limit=50`)
      .then((res) => res.json())
      .then((payload) => payload.success ? (payload.data as { id: string; media_type?: string; media_url?: string; thumbnail_url?: string }[]) : [])
      .catch(() => []))).then((lists) => {
        if (cancelled) return;
        const thumbs: Record<string, string> = {};
        const vids: Record<string, string> = {};
        for (const list of lists) for (const media of list) {
          const url = media.thumbnail_url ?? media.media_url;
          if (url) thumbs[media.id] = url;
          if (media.media_type === "VIDEO" && media.media_url) vids[media.id] = media.media_url;
        }
        setThumbnails(thumbs); setVideos(vids);
        writeCache(cacheKey, { thumbs, videos: vids });
      });
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [automations]);

  useEffect(() => {
    if (!playingVideo) return;
    const dialog = videoDialog.current;
    const trigger = document.activeElement;
    dialog?.showModal();
    dialog?.querySelector<HTMLButtonElement>("[data-dialog-close]")?.focus();
    return () => {
      dialog?.close();
      if (trigger instanceof HTMLElement) trigger.focus();
    };
  }, [playingVideo]);

  useEffect(() => {
    if (!menuOpenId) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpenId(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menuOpenId]);

  async function toggleActive(campaign: Campaign) {
    if (busyId) return;
    setBusyId(campaign.id); setActionError(null);
    try {
      const res = await fetch(`/api/automations?id=${campaign.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !campaign.isActive }) });
      const payload = await res.json();
      if (!res.ok || !payload.success) throw new Error("Update failed");
      setAutomations((current) => current.map((item) => item.id === campaign.id ? { ...item, isActive: !campaign.isActive } : item));
    } catch { setActionError(t("Could not update this campaign. Please try again.")); }
    finally { setBusyId(null); }
  }

  async function copyReelUrl(campaign: Campaign) {
    setMenuOpenId(null);
    if (!campaign.postUrl) return;
    try {
      await navigator.clipboard.writeText(campaign.postUrl);
      setCopiedId(campaign.id);
      window.setTimeout(() => setCopiedId((current) => current === campaign.id ? null : current), 2000);
    } catch { setActionError(t("Could not copy the link. Please try again.")); }
  }

  async function deleteAutomation(id: string) {
    setMenuOpenId(null);
    if (busyId || !confirm(t("Delete this campaign? This cannot be undone."))) return;
    setBusyId(id); setActionError(null);
    try {
      const res = await fetch(`/api/automations?id=${id}`, { method: "DELETE" });
      const payload = await res.json();
      if (!res.ok || !payload.success) throw new Error("Delete failed");
      setAutomations((current) => current.filter((item) => item.id !== id));
    } catch { setActionError(t("Could not delete this campaign. Please try again.")); }
    finally { setBusyId(null); }
  }

  async function duplicateAutomation(id: string) {
    setMenuOpenId(null);
    if (busyId) return;
    setBusyId(id); setActionError(null);
    try {
      const res = await fetch(`/api/automations/duplicate?id=${id}`, { method: "POST" });
      const payload = await res.json();
      if (!res.ok || !payload.success) throw new Error("Duplicate failed");
      await fetchAutomations();
    } catch { setActionError(t("Could not duplicate this campaign. Please try again.")); }
    finally { setBusyId(null); }
  }

  const query = search.trim().toLowerCase();
  const filtered = automations.filter((campaign) => {
    if (statusFilter === "active" && !campaign.isActive) return false;
    if (statusFilter === "paused" && campaign.isActive) return false;
    return !query || campaign.name.toLowerCase().includes(query) || campaign.keywords.some((keyword) => keyword.toLowerCase().includes(query)) || campaign.dmMessage.toLowerCase().includes(query);
  });
  const activeCount = automations.filter((campaign) => campaign.isActive).length;
  const totalSent = automations.reduce((total, campaign) => total + campaign.analytics.sent, 0);
  const totalClicks = automations.reduce((total, campaign) => total + campaign.analytics.clicks, 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("Campaigns")}</h1><p className="mt-2 text-sm text-muted">{t("Manage your campaigns and see what is working.")}</p></div>
        <div className="flex items-center gap-2">
          <Link href="/campaigns/import" className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-border bg-surface px-4 text-sm font-medium transition-colors hover:bg-surface-hover sm:flex-none">{t("Import")}</Link>
          <Link href="/campaigns/new" className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover sm:flex-none"><AppIcon name="plus" className="h-4 w-4" />{t("New Campaign")}</Link>
        </div>
      </header>

      {(loadError || actionError) && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-error/20 bg-error/5 p-4 text-sm text-error"><p>{actionError ?? t("Unable to load campaigns.")}</p>{loadError && <button type="button" onClick={() => void fetchAutomations()} className="rounded-lg border border-border bg-surface px-3 py-2 font-medium text-foreground">{t("Try again")}</button>}{actionError && <button type="button" onClick={() => setActionError(null)} className="font-medium">{t("Close")}</button>}</div>}

      {(!loading || automations.length > 0) && !loadError && (
        <div className="grid grid-cols-3 gap-3 rounded-2xl border border-border bg-surface p-5 sm:gap-6 sm:p-6">
          {[{ title: t("Active Campaigns"), value: activeCount }, { title: t("DMs Sent"), value: totalSent }, { title: t("Clicks"), value: totalClicks }].map((metric) => <div key={metric.title} className="min-w-0 border-r border-border last:border-0"><p className="text-[11px] text-muted sm:text-xs">{metric.title}</p><p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl">{metric.value.toLocaleString(locale)}</p></div>)}
        </div>
      )}

      <section className="space-y-4" aria-busy={loading}>
        <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
          <div className="flex gap-1 self-start rounded-xl border border-border bg-surface p-1">
            {(["all", "active", "paused"] as const).map((status) => <button key={status} type="button" onClick={() => setStatusFilter(status)} aria-pressed={statusFilter === status} className={`inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-xs font-medium transition-colors sm:text-sm ${statusFilter === status ? "bg-accent text-white" : "text-muted hover:bg-surface-hover hover:text-foreground"}`}>{label(status)}<span className={`rounded-md px-1.5 py-0.5 text-[10px] tabular-nums ${statusFilter === status ? "bg-white/15 text-white" : "bg-surface-hover text-muted"}`}>{status === "all" ? automations.length : status === "active" ? activeCount : automations.length - activeCount}</span></button>)}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            {accounts.length > 1 && <AccountSelect accounts={accounts} value={selectedAccountId} onChange={(accountId) => { setLoading(true); setSelectedAccountId(accountId); }} />}
            <div className="relative w-full sm:w-72"><svg aria-hidden="true" className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} aria-label={t("Search campaigns by name, keyword, or message…")} placeholder={t("Search campaigns by name, keyword, or message…")} className="min-h-10 w-full rounded-xl border border-border bg-surface py-2 pl-9 pr-3 text-sm placeholder:text-muted" /></div>
          </div>
        </div>

        {loadError ? null : loading && automations.length === 0 ? <div className="space-y-3" aria-label={t("Loading…")}>{Array.from({ length: 3 }, (_, index) => <div key={index} className="panel h-36 animate-pulse" />)}</div> : !loadError && automations.length === 0 ? <div className="panel px-6 py-16 text-center"><div aria-hidden="true" className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl border border-border bg-background text-2xl text-muted"><AppIcon name="campaign" className="h-6 w-6" /></div><h2 className="text-lg font-semibold">{t("No campaigns yet")}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">{t("Create your first comment-to-DM campaign to turn a post or reel into a measurable conversation flow.")}</p><Link href="/campaigns/new" className="mt-6 inline-flex rounded-xl bg-accent px-5 py-3 text-sm font-medium text-white">{t("Create Campaign")}</Link></div> : filtered.length === 0 && !loadError ? <div className="panel px-6 py-14 text-center"><p className="text-sm text-muted">{t("No campaigns match your search.")}</p><button type="button" onClick={() => { setSearch(""); setStatusFilter("all"); }} className="mt-4 rounded-lg border border-border px-4 py-2 text-sm font-medium">{t("Clear filters")}</button></div> : (
          <div inert={loading} className={`space-y-3 transition-opacity ${loading ? "opacity-50" : ""}`}>
            <p className="px-1 text-xs text-muted" aria-live="polite">{t("{count} of {total} campaigns", { count: filtered.length, total: automations.length })}</p>
            {filtered.map((campaign) => {
              const thumbnail = campaign.postId ? thumbnails[campaign.postId] : undefined;
              const videoUrl = campaign.postId ? videos[campaign.postId] : undefined;
              const busy = busyId === campaign.id;
              return <article key={campaign.id} className="panel relative p-5 transition-colors hover:border-border-hover sm:p-6">
                <div className="flex items-start gap-4">
                  <CampaignMedia thumbnail={thumbnail} videoUrl={videoUrl} postUrl={campaign.postUrl} campaignId={campaign.id} onPlay={() => videoUrl && setPlayingVideo({ url: videoUrl, postUrl: campaign.postUrl })} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2"><Link href={`/campaigns/${campaign.id}`} className="max-w-full break-words text-base font-semibold tracking-tight hover:underline">{campaign.name}</Link><span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-medium ${campaign.isActive ? "bg-success/8 text-success" : "bg-surface-hover text-muted"}`}><span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />{campaign.isActive ? t("Active") : t("Paused")}</span></div>
                    <p className="mt-1.5 text-xs text-muted">@{campaign.instagramAccount.username}<span className="mx-2">·</span>{campaign.matchAnyPost ? t("Any post or reel") : campaign.pendingNextReel ? t("Waiting for next reel") : t("A specific post or reel")}</p>
                    <p className="mt-3 truncate text-sm text-muted">{campaign.dmMessage}</p>
                  </div>
                  <div className="relative flex shrink-0 items-center gap-2">
                    <button type="button" role="switch" aria-checked={campaign.isActive} aria-label={`${campaign.isActive ? t("Pause") : t("Resume")}: ${campaign.name}`} disabled={busyId !== null || loading} onClick={() => void toggleActive(campaign)} className="grid h-11 w-11 place-items-center rounded-lg disabled:opacity-40"><span aria-hidden="true" className={`relative h-6 w-10 rounded-full transition-colors ${campaign.isActive ? "bg-success" : "bg-zinc-300"}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${campaign.isActive ? "left-5" : "left-1"}`} /></span></button>
                    <button type="button" aria-label={`${t("More actions")}: ${campaign.name}`} aria-expanded={menuOpenId === campaign.id} disabled={busyId !== null || loading} onClick={() => setMenuOpenId((current) => current === campaign.id ? null : campaign.id)} className="grid h-11 w-11 place-items-center rounded-lg text-xl text-muted hover:bg-surface-hover hover:text-foreground disabled:opacity-40">⋯</button>
                    {menuOpenId === campaign.id && <><div className="fixed inset-0 z-10" onClick={() => setMenuOpenId(null)} /><div className="absolute right-0 top-10 z-20 w-44 rounded-xl border border-border bg-surface p-1 shadow-lg"><Link href={`/campaigns/${campaign.id}/edit`} className="block rounded-lg px-3 py-2.5 text-sm hover:bg-surface-hover">{t("Edit")}</Link>{campaign.postUrl && <button type="button" onClick={() => void copyReelUrl(campaign)} className="block w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-surface-hover">{t("Copy URL")}</button>}<button type="button" onClick={() => void duplicateAutomation(campaign.id)} className="block w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-surface-hover">{t("Duplicate")}</button><div className="my-1 border-t border-border" /><button type="button" onClick={() => void deleteAutomation(campaign.id)} className="block w-full rounded-lg px-3 py-2.5 text-left text-sm text-error hover:bg-error/5">{t("Delete")}</button></div></>}
                  </div>
                </div>
                <div className="mt-5 flex flex-col justify-between gap-4 border-t border-border pt-4 lg:flex-row lg:items-center">
                  <div className="flex min-w-0 flex-wrap gap-1.5">{campaign.matchAnyWord ? <span className="rounded-md bg-surface-hover px-2 py-1 text-[11px] text-muted">{t("Any comment")}</span> : campaign.keywords.slice(0, 5).map((keyword) => <span key={keyword} className="max-w-40 truncate rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-muted">{keyword}</span>)}{campaign.keywords.length > 5 && <span className="px-1 py-1 text-[11px] text-muted">+{campaign.keywords.length - 5}</span>}{campaign.requireFollow && <span className="rounded-md bg-surface-hover px-2 py-1 text-[11px] text-muted">{t("Follow gate")}</span>}</div>
                  <dl className="flex shrink-0 items-center gap-5 text-xs sm:gap-7">{[{ name: t("sent"), value: campaign.analytics.sent.toLocaleString(locale) }, { name: t("clicks"), value: campaign.analytics.clicks.toLocaleString(locale) }, { name: t("CTR"), value: `${campaign.analytics.ctr}%` }].map((metric) => <div key={metric.name} className="flex items-baseline gap-1.5"><dd className="font-semibold tabular-nums text-foreground">{metric.value}</dd><dt className="text-muted">{metric.name}</dt></div>)}<Link href={`/campaigns/${campaign.id}`} aria-label={`${t("Insights")}: ${campaign.name}`} className="ml-auto text-lg text-muted hover:text-foreground">→</Link></dl>
                </div>
                {(busy || copiedId === campaign.id) && <p role="status" className="mt-3 text-xs text-muted">{busy ? t("Loading…") : t("Copied!")}</p>}
              </article>;
            })}
          </div>
        )}
      </section>

      {playingVideo && <dialog ref={videoDialog} onCancel={() => setPlayingVideo(null)} onClose={() => setPlayingVideo(null)} onClick={(event) => { if (event.target === event.currentTarget) setPlayingVideo(null); }} aria-label={t("Play reel preview")} className="fixed inset-0 m-auto max-h-[94dvh] max-w-[94vw] rounded-2xl bg-surface p-4 text-foreground shadow-xl backdrop:bg-black/70"><div className="mb-3 flex items-center justify-between gap-6 text-sm">{playingVideo.postUrl && <a href={playingVideo.postUrl} target="_blank" rel="noreferrer" className="text-muted hover:text-foreground">{t("Open on Instagram")} ↗</a>}<button type="button" data-dialog-close onClick={() => setPlayingVideo(null)} className="ml-auto rounded-lg border border-border px-3 py-1.5">{t("Close")}</button></div><video src={playingVideo.url} controls autoPlay loop playsInline className="max-h-[78dvh] max-w-full rounded-lg" /></dialog>}
    </div>
  );
}

function CampaignMedia({ thumbnail, videoUrl, postUrl, campaignId, onPlay }: {
  thumbnail?: string;
  videoUrl?: string;
  postUrl: string | null;
  campaignId: string;
  onPlay: () => void;
}) {
  const { t } = useI18n();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!thumbnail || thumbnail === failedUrl) return <div aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-border bg-background text-muted"><AppIcon name="campaign" className="h-5 w-5" /></div>;
  const media = (
    <>
      {/* Instagram URLs expire and cannot use the image optimizer cache. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={thumbnail} alt={t("Campaign post")} onError={() => setFailedUrl(thumbnail)} className="h-full w-full object-cover" />
      {videoUrl && <span className="absolute inset-0 grid place-items-center bg-black/15 text-white" aria-hidden="true">▶</span>}
    </>
  );
  const className = "relative h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-surface-hover sm:h-20 sm:w-16";
  return videoUrl ? <button type="button" onClick={onPlay} aria-label={t("Play reel preview")} className={className}>{media}</button> : postUrl ? <a href={postUrl} target="_blank" rel="noreferrer" aria-label={t("Open on Instagram")} className={className}>{media}</a> : <Link href={`/campaigns/${campaignId}`} className={className}>{media}</Link>;
}
