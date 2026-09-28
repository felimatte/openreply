import type { Metadata } from "next";
import DashboardShell from "@/components/dashboard-shell";
import StatCard from "@/components/stat-card";
import { I18nProvider } from "@/lib/i18n/provider";

export const metadata: Metadata = {
  title: "OpenReply — Demo dashboard",
  robots: { index: false, follow: false },
};

const week = [
  { day: "Mon", value: 1120 },
  { day: "Tue", value: 1320 },
  { day: "Wed", value: 1490 },
  { day: "Thu", value: 1780 },
  { day: "Fri", value: 2050 },
  { day: "Sat", value: 2240 },
  { day: "Sun", value: 1880 },
];

const keywords = [
  { label: "GUIA", count: "4,280", width: "94%", color: "from-accent to-hotpink" },
  { label: "LINK", count: "3,640", width: "80%", color: "from-hotpink to-electric" },
  { label: "PRECIO", count: "2,150", width: "57%", color: "from-electric to-[#65d7ff]" },
  { label: "CURSO", count: "1,670", width: "43%", color: "from-[#65d7ff] to-[#79f0ca]" },
  { label: "LISTA", count: "1,094", width: "31%", color: "from-[#79f0ca] to-[#ddff75]" },
];

const campaigns = [
  { name: "Guía de automatización", trigger: "GUIA", sent: "5,284", ctr: "23.6%", width: "82%", tone: "from-accent to-hotpink" },
  { name: "Clase gratis de IA", trigger: "MASTERCLASS", sent: "3,716", ctr: "31.4%", width: "67%", tone: "from-hotpink to-electric" },
  { name: "Precio del programa", trigger: "PRECIO", sent: "2,842", ctr: "18.1%", width: "49%", tone: "from-electric to-[#65d7ff]" },
];

const activity = [
  { initials: "SM", name: "@sofia.mkt", keyword: "GUIA", time: "12 sec ago", color: "from-hotpink to-accent" },
  { initials: "LB", name: "@lucas.builds", keyword: "LINK", time: "1 min ago", color: "from-electric to-hotpink" },
  { initials: "MC", name: "@maria.crea", keyword: "PRECIO", time: "4 min ago", color: "from-[#65d7ff] to-electric" },
  { initials: "SE", name: "@sofia.enfoco", keyword: "MASTERCLASS", time: "8 min ago", color: "from-[#79f0ca] to-[#65d7ff]" },
];

