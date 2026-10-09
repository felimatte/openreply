"use client";

/**
 * Contacts Page
 *
 * Everyone who has talked to a connected account, with the data they shared
 * and their tags. Filterable, paginated, editable, downloadable.
 */

import { useI18n } from "@/lib/i18n/provider";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ContactAutomationControls from "@/components/contact-automation-controls";
import AccountSelect, { type AccountOption } from "@/components/account-select";

interface ContactRow {
  id: string;
  igAccountId: string;
  igsid: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  fields: Record<string, string>;
  createdAt: string;
  lastInteractionAt: string;
  lastInboundAt: string | null;
  tags: { id: string; name: string }[];
  sourceAutomation: { id: string; name: string } | null;
  instagramAccount: string | null;
}

interface TagOption {
  id: string;
  name: string;
  count: number;
}

interface FieldOption {
  key: string;
  label: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000;

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none disabled:opacity-60";

function contactName(contact: ContactRow) {
  return contact.username ? `@${contact.username}` : contact.igsid;
}

export default function ContactsPage() {
  const { t, locale } = useI18n();
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [hasFilter, setHasFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("all");
  const [page, setPage] = useState(1);
  const [tags, setTags] = useState<TagOption[]>([]);
  const [fields, setFields] = useState<FieldOption[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [editing, setEditing] = useState<ContactRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const filterParams = useMemo(() => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (tagFilter) params.set("tag", tagFilter);
    if (hasFilter) params.set("has", hasFilter);
    const account = accounts.find((a) => a.id === selectedAccountId);
    if (account) params.set("account", account.instagramId);
    return params;
  }, [query, tagFilter, hasFilter, accounts, selectedAccountId]);

  const fetchContacts = useCallback(async () => {
    const request = ++requestRef.current;
    try {
      const params = new URLSearchParams(filterParams);
      params.set("page", String(page));
      params.set("limit", "25");
      const res = await fetch(`/api/contacts?${params}`, { cache: "no-store" });
      const data = await res.json();
      if (request !== requestRef.current) return;
      if (data.success) {
        setContacts(data.data.contacts);
        setPagination(data.data.pagination);
        setError(null);
      } else {
        setError(data.error ?? t("Could not load contacts."));
      }
    } catch {
      if (request === requestRef.current) setError(t("Could not load contacts."));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [filterParams, page, t]);

  const fetchOptions = useCallback(async () => {
    try {
      const res = await fetch("/api/contacts/options", { cache: "no-store" });
      const data = await res.json();
      if (data.success) {
        setTags(data.data.tags);
        setFields(data.data.fields);
      }
    } catch (err) {
      console.error("Failed to fetch contact options:", err);
    }
  }, []);

  useEffect(() => {
    fetch("/api/instagram/accounts")
      .then((res) => res.json())
      .then((payload) => {
        if (payload.success) setAccounts(payload.data.instagramAccounts ?? []);
      })
      .catch(console.error);
    fetch("/api/workspace/members")
      .then((res) => res.json())
      .then((payload) => {
        const role = payload.success ? payload.data.currentUserRole : null;
        setCanManage(role === "OWNER" || role === "ADMIN");
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchOptions();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchOptions]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchContacts();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchContacts]);

  // Search as they type, once they pause.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = search.trim();
      if (next === query) return;
      setLoading(true);
      setQuery(next);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, query]);

  function changeFilter(apply: () => void) {
    setLoading(true);
    apply();
    setPage(1);
  }

  function download(format: "xlsx" | "csv") {
    const params = new URLSearchParams(filterParams);
    params.set("format", format);
    params.set("tz", Intl.DateTimeFormat().resolvedOptions().timeZone);
    const link = document.createElement("a");
    link.href = `/api/contacts/export?${params}`;
    link.download = `contacts.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function formatDate(value: string) {
    return new Date(value).toLocaleString(locale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const hasFilters = Boolean(query || tagFilter || hasFilter || selectedAccountId !== "all");
  const columnCount = 6 + fields.length;
  function clearFilters() {
    changeFilter(() => {
      setSearch("");
      setQuery("");
      setTagFilter("");
      setHasFilter("");
      setSelectedAccountId("all");
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3"><h1 className="text-3xl font-semibold tracking-tight">{t("Contacts")}</h1>{pagination && <span className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium tabular-nums text-muted">{pagination.total.toLocaleString(locale)}</span>}</div>
          <p className="mt-2 text-sm text-muted">{t("Manage the people behind every conversation.")}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => download("xlsx")} disabled={loading || !pagination?.total} className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40">{t("Download Excel")} <span aria-hidden="true" className="ml-1">↓</span></button>
          <button type="button" onClick={() => download("csv")} disabled={loading || !pagination?.total} className="rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium text-muted hover:text-foreground disabled:opacity-40">CSV</button>
        </div>
      </div>
      <div className="panel flex flex-col gap-4 rounded-2xl p-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="grid flex-1 grid-cols-[minmax(0,1fr)_auto] items-end gap-3 sm:flex sm:flex-wrap">
          <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm sm:max-w-xs">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {t("Search")}
            </span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("Username, email or phone")}
              className={inputClass}
            />
          </label>
          <button type="button" aria-expanded={filtersOpen} aria-controls="contact-filters" onClick={() => setFiltersOpen((open) => !open)} className={`rounded-lg border px-3 py-2 text-sm font-medium sm:hidden ${filtersOpen ? "border-accent bg-accent text-white" : "border-border text-muted"}`}>{t("Filters")}</button>
          <div id="contact-filters" className={`${filtersOpen ? "grid" : "hidden"} col-span-2 grid-cols-2 gap-3 sm:contents`}>
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {t("Tag")}
            </span>
            <select
              value={tagFilter}
              onChange={(e) => changeFilter(() => setTagFilter(e.target.value))}
              className="w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent/40 sm:min-w-40"
            >
              <option value="">{t("All tags")}</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name} ({tag.count})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {t("Data")}
            </span>
            <select
              value={hasFilter}
              onChange={(e) => changeFilter(() => setHasFilter(e.target.value))}
              className="w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent/40 sm:min-w-40"
            >
              <option value="">{t("Everyone")}</option>
              <option value="email">{t("With email")}</option>
              <option value="phone">{t("With phone")}</option>
            </select>
          </label>
          {accounts.length > 1 && (
            <div className="col-span-2 sm:contents">
            <AccountSelect
              accounts={accounts}
              value={selectedAccountId}
              onChange={(id) => changeFilter(() => setSelectedAccountId(id))}
            />
            </div>
          )}
          </div>
        </div>
        {hasFilters && <button type="button" onClick={clearFilters} className="shrink-0 rounded-lg px-3 py-2.5 text-xs font-medium text-muted hover:bg-surface-hover hover:text-foreground">{t("Clear filters")} ×</button>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          {pagination
            ? t(pagination.total === 1 ? "{count} contact" : "{count} contacts", {
                count: pagination.total,
              })
            : ""}
          {hasFilters && pagination ? ` · ${t("Downloads include only the contacts shown by these filters.")}` : ""}
        </span>
        <Link href="/settings#google-sheets" className="text-accent hover:underline">
          {t("Keep a Google Sheet up to date")}
        </Link>
      </div>

      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-error/20 bg-error/5 p-4 text-sm text-error"><span>{error}</span><button onClick={() => { setLoading(true); void fetchContacts(); }} className="font-semibold underline">{t("Try again")}</button></div>}

      <div className="panel overflow-hidden rounded-2xl" aria-busy={loading}>
        <div className="divide-y divide-border md:hidden">
          {loading ? [0,1,2,3].map((i) => <div key={i} className="animate-pulse space-y-3 p-5"><div className="h-4 w-1/2 rounded bg-surface-hover"/><div className="h-3 w-3/4 rounded bg-surface-hover"/></div>) : contacts.length === 0 ? <div className="p-8 text-center text-sm leading-6 text-muted">{hasFilters ? t("No contacts match these filters.") : t("No contacts yet. People show up here when a campaign fires for their comment, when they message you, or when they tap a campaign's button.")}</div> : contacts.map((contact) => <button key={contact.id} type="button" onClick={() => setEditing(contact)} className="block w-full p-5 text-left hover:bg-surface-hover/50"><span className="flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-hover text-sm font-semibold" aria-hidden="true">{(contact.username ?? "?").slice(0,1).toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{contactName(contact)}</span><span className="mt-1 block truncate text-xs text-muted">{contact.email || contact.phone || formatDate(contact.lastInteractionAt)}</span></span><span aria-hidden="true" className="text-muted">→</span></span>{contact.tags.length > 0 && <span className="mt-3 flex flex-wrap gap-1.5">{contact.tags.map((tag) => <span key={tag.id} className="rounded-md bg-surface-hover px-2 py-1 text-[11px] text-muted">{tag.name}</span>)}</span>}</button>)}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-border bg-background/70 text-left">
                <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wider text-muted sm:px-6">{t("Contact")}</th>
                <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wider text-muted sm:px-6">{t("Email")}</th>
                <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wider text-muted sm:px-6">{t("Phone")}</th>
                {fields.map((field) => (
                  <th
                    key={field.key}
                    className="px-4 py-4 text-xs font-semibold uppercase tracking-wider text-muted sm:px-6"
                  >
                    {field.label}
                  </th>
                ))}
                <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wider text-muted sm:px-6">{t("Tags")}</th>
                <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wider text-muted sm:px-6">{t("Campaign")}</th>
                <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wider text-muted sm:px-6">{t("Last interaction")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading &&
                [...Array(5)].map((_, i) => (
                  <tr key={i}>
                    <td colSpan={columnCount} className="px-4 py-4 sm:px-6">
                      <div className="h-4 rounded bg-surface-hover" />
                    </td>
                  </tr>
                ))}
              {!loading && contacts.length === 0 && (
                <tr>
                  <td colSpan={columnCount} className="px-4 py-12 text-center text-muted sm:px-6">
                    {hasFilters
                      ? t("No contacts match these filters.")
                      : t("No contacts yet. People show up here when a campaign fires for their comment, when they message you, or when they tap a campaign's button.")}
                  </td>
                </tr>
              )}
              {!loading &&
                contacts.map((contact) => (
                  <tr
                    key={contact.id}
                    className="transition-colors hover:bg-surface-hover/50"
                  >
                    <td className="px-4 py-4 sm:px-6">
                      <button type="button" onClick={() => setEditing(contact)} className="flex items-center gap-3 text-left font-medium text-foreground hover:underline"><span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-hover text-xs text-muted">{(contact.username ?? "?").slice(0,1).toUpperCase()}</span>{contactName(contact)}</button>
                      {accounts.length > 1 && contact.instagramAccount && (
                        <span className="block text-xs text-muted">
                          {t("via @{account}", { account: contact.instagramAccount })}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-muted sm:px-6">{contact.email ?? "—"}</td>
                    <td className="px-4 py-4 whitespace-nowrap text-muted sm:px-6">{contact.phone ?? "—"}</td>
                    {fields.map((field) => (
                      <td key={field.key} className="max-w-[200px] px-4 py-4 text-muted sm:px-6">
                        <span className="block truncate">{contact.fields[field.key] ?? "—"}</span>
                      </td>
                    ))}
                    <td className="px-4 py-4 sm:px-6">
                      <div className="flex flex-wrap gap-1">
                        {contact.tags.length === 0 && <span className="text-muted">—</span>}
                        {contact.tags.map((tag) => (
                          <span
                            key={tag.id}
                            className="rounded-full border border-border px-2 py-0.5 text-xs text-foreground"
                          >
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-muted sm:px-6">
                      {contact.sourceAutomation?.name ?? "—"}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-muted sm:px-6">
                      {formatDate(contact.lastInteractionAt)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {pagination && pagination.totalPages > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-4 sm:px-6">
            <p className="text-xs text-muted">
              {t("Showing {start}–{end} of {total}", {
                start: (pagination.page - 1) * pagination.limit + 1,
                end: Math.min(pagination.page * pagination.limit, pagination.total),
                total: pagination.total,
              })}
            </p>
            <div className="flex items-center gap-2">
              <button
                disabled={loading || page <= 1}
                onClick={() => {
                  setLoading(true);
                  setPage(page - 1);
                }}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-all hover:border-border-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
              >
                {t("Previous")}
              </button>
              <span className="px-2 text-xs text-muted">
                {page} / {pagination.totalPages}
              </span>
              <button
                disabled={loading || page >= pagination.totalPages}
                onClick={() => {
                  setLoading(true);
                  setPage(page + 1);
                }}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-all hover:border-border-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
              >
                {t("Next")}
              </button>
            </div>
          </div>
        )}
      </div>

      {editing && (
        <ContactEditor
          contact={editing}
          fields={fields}
          tagSuggestions={tags.map((tag) => tag.name)}
          canManage={canManage}
          formatDate={formatDate}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void fetchContacts();
            void fetchOptions();
          }}
        />
      )}
    </div>
  );
}

function ContactEditor({
  contact,
  fields,
  tagSuggestions,
  canManage,
  formatDate,
  onClose,
  onSaved,
}: {
  contact: ContactRow;
  fields: FieldOption[];
  tagSuggestions: string[];
  canManage: boolean;
  formatDate: (value: string) => string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [email, setEmail] = useState(contact.email ?? "");
  const [phone, setPhone] = useState(contact.phone ?? "");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(contact.fields);
  const [tagText, setTagText] = useState(contact.tags.map((tag) => tag.name).join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Fixed when the editor opens, so rendering stays pure.
  const [openedAt] = useState(() => Date.now());
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  const windowEndsAt = contact.lastInboundAt
    ? new Date(contact.lastInboundAt).getTime() + MESSAGING_WINDOW_MS
    : null;
  const windowOpen = windowEndsAt !== null && windowEndsAt > openedAt;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
      if (event.key === "Tab") {
        const elements = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]');
        if (!elements?.length) return;
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/contacts/${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          phone,
          fields: Object.fromEntries(fields.map((field) => [field.key, fieldValues[field.key] ?? ""])),
          tags: tagText.split(",").map((tag) => tag.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error ?? t("Could not save the contact."));
        return;
      }
      onSaved();
    } catch {
      setError(t("Could not save the contact."));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(t("Delete this contact and the data they shared? This can't be undone."))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/contacts/${contact.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.success) {
        setError(data.error ?? t("Could not delete the contact."));
        return;
      }
      onSaved();
    } catch {
      setError(t("Could not delete the contact."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-end bg-foreground/25 backdrop-blur-[2px] sm:items-stretch"
      onClick={() => { if (!busy) onClose(); }}
    >
      <div
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-label={contactName(contact)}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[94dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl border-l border-border bg-surface p-5 shadow-2xl outline-none sm:max-h-dvh sm:rounded-none sm:p-8"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border pb-5">
          <div className="min-w-0">
            <p className="mb-2 text-xs font-medium text-muted">{t("Contact")}</p>
            <h2 className="truncate text-xl font-semibold tracking-tight text-foreground">{contactName(contact)}</h2>
            <p className="mt-1 text-xs text-muted">
              {t("First seen {date}", { date: formatDate(contact.createdAt) })}
              {contact.sourceAutomation
                ? ` · ${t("from {campaign}", { campaign: contact.sourceAutomation.name })}`
                : ""}
            </p>
            <p className={`mt-1 text-xs ${windowOpen ? "text-success" : "text-muted"}`}>
              {windowOpen && windowEndsAt
                ? t("You can message them until {date}.", {
                    date: formatDate(new Date(windowEndsAt).toISOString()),
                  })
                : t("Instagram lets you message them again once they write to you.")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={t("Close")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted hover:bg-surface-hover hover:text-foreground disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        <form id="contact-editor-form" onSubmit={(event) => { event.preventDefault(); if (canManage && !busy) void save(); }} className="mt-5 space-y-4">
          <ContactAutomationControls contactId={contact.id} />
          {error && (
            <div className="rounded border border-error/20 bg-error/10 p-3 text-sm text-error">{error}</div>
          )}
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-muted">{t("Email")}</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={!canManage || busy}
              type="email"
              className={inputClass}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-muted">{t("Phone")}</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={!canManage || busy}
              type="tel"
              className={inputClass}
            />
          </label>
          {fields.map((field) => (
            <label key={field.key} className="block space-y-1">
              <span className="text-xs font-semibold text-muted">{field.label}</span>
              <input
                value={fieldValues[field.key] ?? ""}
                onChange={(e) =>
                  setFieldValues((current) => ({ ...current, [field.key]: e.target.value }))
                }
                disabled={!canManage || busy}
                className={inputClass}
              />
            </label>
          ))}
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-muted">{t("Tags")}</span>
            <input
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
              disabled={!canManage || busy}
              list="contact-tag-suggestions"
              placeholder={t("Use commas to separate tags")}
              className={inputClass}
            />
            <datalist id="contact-tag-suggestions">
              {tagSuggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </label>
          <p className="text-xs text-muted">
            {t("Instagram user ID: {id}", { id: contact.igsid })}
            {contact.instagramAccount ? ` · @${contact.instagramAccount}` : ""}
          </p>
        </form>

        {canManage ? (
          <div className="sticky -bottom-5 mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface py-5 sm:-bottom-8">
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="rounded-lg border border-error/20 px-4 py-2 text-sm font-medium text-error hover:bg-error/10 disabled:opacity-50"
            >
              {t("Delete contact")}
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground disabled:opacity-50"
              >
                {t("Cancel")}
              </button>
              <button
                type="submit"
                form="contact-editor-form"
                disabled={busy}
                className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {busy ? t("Saving…") : t("Save")}
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-6 text-xs text-muted">
            {t("Only owners and admins can change contacts.")}
          </p>
        )}
      </div>
    </div>
  );
}
