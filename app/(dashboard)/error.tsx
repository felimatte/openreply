"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/provider";
import AppIcon from "@/components/app-icon";

export default function WorkspaceError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const { t } = useI18n();
  return <section role="alert" className="panel mx-auto mt-12 max-w-lg px-6 py-12 text-center"><span className="mx-auto mb-5 flex size-12 items-center justify-center rounded-2xl bg-surface-hover text-muted"><AppIcon name="activity" className="size-6" /></span><h1 className="text-xl font-semibold tracking-tight">{t("We could not load this page.")}</h1><p className="mt-3 text-sm text-muted">{t("Please try again or return to your dashboard.")}</p><div className="mt-7 flex flex-wrap items-center justify-center gap-3"><button type="button" onClick={retry} className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover">{t("Try again")}</button><Link href="/dashboard" className="rounded-lg border border-border px-4 py-2.5 text-sm hover:bg-surface-hover">{t("Back to dashboard")}</Link></div></section>;
}
