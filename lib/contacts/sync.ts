/**
 * Keeping a Google Sheet (or any tool that takes a webhook) up to date with
 * the workspace's contacts. Every change is queued and POSTed as signed JSON;
 * docs/contacts.md has the format and the Apps Script that receives it.
 */

import { createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { prisma } from "@/lib/db/client";
import { decryptToken } from "@/lib/meta/oauth";
import {
  CONTACT_SYNC_JOB_NAME,
  getContactSyncQueue,
  type ContactSyncJob,
} from "@/lib/queue/client";
import {
  CONTACT_EXPORT_SELECT,
  asFieldValues,
  type ExportableContact,
  type FieldDefinition,
} from "./format";

/** Contacts per request, so a full resend never builds one huge body. */
export const MAX_CONTACTS_PER_SYNC = 200;
const SYNC_TIMEOUT_MS = 15_000;
// Apps Script answers with one redirect to its output; a few more are fine.
const MAX_REDIRECTS = 3;

export function generateSyncSecret(): string {
  return randomBytes(24).toString("hex");
}

/**
 * Queue contacts to be sent to the workspace's sheet. Does nothing when the
 * workspace has no sync switched on, and never throws: a sheet that falls
 * behind must not stop a DM from going out.
 */
export async function enqueueContactSync(
  workspaceId: string,
  contactIds: readonly string[],
  options: { deleted?: boolean } = {}
): Promise<void> {
  if (contactIds.length === 0) return;
  try {
    const sync = await prisma.contactSync.findUnique({
      where: { workspaceId },
      select: { enabled: true, url: true },
    });
    if (!sync?.enabled || !sync.url) return;

    const jobs: { name: string; data: ContactSyncJob }[] = [];
    for (let i = 0; i < contactIds.length; i += MAX_CONTACTS_PER_SYNC) {
      jobs.push({
        name: CONTACT_SYNC_JOB_NAME,
        data: {
          workspaceId,
          contactIds: contactIds.slice(i, i + MAX_CONTACTS_PER_SYNC),
          ...(options.deleted ? { deleted: true } : {}),
        },
      });
    }
    await getContactSyncQueue().addBulk(jobs);
  } catch (error) {
    console.error(
      "[Contacts] Could not queue the sheet update:",
      error instanceof Error ? error.message : error
    );
  }
}

/**
 * One contact as the sheet receives it. Every custom field is there, keyed by
 * its label, empty when the contact has no value, so a value cleared in
 * OpenReply is cleared in the sheet too.
 */
export interface ContactSyncRecord {
  contact_id: string;
  instagram_account: string;
  instagram_user_id: string;
  username: string;
  email: string;
  phone: string;
  tags: string[];
  source_campaign: string;
  first_seen: string;
  last_interaction: string;
  fields: Record<string, string>;
}

export type ContactSyncPayload =
  | {
      event: "contacts.updated";
      sent_at: string;
      workspace_id: string;
      contacts: ContactSyncRecord[];
    }
  | {
      event: "contacts.deleted";
      sent_at: string;
      workspace_id: string;
      contact_ids: string[];
    }
  | { event: "test"; sent_at: string; workspace_id: string };

export function contactSyncRecord(
  contact: ExportableContact,
  fields: readonly FieldDefinition[],
  accountUsernames: ReadonlyMap<string, string>
): ContactSyncRecord {
  const values = asFieldValues(contact.fields);
  const labelled: Record<string, string> = {};
  for (const field of fields) labelled[field.label] = values[field.key] ?? "";
  return {
    contact_id: contact.id,
    instagram_account:
      accountUsernames.get(contact.igAccountId) ?? contact.igAccountId,
    instagram_user_id: contact.igsid,
    username: contact.username ?? "",
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    tags: contact.tags.map(({ tag }) => tag.name),
    source_campaign: contact.sourceAutomation?.name ?? "",
    first_seen: contact.createdAt.toISOString(),
    last_interaction: contact.lastInteractionAt.toISOString(),
    fields: labelled,
  };
}

export async function loadContactSyncRecords(
  workspaceId: string,
  contactIds: readonly string[]
): Promise<ContactSyncRecord[]> {
  const [contacts, fields, accounts] = await Promise.all([
    prisma.contact.findMany({
      where: { workspaceId, id: { in: [...contactIds] } },
      select: CONTACT_EXPORT_SELECT,
    }),
    prisma.contactField.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
      select: { key: true, label: true },
    }),
    prisma.instagramAccount.findMany({
      where: { workspaceId },
      select: { instagramId: true, username: true },
    }),
  ]);
  const usernames = new Map(accounts.map((a) => [a.instagramId, a.username]));
  return contacts.map((contact) => contactSyncRecord(contact, fields, usernames));
}

export function signContactSyncBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

/**
 * JSON with every non-ASCII character escaped. The receiver then reads exactly
 * the bytes that were signed, whatever character set it assumes; Apps Script
 * in particular never shows the raw request bytes.
 */
