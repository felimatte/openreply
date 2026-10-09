"use client";

import LanguageSwitcher from "@/components/language-switcher";
import { useI18n } from "@/lib/i18n/provider";
import { Suspense, useEffect, useState } from "react";
import type { AccountOption } from "@/components/account-select";
import { ZernioConnection } from "@/components/zernio-connection";
import { InstagramConnectNotice } from "@/components/instagram-connect-notice";
import { ContactSyncSettings } from "@/components/contact-sync-settings";

interface SettingsData {
  workspace: {
    name: string;
    dmsSentThisPeriod: number;
  };
  instagramAccount: {
    id: string;
    username: string;
    instagramId: string;
    tokenExpiresAt: string | null;
    webhookSubscribed: boolean;
  } | null;
  instagramAccounts: Array<
    AccountOption & {
      provider?: "META" | "ZERNIO";
      tokenExpiresAt: string | null;
      webhookSubscribed: boolean;
    }
  >;
}

interface WorkspaceMembersData {
  currentUserRole: "OWNER" | "ADMIN" | "MEMBER";
  members: Array<{
    id: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
    createdAt: string;
    user: {
      id: string;
      email: string | null;
      name: string | null;
    };
  }>;
  invitations: Array<{
    id: string;
    email: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
    inviteUrl: string;
    expiresAt: string;
  }>;
}

