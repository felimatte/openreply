"use client";

/**
 * Campaign Builder
 *
 * New campaigns show their editable conversation immediately. Entry settings
 * live in a collapsible panel; campaign and conversation are saved together.
 * Existing simple campaigns and CSV imports retain the controls and preview.
 *
 * Covers the trigger scope (specific / any / next post), match mode (specific
 * words / any word), the opening, follow-gate and reveal DMs, public reply,
 * tracked links, the follow-up, and the contact steps: a question that
 * collects an email, phone number or free-text answer, and tags.
 */

import { useI18n } from "@/lib/i18n/provider";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import PostPicker from "@/components/post-picker";
import CampaignPreview, { type PreviewTab } from "@/components/campaign-preview";
import FlowBuilder from "@/components/flow-builder";
import { createDefaultFlow, parseFlowDefinition, validateFlowDefinition, type FlowDefinition } from "@/lib/flows/definition";
import "@/components/flows/campaign-creation.css";
import { readCache, writeCache } from "@/lib/client-cache";
import {
  IMPORT_QUEUE_KEY,
  IMPORT_ACCOUNT_KEY,
  type ImportRow,
} from "@/lib/import-queue";

type TriggerScope = "specific" | "any" | "next";
type MatchMode = "specific" | "any";
type AskType = "EMAIL" | "PHONE" | "TEXT";

interface ContactOptions {
  tags: { name: string }[];
  fields: { key: string; label: string }[];
}

interface LoadedCampaign {
  id: string;
  name: string;
  postId: string | null;
  postUrl: string | null;
  pendingNextReel: boolean;
  matchAnyPost: boolean;
  keywords: string[];
  excludedKeywords?: string[];
  priority?: number;
  matchAnyWord: boolean;
  dmTriggerEnabled: boolean;
  dmMessage: string;
  openingDmEnabled: boolean;
  openingDmMessage: string | null;
  openingDmButtonLabel: string | null;
  linkButtonLabel: string | null;
  requireFollow: boolean;
  followPromptMessage: string | null;
  followPromptButtonLabel: string | null;
  followUpEnabled: boolean;
  followUpMessage: string | null;
  followUpDelayMinutes: number | null;
  publicReplyEnabled: boolean;
  publicReplyMessage: string | null;
  publicReplyMessages: string[];
  askEnabled?: boolean;
  askType?: AskType | null;
  askMessage?: string | null;
  askRetryMessage?: string | null;
  askFieldKey?: string | null;
  askAfterLink?: boolean;
  askThanksMessage?: string | null;
  contactTags?: string[];
  isActive: boolean;
  instagramAccountId: string;
  trackedLinks?: { destinationUrl: string; label?: string | null }[];
}

interface CampaignBuilderProps {
  mode: "new" | "edit";
  campaignId?: string;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </div>
  );
}

function Radio({
  checked,
  onSelect,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
        checked ? "border-accent bg-accent/5" : "border-border hover:border-border-hover"
      }`}
    >
      <span
        className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
          checked ? "border-accent" : "border-zinc-500"
        }`}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-accent" />}
      </span>
      <span className="flex-1 text-foreground">{children}</span>
    </button>
  );
}

function Toggle({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        on ? "bg-accent" : "bg-zinc-300"
      }`}
    >
      <span
        className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${
          on ? "left-6" : "left-1"
        }`}
      />
    </button>
  );
}

