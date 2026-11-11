"use client";

import { useSearchParams } from "next/navigation";

export function setAccountFilter(accountId: string) {
  const url = new URL(window.location.href);
  if (accountId === "all") url.searchParams.delete("instagramAccountId");
  else url.searchParams.set("instagramAccountId", accountId);
  window.history.replaceState(null, "", url);
}

export function useAccountFilter() {
  return [useSearchParams().get("instagramAccountId") ?? "all", setAccountFilter] as const;
}
