"use client";

import type { StaticMessageKey } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/provider";
/**
 * Compact status label with both a written state and a visual marker.
 */

const statusConfig: Record<string, { text: string; label: StaticMessageKey }> = {
  SENT: { text: "text-success", label: "Sent" },
  FAILED: { text: "text-error", label: "Failed" },
  PENDING: { text: "text-warning", label: "Pending" },
  SKIPPED_DEDUP: { text: "text-muted", label: "Dedup" },
  SKIPPED_RATE_LIMIT: { text: "text-warning", label: "Rate limited" },
  SKIPPED_PLAN_LIMIT: { text: "text-warning", label: "Skipped" },
  SKIPPED_NO_MATCH: { text: "text-muted", label: "No match" },
};

interface StatusBadgeProps {
  status: string;
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const { t } = useI18n();
  const config = statusConfig[status] ?? statusConfig.PENDING;

  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-current/5 px-2 py-1 text-xs font-medium ${config.text}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {t(config.label)}
    </span>
  );
}
