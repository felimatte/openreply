"use client";

import { useI18n } from "@/lib/i18n/provider";
import { useEffect, useState } from "react";
import StatusBadge from "@/components/status-badge";

interface DiagnosticsData {
  queueCounts: Record<string, number>;
  workerHealth: {
    healthy: boolean;
    ageMs: number | null;
    heartbeat: {
      checkedAt: string;
      hostname?: string;
      pid: number;
      startedAt?: string;
    } | null;
  };
  workerAlerts: Array<{
    level: string;
    message: string;
    jobId?: string;
    commentId?: string;
    createdAt: string;
  }>;
  webhookFailures: Array<{
    id: string;
    object: string | null;
    errorMessage: string | null;
    createdAt: string;
  }>;
  dmFailures: Array<{
    id: string;
    status: string;
    commentId: string;
    commentText: string;
    errorMessage: string | null;
    updatedAt: string;
    automation: { name: string };
  }>;
  tokenRefreshFailures: Array<{
    id: string;
    message: string;
    createdAt: string;
  }>;
  operationalEvents: Array<{
    id: string;
    source: string;
    level: string;
    message: string;
    createdAt: string;
    resolvedAt: string | null;
  }>;
}

function formatDate(value: string, locale: string) {
  return new Date(value).toLocaleString(locale);
}

function EmptyState({ label }: { label: string }) {
  return <p className="flex items-center gap-3 rounded-xl bg-background/70 px-4 py-5 text-sm text-muted"><span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">✓</span>{label}</p>;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel rounded-2xl p-5 sm:p-6">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function DiagnosticsPage() {
  const { t, label, locale } = useI18n();
  const [data, setData] = useState<DiagnosticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refreshDiagnostics() {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/diagnostics");
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error ?? t("Something went wrong. Try again."));
      setData(payload.data); setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Something went wrong. Try again."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function loadInitialDiagnostics() {
      try {
        const response = await fetch("/api/admin/diagnostics");
        const payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.error ?? t("Something went wrong. Try again."));
        if (active) setData(payload.data);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : t("Something went wrong. Try again."));
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadInitialDiagnostics();

    return () => {
      active = false;
    };
  }, [t]);

  if (loading && !data) {
    return <div aria-label={t("Loading…")} className="mx-auto max-w-5xl space-y-6"><div className="h-9 w-64 animate-pulse rounded-lg bg-surface-hover"/><div className="h-40 animate-pulse rounded-2xl bg-surface-hover"/><div className="h-64 animate-pulse rounded-2xl bg-surface-hover"/></div>;
  }

  const workerAgeSeconds =
    data?.workerHealth.ageMs == null
      ? null
      : Math.round(data.workerHealth.ageMs / 1000);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            {t("Production Diagnostics")}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {t("Health, queues, webhook failures, billing events, and worker alerts.")}
          </p>
        </div>
        <button
          onClick={() => void refreshDiagnostics()}
          disabled={loading}
          className="rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium text-foreground transition hover:border-border-hover disabled:opacity-40"
        >
          {loading ? t("Loading…") : t("Refresh")}
        </button>
      </div>

      {error && <div role="alert" className="rounded-xl border border-error/20 bg-error/5 p-4 text-sm text-error">{error}</div>}

      {data && <>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <div className="panel col-span-2 rounded-2xl p-4 sm:p-5 lg:col-span-1">
          <p className="text-xs font-semibold uppercase text-muted">
            {t("Worker health")}
          </p>
          <p
            className={`mt-3 text-2xl font-bold ${
              data?.workerHealth.healthy ? "text-success" : "text-warning"
            }`}
          >
            {data?.workerHealth.healthy ? t("Healthy") : t("Needs attention")}
          </p>
          <p className="mt-2 text-xs text-muted">
            {workerAgeSeconds == null
              ? t("No heartbeat found")
              : t("Last heartbeat {seconds}s ago", { seconds: workerAgeSeconds })}
          </p>
        </div>
        {["waiting", "active", "delayed", "failed"].map((key) => (
          <div key={key} className="panel rounded-2xl p-4 sm:p-5">
            <p className="text-xs font-semibold uppercase text-muted">
              {t("Queue")} {label(key)}
            </p>
            <p className="mt-3 text-2xl font-bold text-foreground">
              {data?.queueCounts[key] ?? 0}
            </p>
          </div>
        ))}
      </div>

      <Section title={t("Recent Worker Alerts")}>
        {data?.workerAlerts.length ? (
          <div className="space-y-3">
            {data.workerAlerts.map((alert) => (
              <div
                key={`${alert.createdAt}-${alert.jobId ?? alert.message}`}
                className="rounded border border-border bg-surface/50 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                  <p className="min-w-0 flex-1 break-words text-sm font-semibold text-foreground">
                    {alert.message}
                  </p>
                  <span className="shrink-0 rounded-full bg-error/10 px-2 py-1 text-xs font-semibold text-error">
                    {alert.level}
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted">
                  {formatDate(alert.createdAt, locale)}
                  {alert.commentId ? ` · ${alert.commentId}` : ""}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState label={t("No worker alerts recorded.")} />
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={t("Campaign DM Failures And Skips")}>
          {data?.dmFailures.length ? (
            <div className="space-y-3">
              {data.dmFailures.map((item) => (
                <div key={item.id} className="border-b border-border pb-3 last:border-0">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                      {item.automation.name}
                    </p>
                    <StatusBadge status={item.status} />
                  </div>
                  <p className="mt-1 truncate text-xs text-muted">
                    {item.commentText}
                  </p>
                  {item.errorMessage && (
                    <p className="mt-1 text-xs text-error">{item.errorMessage}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState label={t("No DM failures or skips.")} />
          )}
        </Section>

        <Section title={t("Webhook Failures")}>
          {data?.webhookFailures.length ? (
            <div className="space-y-3">
              {data.webhookFailures.map((event) => (
                <div key={event.id} className="border-b border-border pb-3 last:border-0">
                  <p className="text-sm font-semibold text-foreground">
                    {event.object ?? t("Instagram webhook")}
                  </p>
                  <p className="mt-1 text-xs text-error">
                    {event.errorMessage ?? t("Unknown error")}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {formatDate(event.createdAt, locale)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState label={t("No failed webhook events.")} />
          )}
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={t("Token Refresh Failures")}>
          {data?.tokenRefreshFailures.length ? (
            <div className="space-y-3">
              {data.tokenRefreshFailures.map((event) => (
                <div key={event.id} className="border-b border-border pb-3 last:border-0">
                  <p className="text-sm font-semibold text-foreground">
                    {event.message}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {formatDate(event.createdAt, locale)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState label={t("No token refresh failures.")} />
          )}
        </Section>

      </div>

      <Section title={t("Operational Event Timeline")}>
        {data?.operationalEvents.length ? (
          <div className="space-y-3">
            {data.operationalEvents.map((event) => (
              <div key={event.id} className="grid gap-2 border-b border-border pb-3 last:border-0 sm:grid-cols-[140px_1fr_auto]">
                <p className="text-xs font-semibold text-muted">{event.source}</p>
                <p className="text-sm text-foreground">{event.message}</p>
                <p className="text-xs text-muted">{formatDate(event.createdAt, locale)}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState label={t("No operational events recorded.")} />
        )}
      </Section>
      </>}
    </div>
  );
}
