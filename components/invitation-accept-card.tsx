"use client";

import { useI18n } from "@/lib/i18n/provider";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface InvitationAcceptCardProps {
  token: string;
  isSignedIn: boolean;
  invitedEmail: string;
}

export default function InvitationAcceptCard({
  token,
  isSignedIn,
  invitedEmail,
}: InvitationAcceptCardProps) {
  const { t } = useI18n();
  const router = useRouter();
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
        router.push("/dashboard");
        return;
      }
      setMessage(payload.error ?? t("Could not accept invitation"));
    } catch {
      setMessage(t("Could not accept invitation"));
    } finally {
      setBusy(false);
    }
  }

  if (!isSignedIn) {
    return (
      <Link
        href="/login"
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
        {busy ? t("Accepting...") : t("Accept invitation")}
      </button>
      {message && <p role="alert" className="text-sm text-error">{message}</p>}
      <p className="text-xs text-muted">
        {t("Use the magic link account for")} {invitedEmail}.
      </p>
    </div>
  );
}

