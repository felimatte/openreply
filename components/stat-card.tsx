"use client";

import { useI18n } from "@/lib/i18n/provider";


/**
 * Stat Card
 *
 * Metric panel with label, value, and optional trend.
 */

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: string;
  trendUp?: boolean;
  description?: string;
}

export default function StatCard({ label, value, trend, trendUp, description }: StatCardProps) {
  const { t, locale } = useI18n();
  return (
    <div className="panel min-w-0 p-5 sm:p-6">
      <p className="text-xs font-medium text-muted sm:text-sm">{label}</p>
      <p className="mt-3 text-3xl font-semibold tabular-nums tracking-[-0.04em] text-foreground sm:text-4xl">{typeof value === "number" ? value.toLocaleString(locale) : value}</p>
      {description && <p className="mt-2 text-xs text-muted">{description}</p>}
      {trend && (
        <p className={`text-xs mt-2 ${trendUp ? "text-success" : "text-error"}`}>
          <span aria-hidden="true">{trendUp ? "↑" : "↓"}</span> {trendUp ? "" : t("Down")} {trend}
        </p>
      )}
    </div>
  );
}
