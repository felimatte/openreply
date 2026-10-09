import { getI18n } from "@/lib/i18n/server";

export default async function WorkspaceLoading() {
  const { t } = await getI18n();
  return <div role="status" aria-label={t("Loading…")} className="space-y-7"><span className="sr-only">{t("Loading…")}</span><div className="space-y-3"><div className="h-7 w-52 animate-pulse rounded-lg bg-border" /><div className="h-3 w-72 max-w-full animate-pulse rounded bg-border" /></div><div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map(item => <div key={item} className="panel space-y-5 p-6"><div className="h-3 w-20 animate-pulse rounded bg-border" /><div className="h-8 w-24 animate-pulse rounded-lg bg-border" /></div>)}</div><div className="panel h-72 animate-pulse" /></div>;
}
