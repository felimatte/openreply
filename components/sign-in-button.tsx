"use client";

import { useFormStatus } from "react-dom";
import { useI18n } from "@/lib/i18n/provider";
import AppIcon from "@/components/app-icon";

export default function SignInButton() {
  const { pending } = useFormStatus();
  const { t } = useI18n();
  return <button type="submit" disabled={pending} aria-busy={pending} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-5 py-3 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60">{pending ? <><span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />{t("Sending sign-in link…")}</> : <>{t("Email me a magic link")}<AppIcon name="arrow" className="size-4" /></>}</button>;
}
