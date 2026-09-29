/**
 * Reading the data people type into a DM: an email, a phone number, or a free
 * text answer. Deliberately lenient — the answer arrives as a chat message, so
 * "my email is ana@example.com" has to work as well as the bare address.
 */

export type ContactDataType = "EMAIL" | "PHONE" | "TEXT";

export type ParsedAnswer = { ok: true; value: string } | { ok: false };

// Enough of RFC 5322 to accept the addresses people actually have, without
// accepting a sentence that merely contains an @.
const EMAIL_PATTERN =
  /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}/;

// A run of digits that may carry spaces, dots, dashes and parentheses, as
// people write phone numbers: "+54 9 11 2345-6789", "(011) 4567-8901".
const PHONE_PATTERN = /\+?\d[\d\s().-]{6,}\d/;

const MAX_TEXT_ANSWER_LENGTH = 500;

export function parseEmail(text: string): ParsedAnswer {
  const match = text.match(EMAIL_PATTERN);
  if (!match) return { ok: false };
  const email = match[0].toLowerCase();
  const [local] = email.split("@");
  if (
    email.length > 254 ||
    local.length > 64 ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..")
  ) {
    return { ok: false };
  }
  return { ok: true, value: email };
}

/**
 * Keep a phone number as digits, with the leading "+" when it had one, so the
 * same number typed two ways is stored the same way. 8 to 15 digits: the
 * shortest local numbers with an area code, up to the E.164 maximum.
 */
export function parsePhone(text: string): ParsedAnswer {
  const match = text.match(PHONE_PATTERN);
  if (!match) return { ok: false };
  const digits = match[0].replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return { ok: false };
  return { ok: true, value: `${match[0].startsWith("+") ? "+" : ""}${digits}` };
}

export function parseTextAnswer(text: string): ParsedAnswer {
  const value = text.trim();
  if (!value) return { ok: false };
  return { ok: true, value: value.slice(0, MAX_TEXT_ANSWER_LENGTH) };
}

export function parseAnswer(type: ContactDataType, text: string): ParsedAnswer {
  if (type === "EMAIL") return parseEmail(text);
  if (type === "PHONE") return parsePhone(text);
  return parseTextAnswer(text);
}

const MAX_TAG_LENGTH = 50;

/** Tag names are kept as typed, minus stray whitespace. */
export function normalizeTagName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, MAX_TAG_LENGTH);
}

/** Normalize a list of tag names, dropping blanks and repeats. */
export function normalizeTagNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = normalizeTagName(raw);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

const MAX_FIELD_LABEL_LENGTH = 40;

// Columns every contact already has. A custom field with one of these keys
// would collide with them in exports and in the synced sheet. "constructor"
// is the one lowercase key every JavaScript object already answers to.
export const RESERVED_FIELD_KEYS = new Set([
  "constructor",
  "id",
  "contact_id",
  "instagram_account",
  "instagram_user_id",
  "username",
  "email",
  "phone",
  "tags",
  "source_campaign",
  "first_seen",
  "last_interaction",
]);

export function normalizeFieldLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").slice(0, MAX_FIELD_LABEL_LENGTH);
}

/**
 * The stable key a custom field's values are stored under: the label in
 * lowercase ASCII with accents removed, e.g. "Ciudad de envío" becomes
 * "ciudad_de_envio".
 */
export function fieldKeyFromLabel(label: string): string {
  return normalizeFieldLabel(label)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
