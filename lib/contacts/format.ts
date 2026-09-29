/**
 * One shape for a contact wherever it leaves the app: the Excel and CSV
 * downloads, and the rows sent to a synced Google Sheet.
 */

import type { Prisma } from "@/app/generated/prisma/client";

export const CONTACT_EXPORT_SELECT = {
  id: true,
  igAccountId: true,
  igsid: true,
  username: true,
  email: true,
  phone: true,
  fields: true,
  createdAt: true,
  lastInteractionAt: true,
  tags: {
    select: { tag: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  },
  sourceAutomation: { select: { name: true } },
} satisfies Prisma.ContactSelect;

export type ExportableContact = Prisma.ContactGetPayload<{
  select: typeof CONTACT_EXPORT_SELECT;
}>;

export interface FieldDefinition {
  key: string;
  label: string;
}

/**
 * Contact.fields as a map of strings, whatever the column holds. The map has
 * no prototype, so looking up a key like "constructor" finds nothing rather
 * than an inherited property. Spread it into a plain object before writing it.
 */
export function asFieldValues(value: unknown): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, fieldValue] of Object.entries(value)) {
    if (typeof fieldValue === "string") out[key] = fieldValue;
  }
  return out;
}

// Column headers shared by the downloads and the synced sheet. Custom fields
// go between Phone and Tags, in the order they were created.
export const LEADING_HEADERS = [
  "Contact ID",
  "Instagram account",
  "Instagram user ID",
  "Username",
  "Email",
  "Phone",
] as const;
export const TRAILING_HEADERS = [
  "Tags",
  "Source campaign",
  "First seen",
  "Last interaction",
] as const;

export function contactExportHeader(fields: readonly FieldDefinition[]): string[] {
  return [
    ...LEADING_HEADERS,
    ...fields.map((field) => field.label),
    ...TRAILING_HEADERS,
  ];
}

export function contactExportRow(
  contact: ExportableContact,
  fields: readonly FieldDefinition[],
  accountUsernames: ReadonlyMap<string, string>,
  formatDate: (date: Date) => string
): string[] {
  const values = asFieldValues(contact.fields);
  return [
    contact.id,
    accountUsernames.get(contact.igAccountId) ?? contact.igAccountId,
    contact.igsid,
    contact.username ?? "",
    contact.email ?? "",
    contact.phone ?? "",
    ...fields.map((field) => values[field.key] ?? ""),
    contact.tags.map(({ tag }) => tag.name).join(", "),
    contact.sourceAutomation?.name ?? "",
    formatDate(contact.createdAt),
    formatDate(contact.lastInteractionAt),
  ];
}

/**
 * Format dates for a download in the viewer's own time zone, as
 * "2026-09-29 14:03", which also sorts correctly as text. An unknown zone
 * falls back to UTC.
 */
export function exportDateFormatter(timeZone: string | null | undefined) {
  let zone = "UTC";
  if (timeZone) {
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone });
      zone = timeZone;
    } catch {
      // Not a zone this runtime knows; keep UTC.
    }
  }
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return (date: Date) => {
    const parts = Object.fromEntries(
      format.formatToParts(date).map((part) => [part.type, part.value])
    );
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  };
}
