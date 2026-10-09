"use client";

/**
 * Inbox
 *
 * Instagram DM conversations for the selected account, with live message
 * history and a reply composer. Messages are read from the Conversations API
 * (Meta only exposes the 20 most recent per thread) and refreshed by polling.
 * Sending is subject to Instagram's 24-hour messaging window — Meta's error is
 * surfaced verbatim when it applies.
 */

import type { Locale } from "@/lib/i18n";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/provider";
import { useCallback, useEffect, useRef, useState } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { readCache, writeCache } from "@/lib/client-cache";
import type { ConversationListItem } from "@/app/api/instagram/conversations/route";
import type { ThreadMessage } from "@/app/api/instagram/conversations/[id]/route";

const POLL_MS = 12_000;
// Cached list/threads are shown instantly on revisit, then revalidated in the
// background. The Instagram Conversations API is slow (often several seconds),
// so this is what makes the inbox feel fast after the first load.
const CACHE_MAX_AGE_MS = 60_000;
const convCacheKey = (accountId: string) => `inbox:convs:${accountId}`;
const msgCacheKey = (conversationId: string) => `inbox:msgs:${conversationId}`;

function formatTime(iso: string | null, locale: Locale): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

export default function InboxPage() {
  const { t, locale } = useI18n();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Seed from the last-used account so a revisit can paint the cached
  // conversation list immediately, before the account list even loads.
  const [selectedAccountId, setSelectedAccountId] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.sessionStorage.getItem("inbox:selectedAccount") ?? "";
  });

  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [convLoading, setConvLoading] = useState(true);
  const [convError, setConvError] = useState<string | null>(null);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const conversationRequests = useRef(new Set<string>());
  const selectionRef = useRef({ accountId: selectedAccountId, conversationId: activeId });
  const draftsRef = useRef<Record<string, string>>({});
  const shouldScrollRef = useRef(true);
  const sendSequenceRef = useRef(0);

  useEffect(() => {
    selectionRef.current = { accountId: selectedAccountId, conversationId: activeId };
  }, [selectedAccountId, activeId]);

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const visibleConversations = conversations.filter((conversation) =>
    `${conversation.contact.username ?? ""} ${conversation.lastMessage?.text ?? ""}`
      .toLocaleLowerCase(locale).includes(search.trim().toLocaleLowerCase(locale))
  );

  // Accounts for the selector; default to the first connected account. Uses the
  // lightweight accounts endpoint (one query) rather than the heavy dashboard
  // stats aggregation, so the inbox isn't gated on analytics before it can load.
  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const response = await fetch("/api/instagram/accounts", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error ?? t("Could not load connection."));
      const next: AccountOption[] = payload.data.instagramAccounts ?? [];
      setAccounts(next);
      setAccountsError(null);
      setSelectedAccountId((prev) => {
        // Only a successful response can invalidate the remembered selection.
        // A temporary accounts failure must leave cached conversations usable.
        const stillValid = prev && next.some((account) => account.id === prev);
        return stillValid ? prev : payload.data.selectedInstagramAccountId || next[0]?.id || "";
      });
    } catch (error) {
      setAccountsError(error instanceof Error ? error.message : t("Could not load connection."));
    } finally {
      setAccountsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAccounts(), 0);
    return () => window.clearTimeout(timer);
  }, [loadAccounts]);

  // Remember the chosen account for the next visit.
  useEffect(() => {
    if (typeof window === "undefined" || !selectedAccountId) return;
    window.sessionStorage.setItem("inbox:selectedAccount", selectedAccountId);
  }, [selectedAccountId]);

  const loadConversations = useCallback(
    async (silent: boolean) => {
      if (!selectedAccountId || conversationRequests.current.has(selectedAccountId)) return;
      conversationRequests.current.add(selectedAccountId);
      if (!silent) setConvLoading(true);
      try {
        const res = await fetch(
          `/api/instagram/conversations?instagramAccountId=${selectedAccountId}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (selectionRef.current.accountId !== selectedAccountId) return;
        if (data.success) {
          setConversations(data.data.conversations);
          writeCache(convCacheKey(selectedAccountId), data.data.conversations);
          setConvError(null);
        } else {
          setConvError(data.error ?? "Failed to load conversations");
        }
      } catch {
        if (selectionRef.current.accountId === selectedAccountId) setConvError("Failed to load conversations");
      } finally {
        conversationRequests.current.delete(selectedAccountId);
        if (selectionRef.current.accountId === selectedAccountId && !silent) setConvLoading(false);
      }
    },
    [selectedAccountId]
  );

  // Load + poll conversations for the selected account. A cached list is shown
  // immediately (so revisits are instant) while a fresh copy loads silently.
  useEffect(() => {
    if (!selectedAccountId) return;
    // Reset the open thread when switching accounts. This is an intentional
    // synchronous reset on a dependency change, not derived render state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveId(null);
    setMessages([]);
    setDraft("");
    setSearch("");
    setConvError(null);
    const cached = readCache<ConversationListItem[]>(
      convCacheKey(selectedAccountId),
      CACHE_MAX_AGE_MS
    );
    if (cached.data) {
      setConversations(cached.data);
      setConvLoading(false);
    } else {
      setConversations([]);
      setConvLoading(true);
    }
    void loadConversations(Boolean(cached.data));
    const timer = window.setInterval(() => void loadConversations(true), POLL_MS);
    return () => window.clearInterval(timer);
  }, [selectedAccountId, loadConversations]);

  const loadMessages = useCallback(
    async (conversationId: string, silent: boolean) => {
      if (!selectedAccountId) return;
      if (!silent) setThreadLoading(true);
      try {
        const res = await fetch(
          `/api/instagram/conversations/${conversationId}?instagramAccountId=${selectedAccountId}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (selectionRef.current.accountId !== selectedAccountId || selectionRef.current.conversationId !== conversationId) return;
        if (data.success) {
          setMessages(data.data.messages);
          writeCache(msgCacheKey(conversationId), data.data.messages);
          setThreadError(null);
        } else {
          setThreadError(data.error ?? t("Could not load messages."));
        }
      } catch {
        if (selectionRef.current.conversationId === conversationId) setThreadError(t("Could not load messages."));
      } finally {
        if (!silent && selectionRef.current.conversationId === conversationId) setThreadLoading(false);
      }
    },
    [selectedAccountId, t]
  );

  // Load + poll the open thread. Cached messages render instantly while a fresh
  // copy loads silently; opening a thread never shows a blank pane on revisit.
  useEffect(() => {
    if (!activeId || active?.detailsUnavailable) return;
    const cached = readCache<ThreadMessage[]>(
      msgCacheKey(activeId),
      CACHE_MAX_AGE_MS
    );
    if (cached.data) {
      // Paint cached messages instantly on thread change; intentional reset.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessages(cached.data);
      setThreadLoading(false);
    } else {
      setMessages([]);
      setThreadLoading(true);
    }
    void loadMessages(activeId, Boolean(cached.data));
    const timer = window.setInterval(
      () => void loadMessages(activeId, true),
      POLL_MS
    );
    return () => window.clearInterval(timer);
  }, [activeId, active?.detailsUnavailable, loadMessages]);

  // Keep the thread pinned to the latest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && shouldScrollRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function openConversation(id: string) {
    if (activeId) draftsRef.current[activeId] = draft;
    selectionRef.current = { accountId: selectedAccountId, conversationId: id };
    setActiveId(id);
    setDraft(draftsRef.current[id] ?? "");
    setSendError(null);
    setThreadError(null);
    shouldScrollRef.current = true;
    // Paint any cached thread synchronously so the pane never flashes empty
    // or shows the previously open conversation while the fetch runs.
    const cached = readCache<ThreadMessage[]>(msgCacheKey(id), CACHE_MAX_AGE_MS);
    setMessages(cached.data ?? []);
    setThreadLoading(!cached.data && !conversations.find((conversation) => conversation.id === id)?.detailsUnavailable);
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text || !active?.contact.id || sending) return;
    setSending(true);
    setSendError(null);

    // Optimistically show the reply immediately, then confirm with the server.
    const optimistic: ThreadMessage = {
      id: `optimistic-${++sendSequenceRef.current}`,
      text,
      fromMe: true,
      fromUsername: null,
      createdTime: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    shouldScrollRef.current = true;
    setDraft("");
    draftsRef.current[active.id] = "";

    try {
      const res = await fetch("/api/instagram/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instagramAccountId: selectedAccountId,
          recipientId: active.contact.id,
          text,
        }),
      });
      const data = await res.json();
      if (data.success) {
        await loadMessages(active.id, true);
        void loadConversations(true);
      } else {
        // Roll the optimistic message back and restore the draft so it's not lost.
        draftsRef.current[active.id] = text;
        if (selectionRef.current.conversationId === active.id) {
          setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
          setDraft(text);
          setSendError(data.error ?? t("Failed to send message"));
        }
      }
    } catch {
      draftsRef.current[active.id] = text;
      if (selectionRef.current.conversationId === active.id) {
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setDraft(text);
        setSendError(t("Failed to send message"));
      }
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSend();
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">{t("Inbox")}</h1>
          <p className="mt-2 text-sm text-muted">{t("Your conversations, all in one place.")}</p>
        </div>
        {accounts.length > 1 && <AccountSelect accounts={accounts} value={selectedAccountId} onChange={(id) => {
          if (activeId) draftsRef.current[activeId] = draft;
          selectionRef.current = { accountId: id, conversationId: null };
          setSelectedAccountId(id);
        }} includeAll={false} />}
      </div>

      {accountsError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-error/20 bg-error/5 p-4 text-sm text-error"><p>{accountsError}</p><button type="button" onClick={() => void loadAccounts()} disabled={accountsLoading} className="font-semibold underline disabled:opacity-40">{accountsLoading ? t("Loading…") : t("Try again")}</button></div>}

      {!accountsLoading && !accountsError && accounts.length === 0 ? (
        <div className="panel flex min-h-96 flex-col items-center justify-center rounded-2xl p-8 text-center">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-hover text-2xl text-muted" aria-hidden="true">↗</div>
          <h2 className="text-lg font-semibold">{t("Connect Instagram")}</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted">{t("Connect an Instagram professional account to launch campaigns.")}</p>
          <Link href="/settings#connections" className="mt-6 rounded-lg bg-accent px-5 py-3 text-sm font-medium text-white hover:bg-accent-hover">{t("Connection settings")}</Link>
        </div>
      ) : !accountsError || selectedAccountId ? (
      <div className="grid h-[calc(100dvh-18rem)] min-h-[400px] grid-cols-1 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm md:h-[calc(100dvh-15rem)] md:min-h-[480px] md:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className={`min-h-0 flex-col border-border md:flex md:border-r ${active ? "hidden" : "flex"}`}>
          <div className="shrink-0 space-y-4 border-b border-border p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">{t("Conversations")}</h2>
                <span className="rounded-md bg-surface-hover px-2 py-0.5 text-xs tabular-nums text-muted">{conversations.length}</span>
              </div>
              <button type="button" onClick={() => void loadConversations(false)} disabled={convLoading} className="text-xs font-medium text-muted hover:text-foreground disabled:opacity-40">{t("Refresh")}</button>
            </div>
            <label className="relative block">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Search conversations")} aria-label={t("Search conversations")} className="w-full rounded-lg border border-border bg-background py-2.5 pl-9 pr-3 text-sm outline-none focus:border-accent/40" />
            </label>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2" aria-busy={convLoading}>
            {convError && <div role="alert" className="m-2 rounded-lg border border-error/20 bg-error/5 p-3 text-xs leading-5 text-error">{convError === "Failed to load conversations" ? t("Failed to load conversations") : convError}<button onClick={() => void loadConversations(false)} className="mt-2 block font-semibold underline">{t("Try again")}</button></div>}
            {convLoading && conversations.length === 0 ? (
              <div className="space-y-2 p-2" aria-label={t("Loading…")}>{[0,1,2,3,4].map((i) => <div key={i} className="flex animate-pulse items-center gap-3 p-3"><div className="h-10 w-10 rounded-full bg-surface-hover"/><div className="flex-1 space-y-2"><div className="h-3 w-2/3 rounded bg-surface-hover"/><div className="h-3 w-full rounded bg-surface-hover"/></div></div>)}</div>
            ) : visibleConversations.length === 0 ? (
              <div className="px-6 py-14 text-center text-sm leading-6 text-muted">{search ? t("No conversations match your search.") : t("No conversations yet.")}</div>
            ) : visibleConversations.map((c) => (
              <button key={c.id} type="button" aria-pressed={c.id === activeId} onClick={() => openConversation(c.id)} className={`mb-1 flex w-full gap-3 rounded-xl p-3 text-left transition-colors ${c.id === activeId ? "bg-surface-hover" : "hover:bg-background"}`}>
                <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${c.id === activeId ? "bg-accent text-white" : "bg-background text-muted"}`}>{(c.contact.username ?? "?").slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold">{c.detailsUnavailable ? t("Details unavailable") : `@${c.contact.username ?? "unknown"}`}</span><span className="shrink-0 text-[10px] text-muted">{formatTime(c.updatedTime, locale)}</span></span>
                  <span className="mt-1 block truncate text-xs leading-5 text-muted">{c.detailsUnavailable ? t("Instagram could not load this conversation.") : c.lastMessage ? `${c.lastMessage.fromMe ? t("You: ") : ""}${c.lastMessage.text || t("(no text)")}` : t("No messages.")}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className={`min-h-0 min-w-0 flex-col ${active ? "flex" : "hidden md:flex"}`}>
          {!active ? (
            <div className="flex flex-1 flex-col items-center justify-center bg-background/70 p-8 text-center">
              <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-surface text-muted"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" className="h-7 w-7"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5A8.5 8.5 0 0 1 10.5 3h2a8.5 8.5 0 0 1 8.5 8.5Z"/><path d="M7 10h9M7 14h6"/></svg></div>
              <h2 className="text-base font-semibold">{t("Conversations")}</h2>
              <p className="mt-2 max-w-xs text-sm leading-6 text-muted">{t("Select a conversation to read and reply.")}</p>
            </div>
          ) : <>
            <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-4 sm:px-6">
              <button type="button" onClick={() => { draftsRef.current[active.id] = draft; setActiveId(null); }} className="rounded-lg border border-border px-2 py-2 text-xs text-muted md:hidden" aria-label={t("Back to conversations")}>← {t("Back")}</button>
              <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-hover text-sm font-semibold">{(active.contact.username ?? "?").slice(0,1).toUpperCase()}</span>
              <div className="min-w-0"><h2 className="truncate text-sm font-semibold">{active.detailsUnavailable ? t("Details unavailable") : `@${active.contact.username ?? "unknown"}`}</h2><p className="mt-0.5 text-xs text-muted">Instagram</p></div>
              <button type="button" onClick={() => void loadMessages(active.id, false)} disabled={threadLoading || active.detailsUnavailable} className="ml-auto text-xs font-medium text-muted hover:text-foreground disabled:opacity-40">{t("Refresh")}</button>
            </div>
            <div ref={scrollRef} onScroll={(e) => { const el = e.currentTarget; shouldScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }} className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-background/60 px-4 py-6 sm:px-8" aria-busy={threadLoading}>
              {threadError && <div role="alert" className="rounded-lg border border-error/20 bg-error/5 p-3 text-xs text-error">{threadError}<button onClick={() => void loadMessages(active.id, false)} className="ml-2 underline">{t("Try again")}</button></div>}
              {active.detailsUnavailable ? <p role="status" className="rounded-xl border border-border bg-surface p-5 text-sm leading-6 text-muted">{t("Instagram could not load the details of this conversation. Other conversations are still available. You can check this chat in Instagram.")}</p> : threadLoading && messages.length === 0 ? <p className="py-8 text-center text-sm text-muted">{t("Loading…")}</p> : messages.length === 0 ? <p className="py-8 text-center text-sm text-muted">{t("No messages.")}</p> : messages.map((m) => (
                <div key={m.id} className={`flex ${m.fromMe ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 sm:max-w-[75%] ${m.fromMe ? "rounded-br-md bg-accent text-white" : "rounded-bl-md border border-border bg-surface text-foreground"}`}>
                    <p className="whitespace-pre-wrap break-words">{m.text || t("(no text)")}</p>
                    <p className={`mt-1 text-right text-[10px] ${m.fromMe ? "text-white/65" : "text-muted"}`}>{m.id.startsWith("optimistic-") ? t("Sending…") : formatTime(m.createdTime, locale)}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="shrink-0 border-t border-border p-4 sm:px-6">
              {sendError && <p role="alert" className="mb-3 rounded-lg bg-error/5 p-3 text-xs text-error">{sendError}</p>}
              <div className="flex items-end gap-3 rounded-xl border border-border bg-background p-2 focus-within:border-accent/40">
                <textarea disabled={sending || active.detailsUnavailable || !active.contact.id} value={draft} onChange={(e) => { setDraft(e.target.value); draftsRef.current[active.id] = e.target.value; }} onKeyDown={handleKeyDown} rows={2} aria-label={t("Reply")} title={t("Write a reply…  (Enter to send, Shift+Enter for a new line)")} placeholder={t("Write a reply…")} className="max-h-40 min-h-[56px] min-w-0 flex-1 resize-y border-0 bg-transparent px-2 py-1 text-sm leading-6 text-foreground placeholder:text-muted outline-none disabled:opacity-50" />
                <button type="button" onClick={() => void handleSend()} disabled={sending || !draft.trim() || !active.contact.id || active.detailsUnavailable} className="shrink-0 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40">{sending ? t("Sending…") : t("Send")} <span aria-hidden="true">↗</span></button>
              </div>
            </div>
          </>}
        </div>
      </div>
      ) : null}
    </div>
  );
}