export function serializeContactSyncPayload(payload: ContactSyncPayload): string {
  return JSON.stringify(payload).replace(
    /[\u007f-￿]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

function isAppsScriptUrl(url: URL): boolean {
  return (
    url.hostname === "script.google.com" ||
    url.hostname.endsWith(".googleusercontent.com")
  );
}

function replyError(reply: unknown): string | null {
  if (!reply || typeof reply !== "object" || !("ok" in reply)) return null;
  if (reply.ok !== false) return null;
  return "error" in reply && typeof reply.error === "string"
    ? reply.error
    : "no reason given";
}

/**
 * Refuse to send anything to this machine or a private network: the address
 * has to be public https, and so does every address its name resolves to.
 * Checked again on every redirect, so a public URL can't bounce the request
 * somewhere internal.
 */
async function assertPublicDestination(url: URL): Promise<void> {
  const refused = new Error(
    "The sheet's address has to be a public https URL, not this server or a private network"
  );
  if (url.protocol !== "https:" || url.username || url.password) throw refused;
  if (isPrivateHost(url.hostname)) throw refused;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return;
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error(`Could not reach the sheet (${host} was not found)`);
  }
  if (addresses.some(({ address }) => isPrivateHost(address))) throw refused;
}

/**
 * POST a payload to the sheet. The signature goes in a header for tools that
 * can read headers, and in the `signature` query parameter for Apps Script,
 * which cannot.
 */
export async function postContactSync({
  url,
  secret,
  payload,
}: {
  url: string;
  secret: string;
  payload: ContactSyncPayload;
}): Promise<void> {
  const body = serializeContactSyncPayload(payload);
  const signature = signContactSyncBody(body, secret);
  let target = new URL(url);
  target.searchParams.set("signature", signature);
  const signal = AbortSignal.timeout(SYNC_TIMEOUT_MS);

  // Redirects are followed by hand so each hop is checked first. Apps Script
  // answers the POST with a redirect to the script's output, read with a GET.
  let request: { method: string; body?: string } = { method: "POST", body };
  let response: Response;
  for (let hop = 0; ; hop += 1) {
    await assertPublicDestination(target);
    try {
      response = await fetch(target, {
        method: request.method,
        headers:
          request.method === "POST"
            ? {
                "Content-Type": "application/json",
                "X-OpenReply-Signature": `sha256=${signature}`,
              }
            : undefined,
        body: request.body,
        redirect: "manual",
        signal,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      throw new Error(`Could not reach the sheet (${reason})`);
    }
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) break;
    if (hop >= MAX_REDIRECTS) throw new Error("The sheet redirected too many times");
    target = new URL(location, target);
    // 307 and 308 repeat the POST; the others fetch the result with a GET.
    if (response.status !== 307 && response.status !== 308) request = { method: "GET" };
  }

  const text = await response.text().catch(() => "");
  let reply: unknown = null;
  try {
    reply = JSON.parse(text);
  } catch {
    // Not JSON; judged by the status alone below.
  }

  const rejected = replyError(reply);
  if (!response.ok) {
    throw new Error(
      `The sheet answered with status ${response.status}${rejected ? `: ${rejected}` : ""}`
    );
  }
  if (rejected) throw new Error(`The sheet rejected the update: ${rejected}`);
  // A failing Apps Script still answers 200, with an HTML error page, so a
  // Google Sheet has to confirm with {"ok": true}.
  if (
    isAppsScriptUrl(new URL(url)) &&
    !(reply && typeof reply === "object" && "ok" in reply && reply.ok === true)
  ) {
    throw new Error(
      "The sheet did not confirm the update. Check that the script is deployed as a web app with access for Anyone, and that it is the latest version."
    );
  }
}

async function recordOutcome(workspaceId: string, error: unknown) {
  await prisma.contactSync
    .updateMany({
      where: { workspaceId },
      data: error
        ? {
            lastErrorAt: new Date(),
            lastError: (error instanceof Error ? error.message : String(error)).slice(0, 500),
          }
        : { lastSuccessAt: new Date() },
    })
    .catch(() => {});
}

async function deliver(workspaceId: string, url: string, encryptedSecret: string, payload: ContactSyncPayload) {
  try {
    await postContactSync({ url, secret: decryptToken(encryptedSecret), payload });
  } catch (error) {
    await recordOutcome(workspaceId, error);
    throw error;
  }
  await recordOutcome(workspaceId, null);
}

/** Run one queued sync job. Throws on failure so the queue retries it. */
export async function processContactSyncJob(job: ContactSyncJob): Promise<void> {
  const sync = await prisma.contactSync.findUnique({
    where: { workspaceId: job.workspaceId },
  });
  if (!sync?.enabled || !sync.url) return;

  const base = {
    sent_at: new Date().toISOString(),
    workspace_id: job.workspaceId,
  };
  if (job.deleted) {
    await deliver(job.workspaceId, sync.url, sync.secret, {
      event: "contacts.deleted",
      ...base,
      contact_ids: job.contactIds,
    });
    return;
  }

  const contacts = await loadContactSyncRecords(job.workspaceId, job.contactIds);
  if (contacts.length === 0) return;
  await deliver(job.workspaceId, sync.url, sync.secret, {
    event: "contacts.updated",
    ...base,
    contacts,
  });
}

/** Send a test request to the configured sheet, without touching any row. */
export async function sendContactSyncTest(workspaceId: string): Promise<void> {
  const sync = await prisma.contactSync.findUnique({ where: { workspaceId } });
  if (!sync?.url) throw new Error("Paste the sheet's web app URL first.");
  await deliver(workspaceId, sync.url, sync.secret, {
    event: "test",
    sent_at: new Date().toISOString(),
    workspace_id: workspaceId,
  });
}

/**
 * Check a URL someone pasted before anything is sent to it: a public https
 * address, never this machine or a private network.
 */
export function validateSyncUrl(
  value: string
): { ok: true; url: string } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { ok: false, error: "Paste the full web app URL, starting with https://" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, error: "The URL has to start with https://" };
  }
  if (url.username || url.password) {
    return { ok: false, error: "The URL can't contain a user name or password" };
  }
  if (isPrivateHost(url.hostname)) {
    return { ok: false, error: "The URL has to be a public internet address" };
  }
  return { ok: true, url: url.toString() };
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true;
  }
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (host.includes(":")) {
    return (
      host === "::" ||
      host === "::1" ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("fe80") ||
      host.startsWith("::ffff:")
    );
  }
  return false;
}