function DemoDashboard() {
  const maxValue = Math.max(...week.map((item) => item.value));

  return (
    <div className="space-y-5 sm:space-y-7">
      <div className="demo-banner relative overflow-hidden rounded-2xl border border-hotpink/40 bg-gradient-to-r from-hotpink/15 via-accent/10 to-electric/15 p-4 shadow-[0_0_42px_rgba(255,62,146,0.12)] sm:p-5">
        <div className="pointer-events-none absolute -right-8 -top-14 size-40 rounded-full bg-hotpink/20 blur-3xl" />
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-hotpink">Demo visual · sample account</p>
            <h2 className="mt-1 text-base font-bold text-white sm:text-lg">Cifras ficticias para mostrar el panel</h2>
            <p className="mt-1 text-xs text-muted">No representan actividad real ni cambian tus campañas.</p>
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-hotpink/30 bg-black/30 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-white">
            <span className="size-2 animate-pulse rounded-full bg-[#a2e79a] shadow-[0_0_12px_#a2e79a]" />
            Live preview
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-hotpink">
            <span className="h-px w-6 bg-gradient-to-r from-accent to-hotpink" />
            Felimattee creator system
          </p>
          <h1 className="bg-gradient-to-r from-white via-[#ffe5dc] to-accent bg-clip-text text-3xl font-black tracking-tight text-transparent sm:text-4xl">
            Instagram, en movimiento.
          </h1>
          <p className="mt-1 text-sm text-muted">Un vistazo a los últimos 30 días de conversaciones automatizadas.</p>
        </div>
        <span className="w-fit rounded-lg border border-border bg-surface/80 px-3 py-2 font-mono text-xs text-muted">ÚLTIMOS 30 DÍAS</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Active campaigns" value="12" trend="3 new this month" trendUp />
        <StatCard label="DMs sent" value="18,426" trend="32% vs last month" trendUp />
        <StatCard label="Skipped" value="73" />
        <StatCard label="Failed" value="8" />
        <StatCard label="Link clicks" value="3,284" trend="24% vs last month" trendUp />
        <StatCard label="Click-through rate" value="17.8%" trend="4.2 pts vs last month" trendUp />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12 sm:gap-5">
        <section className="panel relative overflow-hidden p-4 sm:p-6 xl:col-span-7" aria-labelledby="demo-week-title">
          <div className="absolute -right-12 -top-14 size-44 rounded-full bg-electric/10 blur-3xl" />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Conversation volume</p>
              <h2 id="demo-week-title" className="mt-1 text-sm font-bold text-foreground">DMs — last 7 days</h2>
            </div>
            <span className="rounded-full border border-success/25 bg-success/10 px-2.5 py-1 font-mono text-[10px] font-semibold text-success">↑ 28.4%</span>
          </div>
          <div className="relative mt-7 flex h-44 items-end gap-2 sm:h-52 sm:gap-3">
            {week.map((item, index) => (
              <div key={item.day} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
                <span className="font-mono text-[9px] text-muted sm:text-[10px]">{item.value.toLocaleString("en-US")}</span>
                <div className="flex h-[78%] w-full items-end">
                  <div
                    className={`demo-bar w-full rounded-t-md bg-gradient-to-t ${index === 5 ? "from-hotpink via-accent to-[#ffd166]" : "from-electric via-hotpink to-accent"}`}
                    style={{ height: `${Math.max((item.value / maxValue) * 100, 8)}%`, animationDelay: `${index * 70}ms` }}
                  />
                </div>
                <span className="font-mono text-[9px] uppercase tracking-wide text-muted sm:text-[10px]">{item.day}</span>
              </div>
            ))}
          </div>
          <div className="relative mt-4 flex items-center gap-2 border-t border-white/10 pt-3 text-[10px] text-muted">
            <span className="size-2 rounded-full bg-gradient-to-r from-hotpink to-electric shadow-[0_0_10px_rgba(255,62,146,0.75)]" />
            Automated private replies sent from Instagram comments and DMs
          </div>
        </section>

        <section className="panel p-4 sm:p-6 xl:col-span-2" aria-labelledby="demo-keywords-title">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">What people ask for</p>
              <h2 id="demo-keywords-title" className="mt-1 text-sm font-bold text-foreground">Top keywords</h2>
            </div>
            <span className="text-xl" aria-hidden="true">✳</span>
          </div>
          <div className="mt-5 space-y-4">
            {keywords.map((keyword, index) => (
              <div key={keyword.label}>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] font-bold tracking-[0.12em] text-foreground">{keyword.label}</span>
                  <span className="font-mono text-[10px] text-muted">{keyword.count}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                  <div className={`demo-bar h-full rounded-full bg-gradient-to-r ${keyword.color}`} style={{ width: keyword.width, animationDelay: `${index * 90}ms` }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel p-4 sm:p-6 xl:col-span-3" aria-labelledby="demo-activity-title">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Happening right now</p>
              <h2 id="demo-activity-title" className="mt-1 text-sm font-bold text-foreground">Recent activity</h2>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-success">
              <span className="size-1.5 animate-pulse rounded-full bg-success" /> Active
            </span>
          </div>
          <div className="mt-4 space-y-1">
            {activity.map((item) => (
              <div key={item.name} className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition hover:bg-white/[0.04]">
                <span className={`flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${item.color} text-[10px] font-black text-[#180d14] shadow-[0_0_14px_rgba(255,62,146,0.18)]`}>{item.initials}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-foreground">{item.name}</p>
                  <p className="mt-0.5 truncate text-[10px] text-muted">Commented <span className="font-mono font-bold text-hotpink">{item.keyword}</span></p>
                </div>
                <div className="shrink-0 text-right">
                  <span className="block text-[9px] text-muted">{item.time}</span>
                  <span className="mt-1 inline-flex items-center gap-1 text-[9px] font-semibold text-success"><span>✓</span> Sent</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section aria-labelledby="demo-campaigns-title">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Your best performers</p>
            <h2 id="demo-campaigns-title" className="mt-1 text-base font-bold text-foreground">Campaigns driving the clicks</h2>
          </div>
          <span className="hidden font-mono text-[10px] uppercase tracking-wide text-muted sm:block">Ranked by DMs sent</span>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 sm:gap-4">
          {campaigns.map((campaign, index) => (
            <article key={campaign.name} className="panel relative overflow-hidden p-4 sm:p-5">
              <span className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${campaign.tone}`} />
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] font-mono text-xs font-bold text-accent">0{index + 1}</span>
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-foreground">{campaign.name}</h3>
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">Keyword · {campaign.trigger}</p>
                  </div>
                </div>
                <span className="rounded-md bg-success/10 px-2 py-1 font-mono text-[10px] font-bold text-success">{campaign.ctr}</span>
              </div>
              <div className="mt-5 flex items-end justify-between">
                <div><p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted">DMs delivered</p><p className="mt-1 text-xl font-bold tabular-nums text-foreground">{campaign.sent}</p></div>
                <p className="font-mono text-[10px] text-muted">click-through</p>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.07]"><div className={`demo-bar h-full rounded-full bg-gradient-to-r ${campaign.tone}`} style={{ width: campaign.width, animationDelay: `${index * 120}ms` }} /></div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function DemoPage() {
  return (
    <I18nProvider locale="en">
      <DashboardShell
        workspaceName="Felimattee Studio"
        profileImage={null}
        avatarEditable={false}
        instagramUsername="felimattee"
        instagramAccountCount={3}
      >
        <DemoDashboard />
      </DashboardShell>
    </I18nProvider>
  );
}