export default function SettingsPage() {
  const { t, label, locale } = useI18n();
  const [data, setData] = useState<SettingsData | null>(null);
  const [membersData, setMembersData] = useState<WorkspaceMembersData | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [memberError, setMemberError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedInvite, setCopiedInvite] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/dashboard/stats").then((res) => res.json()),
      fetch("/api/workspace/members").then((res) => res.json()),
    ])
      .then(([statsPayload, membersPayload]) => {
        if (statsPayload.success) setData(statsPayload.data);
        else setError(statsPayload.error ?? t("Something went wrong. Try again."));
        if (membersPayload.success) setMembersData(membersPayload.data);
        else setError(membersPayload.error ?? t("Something went wrong. Try again."));
      })
      .catch(() => setError(t("Something went wrong. Try again.")))
      .finally(() => setLoading(false));
  }, [t]);

  async function refreshMembers() {
    const res = await fetch("/api/workspace/members");
    const payload = await res.json();
    if (payload.success) setMembersData(payload.data);
  }

  async function disconnectInstagram(instagramAccountId: string) {
    if (!confirm(t("Disconnect Instagram? Campaigns for this account will stop sending DMs."))) {
      return;
    }

    setBusy(`disconnect:${instagramAccountId}`);
    setError(null);
    try {
      const response = await fetch("/api/instagram/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instagramAccountId }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error ?? t("Could not update connection."));
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Could not update connection."));
      setBusy(null);
    }
  }

  async function inviteMember(event: React.FormEvent) {
    event.preventDefault();
    setMemberError(null);
    setBusy("invite");
    try {
      const res = await fetch("/api/workspace/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const payload = await res.json();
      if (payload.success) {
        setMembersData(payload.data);
        setInviteEmail("");
      } else {
        setMemberError(payload.error ?? t("Could not invite member"));
      }
    } catch {
      setMemberError(t("Could not invite member"));
    } finally {
      setBusy(null);
    }
  }

  async function removeInvitation(invitationId: string) {
    setBusy(`invite:${invitationId}`);
    setMemberError(null);
    try {
      const response = await fetch("/api/workspace/members", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invitationId }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error ?? t("Something went wrong. Try again."));
      await refreshMembers();
    } catch (cause) {
      setMemberError(cause instanceof Error ? cause.message : t("Something went wrong. Try again."));
    } finally {
      setBusy(null);
    }
  }

  async function copyInvitation(id: string, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedInvite(id);
      window.setTimeout(() => setCopiedInvite(null), 2000);
    } catch {
      setMemberError(t("Something went wrong. Try again."));
    }
  }

  if (loading) {
    return <div aria-label={t("Loading…")} className="mx-auto max-w-5xl space-y-6"><div className="h-9 w-48 animate-pulse rounded-lg bg-surface-hover"/><div className="grid gap-6 md:grid-cols-[180px_1fr]"><div className="h-64 animate-pulse rounded-2xl bg-surface-hover"/><div className="h-96 animate-pulse rounded-2xl bg-surface-hover"/></div></div>;
  }

  const accounts = data?.instagramAccounts ?? [];
  const canManageMembers =
    membersData?.currentUserRole === "OWNER" ||
    membersData?.currentUserRole === "ADMIN";

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div><h1 className="text-3xl font-semibold tracking-tight">{t("Settings")}</h1><p className="mt-2 text-sm text-muted">{t("Manage your workspace, connections and team.")}</p></div>
      {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-error/20 bg-error/5 p-4 text-sm text-error"><span>{error}</span><button className="shrink-0 font-semibold underline" onClick={() => window.location.reload()}>{t("Try again")}</button></div>}
      <div className="grid items-start gap-6 lg:grid-cols-[180px_minmax(0,1fr)]">
      <nav aria-label={t("Settings")} className="sticky top-0 z-10 flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-2 lg:top-8 lg:flex-col lg:border-0 lg:bg-transparent lg:p-0">
        {([
          ["connections", "Instagram Connection"],
          ["google-sheets", "Google Sheets"],
          ["team", "Team"],
          ["preferences", "Preferences"],
          ["usage", "Usage"],
        ] as const).map(([id, title]) => <a key={id} href={`#${id}`} className="shrink-0 rounded-lg px-3 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground">{t(title)}</a>)}
      </nav>
      <div className="min-w-0 space-y-6">
      {/* Surfaces the ?instagram= code the OAuth routes redirect back with.
          Needs a Suspense boundary: useSearchParams in a prerendered client
          page fails the production build without one. */}
      <Suspense fallback={null}>
        <InstagramConnectNotice />
      </Suspense>

      <section id="connections" className="panel scroll-mt-24 rounded-2xl p-5 sm:p-7">
        <h2 className="text-base font-semibold mb-6">{t("Instagram Connection")}</h2>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 py-3 border-b border-border">
            <div>
              <p className="text-sm font-medium text-foreground">{t("Status")}</p>
              <p className="text-xs text-muted mt-0.5">
                {t("Comment webhooks and private replies depend on this connection.")}
              </p>
            </div>
            <span
              className={`px-3 py-1.5 rounded-full text-xs font-medium ${
                accounts.length > 0
                  ? "bg-success/10 text-success"
                  : "bg-warning/10 text-warning"
              }`}
            >
              {accounts.length > 0 ? t("Connected") : t("Not connected")}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 py-3 border-b border-border">
            <div>
              <p className="text-sm font-medium text-foreground">{t("Accounts")}</p>
              <p className="text-xs text-muted mt-0.5">
                {t(accounts.length === 1 ? "{count} connected Instagram profile" : "{count} connected Instagram profiles", { count: accounts.length })}
              </p>
            </div>
            <span className="text-sm text-muted">
              {accounts.length > 0 ? t("{count} connected", { count: accounts.length }) : t("None")}
            </span>
          </div>

          <div className="space-y-3 py-3">
            {accounts.length === 0 && (
              <p className="text-sm text-muted">
                {t("Connect an Instagram professional account to launch campaigns.")}
              </p>
            )}
            {accounts.map((account) => (
              <div
                key={account.id}
                className="flex flex-col gap-4 rounded-xl border border-border bg-background/60 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    @{account.username}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {account.provider === "ZERNIO" ? t("Connected via Zernio") : <>{t("Token expires")}{" "}
                    {account.tokenExpiresAt
                      ? new Date(account.tokenExpiresAt).toLocaleDateString(locale)
                      : t("not available")}</>}{" "}
                    · {account.webhookSubscribed ? t("Webhook ready") : t("Webhook pending")}
                  </p>
                </div>
                <button
                  onClick={() => disconnectInstagram(account.id)}
                  disabled={busy === `disconnect:${account.id}`}
                  className="inline-flex self-start items-center justify-center rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted transition-colors hover:border-error/30 hover:bg-error/5 hover:text-error disabled:opacity-50 sm:self-auto"
                >
                  {busy === `disconnect:${account.id}`
                    ? t("Disconnecting...")
                    : t("Disconnect")}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3 border-t border-border pt-5">
          <a
            href="/api/instagram/connect"
            className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            {t("Connect using your own Meta app")}
          </a>
        </div>
      </section>

      <details className="group rounded-2xl border border-border bg-surface">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5 text-sm font-medium"><span>{t("Easier Instagram setup")} <span className="ml-2 text-xs font-normal text-muted">{t("Optional connection provider")}</span></span><span aria-hidden="true" className="text-muted transition-transform group-open:rotate-45">+</span></summary>
        <div className="border-t border-border"><ZernioConnection canManage={canManageMembers} /></div>
      </details>

      <ContactSyncSettings canManage={canManageMembers} />

      <section id="team" className="panel scroll-mt-24 rounded-2xl p-5 sm:p-7">
        <h2 className="text-base font-semibold mb-6">{t("Team")}</h2>
        <div className="space-y-3">
          {membersData?.members.map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-0"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {member.user.name ?? member.user.email ?? t("Unknown member")}
                </p>
                <p className="text-xs text-muted">{member.user.email}</p>
              </div>
              <span className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted">
                {label(member.role)}
              </span>
            </div>
          ))}
        </div>

        {membersData?.invitations.length ? (
          <div className="mt-6 border-t border-border pt-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {t("Pending invites")}
            </p>
            <div className="space-y-3">
              {membersData.invitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="flex flex-col gap-3 rounded border border-border bg-surface/70 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {invitation.email}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {label(invitation.role)} · {invitation.inviteUrl}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void copyInvitation(invitation.id, invitation.inviteUrl)}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-border-hover hover:text-foreground"
                    >
                      {copiedInvite === invitation.id ? t("Copied") : t("Copy")}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeInvitation(invitation.id)}
                      disabled={busy === `invite:${invitation.id}`}
                      className="rounded-lg border border-error/20 px-3 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                    >
                      {t("Revoke")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {canManageMembers && (
          <form
            onSubmit={inviteMember}
            className="mt-6 grid gap-3 border-t border-border pt-4 sm:grid-cols-[1fr_140px_auto]"
          >
            <input
              type="email"
              aria-label={t("Email")}
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="teammate@agency.com"
              className="rounded border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40"
              required
            />
            <select
              aria-label={t("Role")}
              value={inviteRole}
              onChange={(event) =>
                setInviteRole(event.target.value as "ADMIN" | "MEMBER")
              }
              className="rounded border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40"
            >
              <option value="MEMBER">{t("Member")}</option>
              <option value="ADMIN">{t("Admin")}</option>
            </select>
            <button
              type="submit"
              disabled={busy !== null}
              className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {busy === "invite" ? t("Inviting...") : t("Invite")}
            </button>
            {memberError && (
              <p role="alert" className="sm:col-span-3 text-sm text-error">{memberError}</p>
            )}
          </form>
        )}
      </section>

      <section id="preferences" className="panel scroll-mt-24 space-y-4 rounded-2xl p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-4"><h2 className="text-base font-semibold">{t("Interface language")}</h2><LanguageSwitcher /></div>
        <p className="text-sm text-muted">{t("Saved in this browser. Campaign messages stay unchanged.")}</p>
      </section>

      <section id="usage" className="panel scroll-mt-24 rounded-2xl p-5 sm:p-7">
        <h2 className="text-base font-semibold mb-6">{t("Usage")}</h2>
        <div className="flex items-center justify-between gap-3 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">
              {t("DMs sent this month")}
            </p>
            <p className="text-xs text-muted mt-0.5">
              {t("Self-hosted — no plan limits.")}
            </p>
          </div>
          <span className="text-sm font-semibold text-foreground">
            {data?.workspace.dmsSentThisPeriod ?? 0}
          </span>
        </div>
      </section>
      </div>
      </div>
    </div>
  );
}