export default function CampaignBuilder({ mode, campaignId }: CampaignBuilderProps) {
  const { t } = useI18n();
  const router = useRouter();

  const [loading, setLoading] = useState(mode === "edit");
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flow, setFlow] = useState<FlowDefinition>(() => createDefaultFlow());
  const [flowEpoch, setFlowEpoch] = useState(0);
  const [entryOpen, setEntryOpen] = useState(false);
  const [visualCreation, setVisualCreation] = useState(true);
  const creatingFlow = mode === "new" && visualCreation;

  const [name, setName] = useState("");
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);

  const [triggerScope, setTriggerScope] = useState<TriggerScope>("specific");
  const [postId, setPostId] = useState<string | null>(null);
  const [postUrl, setPostUrl] = useState<string | null>(null);
  const [postThumb, setPostThumb] = useState<string | null>(null);
  const [postCaption, setPostCaption] = useState("");

  // Post IDs already tied to another automation on this account, so the picker
  // can flag them and the user knows not to double-assign. Maps postId ->
  // the campaign name using it (for the tooltip).
  const [usedPosts, setUsedPosts] = useState<Record<string, string>>({});

  const [matchMode, setMatchMode] = useState<MatchMode>("specific");
  const [keywordText, setKeywordText] = useState("");
  const [excludedKeywordText, setExcludedKeywordText] = useState("");
  const [priority, setPriority] = useState(0);
  const [dmTriggerEnabled, setDmTriggerEnabled] = useState(false);

  const [publicReplyEnabled, setPublicReplyEnabled] = useState(false);
  const [publicReplyMessages, setPublicReplyMessages] = useState<string[]>([""]);

  const [openingDmEnabled, setOpeningDmEnabled] = useState(false);
  const [openingDmMessage, setOpeningDmMessage] = useState("");
  const [openingDmButtonLabel, setOpeningDmButtonLabel] = useState("");

  const [dmMessage, setDmMessage] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [trackedDestinationUrl, setTrackedDestinationUrl] = useState("");
  const [linkButtonLabel, setLinkButtonLabel] = useState("Open link");
  const [secondLinkOpen, setSecondLinkOpen] = useState(false);
  const [secondaryDestinationUrl, setSecondaryDestinationUrl] = useState("");
  const [secondaryButtonLabel, setSecondaryButtonLabel] = useState("Open link");
  const [requireFollow, setRequireFollow] = useState(false);
  const [followPromptMessage, setFollowPromptMessage] = useState("");
  const [followPromptButtonLabel, setFollowPromptButtonLabel] =
    useState("i'm following");
  const [followUpEnabled, setFollowUpEnabled] = useState(false);
  const [followUpMessage, setFollowUpMessage] = useState("");
  const [followUpDelayMinutes, setFollowUpDelayMinutes] = useState(0);

  const [askEnabled, setAskEnabled] = useState(false);
  const [askType, setAskType] = useState<AskType>("EMAIL");
  const [askMessage, setAskMessage] = useState("");
  const [askRetryMessage, setAskRetryMessage] = useState("");
  const [askFieldLabel, setAskFieldLabel] = useState("");
  const [askAfterLink, setAskAfterLink] = useState(false);
  const [askThanksMessage, setAskThanksMessage] = useState("");
  const [contactTagText, setContactTagText] = useState("");
  const [contactOptions, setContactOptions] = useState<ContactOptions>({
    tags: [],
    fields: [],
  });

  const [previewTab, setPreviewTab] = useState<PreviewTab>("dm");

  // CSV import queue. When present, each save advances to the next row instead
  // of returning to the campaigns list.
  const [importQueue, setImportQueue] = useState<ImportRow[] | null>(null);
  const [importTotal, setImportTotal] = useState(0);

  const keywords = useMemo(
    () =>
      keywordText
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
    [keywordText]
  );
  const excludedKeywords = useMemo(
    () => excludedKeywordText.split(",").map((word) => word.trim()).filter(Boolean),
    [excludedKeywordText]
  );

  // Fetch the connected account's real avatar for the preview (cache-first so
  // it shows instantly on a return visit instead of a blank circle).
  useEffect(() => {
    if (!selectedAccountId) return;
    let cancelled = false;
    const cacheKey = `ig-avatar:${selectedAccountId}`;
    const cached = readCache<string | null>(cacheKey, 30 * 60 * 1000);
    // Hydrating state from cache is a legitimate effect use here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (cached.data !== null) setAvatarUrl(cached.data);

    const params = new URLSearchParams({ instagramAccountId: selectedAccountId });
    fetch(`/api/instagram/profile?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const url = d.success ? d.data.profilePictureUrl ?? null : null;
        setAvatarUrl(url);
        writeCache(cacheKey, url);
      })
      .catch(() => {
        if (!cancelled && cached.data === null) setAvatarUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAccountId]);

  // Load accounts (both modes need them for the preview username + selector).
  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.success) return;
        const next: AccountOption[] = payload.data.instagramAccounts ?? [];
        setAccounts(next);
        setSelectedAccountId(
          (prev) => prev || payload.data.selectedInstagramAccountId || next[0]?.id || ""
        );
      })
      .catch(() => setAccounts([]));
  }, []);

  // Existing tags and custom fields, offered as suggestions.
  useEffect(() => {
    fetch("/api/contacts/options", { cache: "no-store" })
      .then((r) => r.json())
      .then((payload) => {
        if (payload.success) setContactOptions(payload.data);
      })
      .catch(() => {});
  }, []);

  // Prefill when editing.
  useEffect(() => {
    if (mode !== "edit" || !campaignId) return;
    Promise.all([
      fetch("/api/automations", { cache: "no-store" }).then((r) => r.json()),
      // Needed to show a free-text question's field by name.
      fetch("/api/contacts/options", { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => null),
    ])
      .then(([payload, options]) => {
        if (!payload.success) return setNotFound(true);
        const c = (payload.data as LoadedCampaign[]).find((x) => x.id === campaignId);
        if (!c) return setNotFound(true);
        const fields: ContactOptions["fields"] = options?.success
          ? options.data.fields
          : [];
        setAskEnabled(c.askEnabled ?? false);
        setAskType(c.askType ?? "EMAIL");
        setAskMessage(c.askMessage ?? "");
        setAskRetryMessage(c.askRetryMessage ?? "");
        setAskFieldLabel(
          c.askFieldKey
            ? fields.find((field) => field.key === c.askFieldKey)?.label ?? c.askFieldKey
            : ""
        );
        setAskAfterLink(c.askAfterLink ?? false);
        setAskThanksMessage(c.askThanksMessage ?? "");
        setContactTagText((c.contactTags ?? []).join(", "));
        setName(c.name);
        setSelectedAccountId(c.instagramAccountId);
        setTriggerScope(
          c.matchAnyPost ? "any" : c.pendingNextReel ? "next" : "specific"
        );
        setPostId(c.postId);
        setPostUrl(c.postUrl);
        setMatchMode(c.matchAnyWord ? "any" : "specific");
        setKeywordText(c.keywords.join(", "));
        setExcludedKeywordText((c.excludedKeywords ?? []).join(", "));
        setPriority(c.priority ?? 0);
        setDmTriggerEnabled(c.dmTriggerEnabled ?? false);
        setPublicReplyEnabled(c.publicReplyEnabled);
        setPublicReplyMessages(
          c.publicReplyMessages?.length
            ? c.publicReplyMessages
            : c.publicReplyMessage
              ? [c.publicReplyMessage]
              : [""]
        );
        setOpeningDmEnabled(c.openingDmEnabled);
        setOpeningDmMessage(c.openingDmMessage ?? "");
        setOpeningDmButtonLabel(c.openingDmButtonLabel ?? "");
        setDmMessage(c.dmMessage);
        setLinkButtonLabel(c.linkButtonLabel ?? "Open link");
        setIsActive(c.isActive);
        const link = c.trackedLinks?.[0]?.destinationUrl ?? "";
        setTrackedDestinationUrl(link);
        setLinkOpen(Boolean(link));
        const secondLink = c.trackedLinks?.[1];
        setSecondaryDestinationUrl(secondLink?.destinationUrl ?? "");
        setSecondaryButtonLabel(secondLink?.label ?? "Open link");
        setSecondLinkOpen(Boolean(secondLink?.destinationUrl));
        setRequireFollow(c.requireFollow ?? false);
        setFollowPromptMessage(c.followPromptMessage ?? "");
        setFollowPromptButtonLabel(
          c.followPromptButtonLabel ?? "i'm following"
        );
        setFollowUpEnabled(c.followUpEnabled ?? false);
        setFollowUpMessage(c.followUpMessage ?? "");
        setFollowUpDelayMinutes(c.followUpDelayMinutes ?? 0);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [mode, campaignId]);

  // Track which posts on the selected account are already assigned to an
  // automation, so the picker can highlight them. The campaign being edited is
  // excluded — its own post should read as selected, not "taken".
  useEffect(() => {
    if (!selectedAccountId) return;
    let cancelled = false;
    fetch("/api/automations", { cache: "no-store" })
      .then((r) => r.json())
      .then((payload) => {
        if (cancelled || !payload.success) return;
        const map: Record<string, string> = {};
        for (const a of payload.data as LoadedCampaign[]) {
          if (!a.postId) continue;
          if (a.instagramAccountId !== selectedAccountId) continue;
          if (mode === "edit" && a.id === campaignId) continue;
          map[a.postId] = a.name;
        }
        setUsedPosts(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedAccountId, mode, campaignId]);

  // Prefill the editable fields from one queued import row. The reel is left
  // unset so the user picks it per row.
  function prefillFromRow(row: ImportRow) {
    setVisualCreation(false);
    setFlow(createDefaultFlow({ dmMessage: row.dmMessage, openingDmEnabled: !!row.openingDmMessage, openingDmMessage: row.openingDmMessage, trackedLinks: row.trackedUrl ? [{ destinationUrl: row.trackedUrl, label: "Abrir enlace" }] : [] }));
    setFlowEpoch((value) => value + 1);
    setName(row.name ?? "");
    setTriggerScope("specific");
    setPostId(null);
    setPostUrl(null);
    setPostThumb(null);
    setPostCaption("");
    setMatchMode("specific");
    setKeywordText((row.keywords ?? []).join(", "));
    setExcludedKeywordText("");
    setPriority(0);
    setDmMessage(row.dmMessage ?? "");
    setPublicReplyEnabled(Boolean(row.publicReply));
    setPublicReplyMessages(row.publicReply ? [row.publicReply] : [""]);
    const hasOpening = Boolean(row.openingDmMessage);
    setOpeningDmEnabled(hasOpening);
    setOpeningDmMessage(row.openingDmMessage ?? "");
    setOpeningDmButtonLabel(
      row.openingDmButtonLabel || (hasOpening ? "Send link" : "")
    );
    const link = row.trackedUrl ?? "";
    setTrackedDestinationUrl(link);
    setLinkOpen(Boolean(link));
    setError(null);
  }

  // Pick up a staged CSV import (new mode only) and prefill the first row.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (mode !== "new") return;
    try {
      const raw = window.localStorage.getItem(IMPORT_QUEUE_KEY);
      const acct = window.localStorage.getItem(IMPORT_ACCOUNT_KEY);
      if (!raw) return;
      const queue = JSON.parse(raw) as ImportRow[];
      if (!Array.isArray(queue) || queue.length === 0) return;
      setImportQueue(queue);
      setImportTotal(queue.length);
      if (acct) setSelectedAccountId(acct);
      prefillFromRow(queue[0]);
    } catch {
      // ignore a malformed queue
    }
  }, [mode]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const username =
    accounts.find((a) => a.id === selectedAccountId)?.username ?? "yourbrand";

  function handlePostSelect(
    id: string,
    url?: string,
    thumb?: string,
    caption?: string
  ) {
    setPostId(id);
    setPostUrl(url ?? null);
    setPostThumb(thumb ?? null);
    setPostCaption(caption ?? "");
  }

  function ensureLinkToken() {
    setDmMessage((cur) => (cur.includes("{link}") ? cur : `${cur.trim()} {link}`.trim()));
  }

  async function handleSubmit(activeValue: boolean) {
    if (saving) return;
    setError(null);

    if (creatingFlow) {
      // Missing entry settings should be visible immediately, without saving a
      // placeholder campaign just to reach the conversation editor.
      if (!selectedAccountId || (triggerScope === "specific" && !postId) || (matchMode === "specific" && !keywords.length)) setEntryOpen(true);
      try { parseFlowDefinition(flow); } catch { return setError("Completá los textos, datos y direcciones de los pasos antes de guardar."); }
      if (activeValue && !validateFlowDefinition(flow).valid) return setError("Revisá los puntos marcados en el flujo antes de activar la campaña. También podés guardarla como borrador.");
    }

    if (!selectedAccountId) return setError(t("Connect an Instagram account first."));
    if (triggerScope === "specific" && !postId)
      return setError(t("Pick a post or reel to trigger the campaign."));
    if (matchMode === "specific" && keywords.length === 0)
      return setError(t("Add at least one keyword, or switch to any word."));
    if (excludedKeywords.length > 20 || excludedKeywords.some((word) => word.length > 50))
      return setError("Usá hasta 20 palabras excluidas, de hasta 50 caracteres cada una.");
    if (!Number.isInteger(priority) || priority < -100 || priority > 100)
      return setError("La prioridad debe ser un número entero entre -100 y 100.");
    if (!creatingFlow && !dmMessage.trim()) return setError(t("Add the DM with the link."));
    if (!creatingFlow && openingDmEnabled && (!openingDmMessage.trim() || !openingDmButtonLabel.trim()))
      return setError(t("Your opening DM needs a message and a button label."));
    if (!creatingFlow && askEnabled && !askMessage.trim())
      return setError(t("Write the question you want to ask."));
    if (!creatingFlow && askEnabled && askType === "TEXT" && !askFieldLabel.trim())
      return setError(t("Name the field the answer is saved in."));

    setSaving(true);

    const payload = {
      name: name.trim() || `Campaign for @${username}`,
      instagramAccountId: selectedAccountId,
      postId: triggerScope === "specific" ? postId : null,
      postUrl: triggerScope === "specific" ? postUrl : null,
      matchAnyPost: triggerScope === "any",
      pendingNextReel: triggerScope === "next",
      matchAnyWord: matchMode === "any",
      keywords: matchMode === "any" ? [] : keywords,
      excludedKeywords,
      priority,
      dmTriggerEnabled,
      dmMessage,
      openingDmEnabled,
      openingDmMessage: openingDmEnabled ? openingDmMessage : null,
      openingDmButtonLabel: openingDmEnabled ? openingDmButtonLabel : null,
      publicReplyEnabled,
      publicReplyMessages: publicReplyEnabled
        ? publicReplyMessages.map((m) => m.trim()).filter(Boolean)
        : [],
      trackedDestinationUrl: trackedDestinationUrl.trim() || "",
      linkButtonLabel: linkButtonLabel.trim() || "Open link",
      secondaryDestinationUrl: secondaryDestinationUrl.trim() || "",
      secondaryButtonLabel: secondaryButtonLabel.trim() || "Open link",
      requireFollow,
      followPromptMessage: requireFollow ? followPromptMessage.trim() : "",
      followPromptButtonLabel: requireFollow
        ? followPromptButtonLabel.trim() || "i'm following"
        : "",
      followUpEnabled,
      followUpMessage: followUpEnabled ? followUpMessage.trim() : "",
      followUpDelayMinutes: followUpEnabled ? followUpDelayMinutes : 0,
      askEnabled,
      askType: askEnabled ? askType : null,
      askMessage: askEnabled ? askMessage.trim() : null,
      askRetryMessage: askEnabled && askType !== "TEXT" ? askRetryMessage.trim() : null,
      askFieldLabel: askEnabled && askType === "TEXT" ? askFieldLabel.trim() : null,
      askAfterLink: askEnabled && askAfterLink,
      askThanksMessage: askEnabled && askAfterLink ? askThanksMessage.trim() : null,
      contactTags: contactTagText
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      isActive: activeValue,
      ...(creatingFlow ? { flowDefinition: flow, dmTriggerEnabled: false, dmMessage: flow.nodes.filter((node) => node.type === "message").flatMap((node) => node.data.blocks).find((block) => block.type === "text")?.text || "Continuemos la conversación.", openingDmEnabled: false, askEnabled: false } : {}),
    };

    try {
      const res =
        mode === "new"
          ? await fetch("/api/automations", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
          : await fetch(`/api/automations?id=${campaignId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
      const data = await res.json();
      if (data.success) {
        // The post we just assigned is now in use. Reflect it immediately so
        // the picker flags it on the next imported row — the fetch that builds
        // this map doesn't re-run while the builder stays mounted through the
        // import queue.
        if (triggerScope === "specific" && postId) {
          const assignedPostId = postId;
          setUsedPosts((prev) => ({ ...prev, [assignedPostId]: payload.name }));
        }
        // Importing: advance to the next queued row instead of leaving.
        if (importQueue && importQueue.length > 1) {
          const remaining = importQueue.slice(1);
          try {
            window.localStorage.setItem(
              IMPORT_QUEUE_KEY,
              JSON.stringify(remaining)
            );
          } catch {
            // ignore
          }
          setImportQueue(remaining);
          prefillFromRow(remaining[0]);
          setSaving(false);
          if (typeof window !== "undefined") window.scrollTo({ top: 0 });
          return;
        }
        if (importQueue) {
          try {
            window.localStorage.removeItem(IMPORT_QUEUE_KEY);
            window.localStorage.removeItem(IMPORT_ACCOUNT_KEY);
          } catch {
            // ignore
          }
        }
        // refresh() busts the router cache so the list reflects the save
        // instead of landing on a stale (empty) campaigns page.
        router.push(creatingFlow && !importQueue ? `/campaigns/${data.data.id}/flow` : "/campaigns");
        router.refresh();
      } else {
        // Surface the specific field that failed validation instead of a
        // generic "Invalid input".
        const fieldErrors = data.details?.fieldErrors as
          | Record<string, string[]>
          | undefined;
        const firstField = fieldErrors && Object.keys(fieldErrors)[0];
        setError(
          firstField
            ? `${firstField}: ${fieldErrors[firstField][0]}`
            : data.error ?? t("Failed to save campaign")
        );
        if (typeof window !== "undefined")
          window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch {
      setError(t("Failed to save campaign"));
    } finally {
      setSaving(false);
    }
  }

  // Skip the current imported row without saving a campaign for it, advancing
  // to the next one (or finishing the import if it was the last).
  function skipRow() {
    if (!importQueue) return;
    setError(null);
    if (importQueue.length > 1) {
      const remaining = importQueue.slice(1);
      try {
        window.localStorage.setItem(IMPORT_QUEUE_KEY, JSON.stringify(remaining));
      } catch {
        // ignore
      }
      setImportQueue(remaining);
      prefillFromRow(remaining[0]);
      if (typeof window !== "undefined") window.scrollTo({ top: 0 });
      return;
    }
    // Last row skipped — finish the import.
    try {
      window.localStorage.removeItem(IMPORT_QUEUE_KEY);
      window.localStorage.removeItem(IMPORT_ACCOUNT_KEY);
    } catch {
      // ignore
    }
    router.push("/campaigns");
    router.refresh();
  }

  if (loading) {
    return <div className="panel h-64 rounded" />;
  }

  if (notFound) {
    return (
      <div className="panel rounded p-8 text-center">
        <p className="text-sm text-muted">{t("Campaign not found.")}</p>
        <button
          onClick={() => router.push("/campaigns")}
          className="mt-4 rounded border border-border px-4 py-2 text-sm text-muted hover:text-foreground"
        >
          {t("Back to campaigns")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {importQueue && (
        <div className="rounded border border-accent/30 bg-accent/5 px-4 py-3 text-sm">
          <span className="font-medium text-foreground">
            {t("Importing {current} of {total}.", { current: importTotal - importQueue.length + 1, total: importTotal })}
          </span>{" "}
          <span className="text-muted">
            {t("Fields are prefilled from your CSV. Pick the reel, edit anything, and save to load the next one — or Skip if you don’t want this one.")}
          </span>
        </div>
      )}

      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          {mode === "edit" ? (
            <>
              <span className="truncate text-sm font-semibold text-foreground">
                {name || t("Untitled campaign")}
              </span>
              <span
                className={`rounded px-2 py-0.5 text-xs font-semibold ${
                  isActive ? "bg-success/15 text-success" : "bg-zinc-500/15 text-muted"
                }`}
              >
                {isActive ? t("LIVE") : t("PAUSED")}
              </span>
            </>
          ) : (
            <div><h1 className="text-xl font-semibold tracking-tight">Nueva campaña</h1><p className="mt-1 text-sm text-muted">Elegí cómo empieza y diseñá la conversación acá mismo.</p></div>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {mode === "new" && <button type="button" onClick={() => setVisualCreation(!visualCreation)} disabled={saving} className="rounded-lg px-3 py-2 text-xs text-muted hover:text-foreground" title="Usá la respuesta simple para campañas por DM">{visualCreation ? "Respuesta simple" : "Volver al flujo"}</button>}
          {mode === "edit" && campaignId && (
            <Link href={`/campaigns/${campaignId}/flow`} className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/20">
              Armar flujo visual
            </Link>
          )}
          {importQueue && (
            <button
              type="button"
              onClick={skipRow}
              disabled={saving}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground disabled:opacity-50"
            >
              {importQueue.length > 1 ? t("Skip") : t("Skip & finish")}
            </button>
          )}
          {mode === "edit" &&
            (isActive ? (
              <button
                type="button"
                onClick={() => handleSubmit(false)}
                disabled={saving}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground disabled:opacity-50"
              >
                {t("Stop")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSubmit(true)}
                disabled={saving}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground disabled:opacity-50"
              >
                {t("Go Live")}
              </button>
            ))}
          {mode === "new" && <button type="button" onClick={() => handleSubmit(false)} disabled={saving} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground disabled:opacity-50">Guardar borrador</button>}
          <button
            type="button"
            onClick={() => handleSubmit(mode === "new" ? true : isActive)}
            disabled={saving}
            className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? t("Saving…") : creatingFlow ? "Crear y activar" : mode === "new" ? t("Go Live") : t("Save changes")}
          </button>
        </div>
      </div>

      {error && <div role="alert" className="rounded-lg border border-error/20 bg-error/10 p-3 text-sm text-error">{error}</div>}

      {/* min-w-0 on the cells: a grid item defaults to min-width:auto, so a
          long string widens the whole page instead of wrapping. */}
      <div className={creatingFlow ? "campaign-create-layout" : "grid gap-6 lg:grid-cols-[300px_1fr] lg:gap-8"}>
      {/* Entry settings stay alongside the unsaved conversation. */}
      <details className={creatingFlow ? "campaign-create-entry" : undefined} open={!creatingFlow || entryOpen} inert={saving} onToggle={(event) => { if (creatingFlow) setEntryOpen(event.currentTarget.open); }}>
        {!creatingFlow && <summary className="hidden">Configuración de campaña</summary>}
        {creatingFlow && <summary><span className="campaign-entry-number">1</span><span className="min-w-0 flex-1"><strong>Cuándo empieza</strong><span className="campaign-entry-summary">@{username} · {triggerScope === "next" ? "Próximo Reel" : triggerScope === "any" ? "Cualquier publicación" : postId ? "Reel seleccionado" : "Elegí un Reel"} · {matchMode === "any" ? "Cualquier comentario" : keywords.length ? keywords.join(", ") : "Elegí las palabras"}</span></span><span className="campaign-entry-edit">{entryOpen ? "Cerrar" : "Configurar"} <span aria-hidden="true">⌄</span></span></summary>}
      <div className={creatingFlow ? "campaign-entry-controls" : "space-y-8 min-w-0"}>
        <div className="space-y-3">
          <label className="text-sm font-semibold text-foreground">
            {t("Campaign name")}{" "}
            <span className="font-normal text-muted">{t("(optional)")}</span>
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("e.g. YC referral")}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
            maxLength={100}
          />
          {accounts.length > 1 && (
            <div className="pt-2">
              <AccountSelect
                accounts={accounts}
                value={selectedAccountId}
                onChange={(id) => {
                  setSelectedAccountId(id);
                  setPostId(null);
                  setPostUrl(null);
                  setPostThumb(null);
                }}
                includeAll={false}
                label={t("Instagram account")}
              />
            </div>
          )}
        </div>

        <Section title={t("When someone comments on")}>
          <Radio
            checked={triggerScope === "specific"}
            onSelect={() => setTriggerScope("specific")}
          >
            {t("a specific post or reel")}
          </Radio>
          {triggerScope === "specific" && (
            <div className="rounded-lg border border-border p-2">
              <PostPicker
                selectedPostId={postId}
                instagramAccountId={selectedAccountId}
                usedPostIds={usedPosts}
                onSelect={handlePostSelect}
              />
            </div>
          )}
          <Radio
            checked={triggerScope === "any"}
            onSelect={() => setTriggerScope("any")}
          >
            {t("any post or reel")}
          </Radio>
          <Radio
            checked={triggerScope === "next"}
            onSelect={() => setTriggerScope("next")}
          >
            {t("next post or reel")}
          </Radio>
        </Section>

        <Section title={t("And this comment has")}>
          <Radio
            checked={matchMode === "specific"}
            onSelect={() => setMatchMode("specific")}
          >
            {t("a specific word or words")}
          </Radio>
          {matchMode === "specific" && (
            <div className="space-y-1">
              <input
                value={keywordText}
                onChange={(e) => setKeywordText(e.target.value)}
                placeholder={t("Enter a word or multiple")}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
              />
              <p className="text-xs text-muted">{t("Use commas to separate words")}</p>
            </div>
          )}
          <Radio
            checked={matchMode === "any"}
            onSelect={() => setMatchMode("any")}
          >
            {t("any word")}
          </Radio>
          <div className="space-y-2 rounded-lg border border-border p-3">
            <label htmlFor="excluded-keywords" className="block text-sm font-medium text-foreground">Palabras excluidas</label>
            <input id="excluded-keywords" value={excludedKeywordText} onChange={(event) => setExcludedKeywordText(event.target.value)} placeholder="ejemplo, otra palabra" aria-describedby="excluded-keywords-help" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none" />
            <p id="excluded-keywords-help" className="text-xs text-muted">Separalas con comas. Hasta 20 palabras de 50 caracteres. Los comentarios que coincidan con alguna quedan fuera de esta campaña.</p>
            {!!excludedKeywords.length && <div className="flex flex-wrap gap-1">{excludedKeywords.map((word, index) => <span key={`${index}-${word}`} className={`rounded-md px-2 py-1 text-xs ${word.length > 50 || index >= 20 ? "bg-error/10 text-error" : "bg-accent/10 text-accent"}`}>{word}</span>)}</div>}
            <label htmlFor="campaign-priority" className="block pt-1 text-sm font-medium text-foreground">Prioridad</label>
            <input id="campaign-priority" type="number" min={-100} max={100} step={1} value={priority} onChange={(event) => setPriority(Number(event.target.value))} aria-describedby="campaign-priority-help" className="w-28 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-accent/40 focus:outline-none" />
            <p id="campaign-priority-help" className="text-xs text-muted">De -100 a 100. Con flujos visuales, se elige la campaña coincidente de mayor prioridad.</p>
          </div>
          {!creatingFlow && <>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm text-foreground">
              {t("also reply when someone DMs")}{" "}
              {matchMode === "any" ? t("anything") : t("these words")}
            </span>
            <Toggle
              on={dmTriggerEnabled}
              onToggle={() => setDmTriggerEnabled(!dmTriggerEnabled)}
            />
          </div>
          {dmTriggerEnabled && (
            <p className="text-xs text-muted">
              {matchMode === "any"
                ? t("Every DM to this account gets the reply below — use with care.")
                : t("A DM containing any of these words gets the same reply, no comment needed.")}
            </p>
          )}
          </>}
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm text-foreground">
              {t("reply to their comments under the post")}
            </span>
            <Toggle
              on={publicReplyEnabled}
              onToggle={() => setPublicReplyEnabled(!publicReplyEnabled)}
            />
          </div>
          {publicReplyEnabled && (
            <div className="space-y-2">
              {publicReplyMessages.map((msg, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={msg}
                    onChange={(e) =>
                      setPublicReplyMessages((prev) =>
                        prev.map((m, idx) => (idx === i ? e.target.value : m))
                      )
                    }
                    placeholder={t("Sent you a DM! 📩")}
                    maxLength={1000}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                  />
                  {publicReplyMessages.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setPublicReplyMessages((prev) =>
                          prev.filter((_, idx) => idx !== i)
                        )
                      }
                      className="shrink-0 px-2 text-muted hover:text-error"
                      aria-label={t("Remove reply")}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {publicReplyMessages.length < 10 && (
                <button
                  type="button"
                  onClick={() =>
                    setPublicReplyMessages((prev) => [...prev, ""])
                  }
                  className="text-xs font-medium text-accent hover:underline"
                >
                  {t("+ Add another reply")}
                </button>
              )}
              <p className="text-xs text-muted">
                {t("One is picked at random each time, so replies don't look identical.")}
              </p>
            </div>
          )}
        </Section>

        {!creatingFlow && <>
        <Section title={t("They will get")}>
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">{t("an opening DM")}</span>
              <Toggle
                on={openingDmEnabled}
                onToggle={() => setOpeningDmEnabled(!openingDmEnabled)}
              />
            </div>
            {openingDmEnabled && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={openingDmMessage}
                  onChange={(e) => setOpeningDmMessage(e.target.value)}
                  placeholder={t("Hey there! I'm so happy you're here 😊")}
                  rows={3}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none resize-none"
                  maxLength={1000}
                />
                <input
                  value={openingDmButtonLabel}
                  onChange={(e) => setOpeningDmButtonLabel(e.target.value)}
                  placeholder={t("Send me the link")}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                  maxLength={64}
                />
              </div>
            )}
          </div>
          <div className="mt-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">
                {t("a follow requirement first")}
              </span>
              <Toggle
                on={requireFollow}
                onToggle={() => setRequireFollow(!requireFollow)}
              />
            </div>
            {requireFollow && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={followPromptMessage}
                  onChange={(e) => setFollowPromptMessage(e.target.value)}
                  placeholder={t("quick favor before i send your link. i don't make any money from this, it's free. if you want to support me, just don't unfollow after, and star the repo on github if it helps you. tap the button once you're following and i'll send it over")}
                  rows={3}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none resize-none"
                  maxLength={1000}
                />
                <input
                  value={followPromptButtonLabel}
                  onChange={(e) => setFollowPromptButtonLabel(e.target.value)}
                  placeholder={t("i'm following")}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                  maxLength={20}
                />
                <p className="text-xs text-muted">
                  {t("We send the link only after they tap the button and Instagram confirms the follow. If it can't be verified, we send it anyway.")}
                </p>
              </div>
            )}
          </div>
        </Section>

        <Section title={t("And then, they will get")}>
          <div className="rounded-lg border border-border p-3 space-y-2">
            <span className="text-sm text-foreground">{t("a DM with a link")}</span>
            <textarea
              value={dmMessage}
              onChange={(e) => setDmMessage(e.target.value)}
              placeholder={t("Write a message")}
              rows={3}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none resize-none"
              maxLength={1000}
            />
            {linkOpen ? (
              <div className="space-y-2">
                <input
                  value={trackedDestinationUrl}
                  onChange={(e) => setTrackedDestinationUrl(e.target.value)}
                  onBlur={ensureLinkToken}
                  placeholder="https://yourlink.com/offer"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                />
                <input
                  value={linkButtonLabel}
                  onChange={(e) => setLinkButtonLabel(e.target.value)}
                  placeholder={t("Button label (e.g. Open link)")}
                  maxLength={20}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                />
                {secondLinkOpen ? (
                  <div className="space-y-2 border-t border-border pt-2">
                    <input
                      value={secondaryDestinationUrl}
                      onChange={(e) => setSecondaryDestinationUrl(e.target.value)}
                      placeholder="https://yourlink.com/second"
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                    />
                    <input
                      value={secondaryButtonLabel}
                      onChange={(e) => setSecondaryButtonLabel(e.target.value)}
                      placeholder={t("Second button label")}
                      maxLength={20}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSecondLinkOpen(true)}
                    className="w-full rounded-lg border border-border py-2 text-sm text-muted hover:text-foreground"
                  >
                    {t("+ Add A Second Link")}
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setLinkOpen(true)}
                className="w-full rounded-lg border border-border py-2 text-sm text-muted hover:text-foreground"
              >
                {t("+ Add A Link")}
              </button>
            )}
            <p className="text-xs text-muted">
              {"{link}"} {t("inserts the tracked link;")} {"{username}"} {t("personalizes.")}
            </p>
          </div>
          <div className="mt-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">
                {t("a follow-up thank-you message")}
              </span>
              <Toggle
                on={followUpEnabled}
                onToggle={() => setFollowUpEnabled(!followUpEnabled)}
              />
            </div>
            {followUpEnabled && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={followUpMessage}
                  onChange={(e) => setFollowUpMessage(e.target.value)}
                  placeholder={t("Btw just wanted to say thanks for following me, I appreciate the support 🙌")}
                  rows={3}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none resize-none"
                  maxLength={1000}
                />
                <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                  <span className="text-xs text-muted">{t("Send it")}</span>
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    value={followUpDelayMinutes}
                    onChange={(e) =>
                      setFollowUpDelayMinutes(
                        Math.max(0, Math.min(1440, Math.floor(Number(e.target.value) || 0)))
                      )
                    }
                    className="w-20 rounded-lg border border-border bg-surface px-2 py-1 text-sm text-foreground focus:border-accent/40 focus:outline-none"
                  />
                  <span className="text-xs text-muted">
                    {t("minutes after the link")}
                  </span>
                </div>
                <p className="text-xs text-muted">
                  {followUpDelayMinutes > 0
                    ? t("Sent {minutes} min after they tap through.", { minutes: followUpDelayMinutes })
                    : t("Sent right after they tap through.")}
                  {" {username}"} {t("personalizes it. Max 24 hours, to stay inside Instagram's messaging window.")}
                </p>
              </div>
            )}
          </div>
        </Section>

        <Section title={t("Contacts")}>
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">{t("ask for their data")}</span>
              <Toggle on={askEnabled} onToggle={() => setAskEnabled(!askEnabled)} />
            </div>
            {askEnabled && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ["EMAIL", t("Email")],
                      ["PHONE", t("Phone")],
                      ["TEXT", t("Other")],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setAskType(value)}
                      className={`rounded-lg border px-2 py-1.5 text-sm transition-colors ${
                        askType === value
                          ? "border-accent bg-accent/5 text-foreground"
                          : "border-border text-muted hover:border-border-hover"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {askType === "TEXT" && (
                  <div className="space-y-1">
                    <input
                      value={askFieldLabel}
                      onChange={(e) => setAskFieldLabel(e.target.value)}
                      list="contact-field-suggestions"
                      placeholder={t("Save the answer as (e.g. City)")}
                      maxLength={40}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                    />
                    <datalist id="contact-field-suggestions">
                      {contactOptions.fields.map((field) => (
                        <option key={field.key} value={field.label} />
                      ))}
                    </datalist>
                  </div>
                )}
                <textarea
                  value={askMessage}
                  onChange={(e) => setAskMessage(e.target.value)}
                  placeholder={
                    askType === "EMAIL"
                      ? t("Where should I send it? Drop your email 👇")
                      : askType === "PHONE"
                        ? t("What's your WhatsApp number? 📲")
                        : t("Which city are you in?")
                  }
                  rows={2}
                  maxLength={1000}
                  className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                />
                {askType !== "TEXT" && (
                  <div className="space-y-1">
                    <input
                      value={askRetryMessage}
                      onChange={(e) => setAskRetryMessage(e.target.value)}
                      placeholder={t("Hmm, that doesn't look right. Could you send it again?")}
                      maxLength={1000}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                    />
                    <p className="text-xs text-muted">
                      {askType === "EMAIL"
                        ? t("Sent when the answer isn't an email. Leave it empty to repeat the question.")
                        : t("Sent when the answer isn't a phone number. Leave it empty to repeat the question.")}
                    </p>
                  </div>
                )}
                <div className="space-y-2">
                  <Radio checked={!askAfterLink} onSelect={() => setAskAfterLink(false)}>
                    {t("before the link — they get it in exchange")}
                  </Radio>
                  <Radio checked={askAfterLink} onSelect={() => setAskAfterLink(true)}>
                    {t("after the link")}
                  </Radio>
                </div>
                {askAfterLink && (
                  <input
                    value={askThanksMessage}
                    onChange={(e) => setAskThanksMessage(e.target.value)}
                    placeholder={t("Thanks! Got it 🙌 (optional)")}
                    maxLength={1000}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                  />
                )}
                <p className="text-xs text-muted">
                  {askType === "TEXT"
                    ? t("Any reply counts as the answer.")
                    : t("On a phone, Instagram offers the email or number from their profile with one tap. They can always type it.")}{" "}
                  {t("While the question waits, their reply is read as the answer, never as a keyword. After 3 tries we stop asking and carry on, so nobody gets stuck.")}
                  {askAfterLink && followUpEnabled
                    ? ` ${t("The thank-you message waits for their answer.")}`
                    : ""}
                </p>
              </div>
            )}
          </div>
          <div className="mt-3 space-y-2 rounded-lg border border-border p-3">
            <span className="text-sm text-foreground">{t("tag them")}</span>
            <input
              value={contactTagText}
              onChange={(e) => setContactTagText(e.target.value)}
              list="contact-tag-suggestions"
              placeholder={t("e.g. guide-october, vip")}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
            />
            <datalist id="contact-tag-suggestions">
              {contactOptions.tags.map((tag) => (
                <option key={tag.name} value={tag.name} />
              ))}
            </datalist>
            <p className="text-xs text-muted">
              {t("Added to everyone this campaign fires for. Use commas to separate tags.")}
            </p>
          </div>
        </Section>
        </>}
      </div>
      </details>

      {/* Conversation is editable before the campaign exists. */}
      <div className="min-w-0">
        {creatingFlow ? <FlowBuilder key={flowEpoch} campaignId="new-campaign" creation={{ definition: flow, onChange: setFlow, campaign: { id: "new-campaign", name: name || "Nueva campaña", isActive: false, keywords, matchAnyWord: matchMode === "any", matchAnyPost: triggerScope === "any", pendingNextReel: triggerScope === "next", postId, instagramAccount: { username } }, onConfigure: () => { setEntryOpen(true); document.querySelector(".campaign-create-entry")?.scrollIntoView({ behavior: "smooth", block: "start" }); }, onSave: () => void handleSubmit(false), saving }} /> : <>
        <p className="mb-4 text-sm text-muted">{t("Preview")}</p>
        <div className="flex min-w-0 justify-center lg:sticky lg:top-6 lg:block">
          <CampaignPreview
            tab={previewTab}
            onTabChange={setPreviewTab}
            username={username}
            avatarUrl={avatarUrl}
            postThumb={postThumb}
            caption={postCaption}
            sampleComment={keywords[0] ?? ""}
            dmTriggerEnabled={dmTriggerEnabled}
            publicReplyEnabled={publicReplyEnabled}
            publicReplyMessage={publicReplyMessages.find((m) => m.trim()) ?? ""}
            openingDmEnabled={openingDmEnabled}
            openingDmMessage={openingDmMessage}
            openingDmButtonLabel={openingDmButtonLabel}
            revealMessage={dmMessage}
            hasLink={Boolean(trackedDestinationUrl.trim())}
            linkButtonLabel={linkButtonLabel || "Open link"}
            linkUrl={trackedDestinationUrl.trim() || undefined}
            hasSecondLink={
              secondLinkOpen && Boolean(secondaryDestinationUrl.trim())
            }
            secondLinkButtonLabel={secondaryButtonLabel || "Open link"}
            requireFollow={requireFollow}
            followPromptMessage={followPromptMessage}
            followPromptButtonLabel={followPromptButtonLabel || "i'm following"}
            followUpEnabled={followUpEnabled}
            followUpMessage={followUpMessage}
            followUpDelayMinutes={followUpDelayMinutes}
            askEnabled={askEnabled}
            askType={askType}
            askMessage={askMessage}
            askAfterLink={askAfterLink}
            askThanksMessage={askThanksMessage}
          />
        </div>
        </>}
      </div>
      </div>
    </div>
  );
}
