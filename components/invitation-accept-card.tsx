"use client";

import { useI18n } from "@/lib/i18n/provider";
import { useState } from "react";
import Link from "next/link";

interface InvitationAcceptCardProps {
  token: string;
  matchingSession: boolean;
  accepted: boolean;
  invitedEmail: string;
}

export default function InvitationAcceptCard({
  token,
  matchingSession,
  accepted,
  invitedEmail,
}: InvitationAcceptCardProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function acceptInvite() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/workspace/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const payload = await response.json();
      if (response.ok && payload.success) {
        // The dashboard must initialize its request scope with the new workspace cookie.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/dashboard");
        return;
      }
      setMessage(payload.error ?? t("Could not accept invitation"));
    } catch {
      setMessage(t("Could not accept invitation"));
    } finally {
      setBusy(false);
    }
  }

  if (!matchingSession) {
    const loginQuery = new URLSearchParams({ callbackUrl: `/invite/${encodeURIComponent(token)}` });
    return (
      <Link
        href={`/login?${loginQuery}`}
        className="inline-flex items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-white transition hover:bg-accent-hover"
      >
        {t("Sign in to accept")}
      </Link>
    );
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={acceptInvite}
        disabled={busy}
        className="inline-flex items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-white transition hover:bg-accent-hover disabled:opacity-50"
      >
        {busy ? t("Accepting...") : accepted ? t("Open") : t("Accept invitation")}
      </button>
      {message && <p role="alert" className="text-sm text-error">{message}</p>}
      <p className="text-xs text-muted">
        {t("Use the magic link account for")} {invitedEmail}.
      </p>
    </div>
  );
}

