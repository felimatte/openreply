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
}

export default function StatCard({ label, value, trend, trendUp }: StatCardProps) {
  const { t } = useI18n();
  return (
    <div className="panel group relative overflow-hidden p-4 sm:p-5">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/70 to-transparent opacity-60" />
      <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-foreground sm:text-3xl">{value}</p>
      {trend && (
        <p className={`text-xs mt-1 ${trendUp ? "text-success" : "text-error"}`}>
          {trendUp ? "Up" : t("Down")} {trend}
        </p>
      )}
    </div>
  );
}
