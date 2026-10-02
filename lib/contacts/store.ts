/**
 * Contacts in the database: recording the people who interact with a
 * connected account, their tags, and the question a campaign is waiting on.
 */

import { prisma } from "@/lib/db/client";
import type { ContactDataType } from "@/app/generated/prisma/client";
import { normalizeTagNames } from "./answers";
import { asFieldValues } from "./format";
import { enqueueContactSync } from "./sync";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long an unanswered question keeps reading the person's DMs as its
 * answer. An email or phone number asked for in exchange for the link waits a
 * week: the answer itself reopens Instagram's messaging window, so a late
 * answer can still get its link, and the answer is checked, so an unrelated
 * message isn't taken for one. Anything else waits a day.
 */
export function questionLifetimeMs(type: ContactDataType, afterLink: boolean): number {
  return !afterLink && type !== "TEXT" ? 7 * DAY_MS : DAY_MS;
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function isUniqueViolation(error: unknown): boolean {
  return hasCode(error, "P2002");
}

export interface TrackContactInput {
  workspaceId: string;
  /** The connected business account's Instagram id. */
  igAccountId: string;
  /** The person's Instagram-scoped id. */
  igsid: string;
  username?: string | null;
  /** They messaged the account or tapped a button just now. */
  inbound?: boolean;
  /** Original provider event time in milliseconds, preserved across retries. */
  inboundAt?: number;
  /** The campaign that fired for them, if one did. */
  automationId?: string | null;
  /** Tags to add. Adding a tag they already have is a no-op. */
  tags?: readonly string[];
}

export interface TrackedContact {
  id: string;
  username: string | null;
  automationPaused?: boolean;
  automationPausedUntil?: Date | null;
}

const TRACKED_SELECT = {
  id: true,
  username: true,
  sourceAutomationId: true,
  automationPaused: true,
  automationPausedUntil: true,
} as const;

/**
 * Create or update the contact for someone who just interacted with the
 * account. Best effort by design: it returns null instead of throwing, because
 * a contact that failed to save must never stop a DM from going out.
 */
export async function trackContact(
  input: TrackContactInput
): Promise<TrackedContact | null> {
  try {
    return await upsertContact(input);
  } catch (error) {
    console.error(
      "[Contacts] Could not record contact:",
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

async function upsertContact(input: TrackContactInput): Promise<TrackedContact> {
  const { workspaceId, igAccountId, igsid } = input;
  const where = {
    workspaceId_igAccountId_igsid: { workspaceId, igAccountId, igsid },
  };
  const username = input.username?.trim() || null;
  const automationId = input.automationId ?? null;
  const now = new Date();
  const inboundAt = input.inboundAt !== undefined && Number.isFinite(input.inboundAt) && input.inboundAt > 0
    ? new Date(Math.min(input.inboundAt, now.getTime())) : "inboundAt" in input ? null : now;

  let changed = false;
  let contact = await prisma.contact.findUnique({ where, select: TRACKED_SELECT });

  if (!contact) {
    try {
      contact = await prisma.contact.create({
        data: {
          workspaceId,
          igAccountId,
          igsid,
          username,
          sourceAutomationId: automationId,
          lastInteractionAt: now,
          lastInboundAt: input.inbound ? inboundAt : null,
        },
        select: TRACKED_SELECT,
      });
      changed = true;
    } catch (error) {
      // Two events from the same person landed at once; the other one won.
      if (!isUniqueViolation(error)) throw error;
      contact = await prisma.contact.findUnique({ where, select: TRACKED_SELECT });
      if (!contact) throw error;
    }
  }

  if (!changed) {
    const renamed = Boolean(username && username !== contact.username);
    const sourced = Boolean(automationId && !contact.sourceAutomationId);
    contact = await prisma.contact.update({
      where: { id: contact.id },
      data: {
        lastInteractionAt: now,
        ...(renamed ? { username } : {}),
        ...(sourced ? { sourceAutomationId: automationId } : {}),
      },
      select: TRACKED_SELECT,
    });
    changed = renamed || sourced;
  }

  if (input.inbound && inboundAt) await prisma.contact.updateMany({
    where: { id: contact.id, OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: inboundAt } }] },
    data: { lastInboundAt: inboundAt },
  });

  if (input.tags?.length) {
    const added = await addContactTags(workspaceId, contact.id, input.tags);
    if (added > 0) changed = true;
  }

  if (changed) await enqueueContactSync(workspaceId, [contact.id]);
  return { id: contact.id, username: contact.username, automationPaused: contact.automationPaused, automationPausedUntil: contact.automationPausedUntil };
}

/**
 * Make sure the workspace has these tags, creating the missing ones, and
 * return them. Safe to call concurrently for the same names.
 */
export async function ensureTags(
  workspaceId: string,
  names: readonly string[]
): Promise<{ id: string; name: string }[]> {
  const normalized = normalizeTagNames(names);
  if (normalized.length === 0) return [];
  await prisma.tag.createMany({
    data: normalized.map((name) => ({ workspaceId, name })),
    skipDuplicates: true,
  });
  return prisma.tag.findMany({
    where: { workspaceId, name: { in: normalized } },
    select: { id: true, name: true },
  });
}

/** Add tags to a contact. Returns how many it did not already have. */
export async function addContactTags(
  workspaceId: string,
  contactId: string,
  names: readonly string[]
): Promise<number> {
  const tags = await ensureTags(workspaceId, names);
  if (tags.length === 0) return 0;
  const { count } = await prisma.contactTag.createMany({
    data: tags.map((tag) => ({ contactId, tagId: tag.id })),
    skipDuplicates: true,
  });
  return count;
}

export interface OpenQuestionInput {
  contactId: string;
  automationId: string;
  type: ContactDataType;
  fieldKey?: string | null;
  afterLink: boolean;
}

export interface OpenQuestion {
  contactId: string;
  automationId: string;
  type: ContactDataType;
  fieldKey: string | null;
  afterLink: boolean;
  attempts: number;
  createdAt: Date;
}

/**
 * Start waiting for an answer. Returns whether the question may be asked.
 *
 * One question per contact. A question from the same campaign is replaced
 * (asked again), and so is an expired one or one asked after its campaign's
 * link, which only has data pending. A question another campaign asked in
 * exchange for its link is left alone and false comes back: that link is
 * waiting on the answer, so the caller carries on without asking.
 *
 * Never throws: a question that can't be recorded is simply not asked, and
 * the DM goes out without it.
 */
export async function openQuestion(input: OpenQuestionInput): Promise<boolean> {
  const now = new Date();
  const data = {
    automationId: input.automationId,
    type: input.type,
    fieldKey: input.fieldKey ?? null,
    afterLink: input.afterLink,
    attempts: 0,
    expiresAt: new Date(now.getTime() + questionLifetimeMs(input.type, input.afterLink)),
    // Doubles as the question's version: an answer only acts on the exact
    // question it was read against, never on one asked after it.
    createdAt: now,
  };
  try {
    const { count } = await prisma.contactQuestion.updateMany({
      where: {
        contactId: input.contactId,
        OR: [
          { automationId: input.automationId },
          { expiresAt: { lte: now } },
          { afterLink: true },
        ],
      },
      data,
    });
    if (count > 0) return true;
    await prisma.contactQuestion.create({
      data: { contactId: input.contactId, ...data },
    });
    return true;
  } catch (error) {
    // A unique violation means another campaign's question is still waiting.
    if (!isUniqueViolation(error)) {
      console.error(
        "[Contacts] Could not record the question:",
        error instanceof Error ? error.message : error
      );
    }
    return false;
  }
}

/** Stop waiting on a campaign's question. Another campaign's is left alone. */
export async function closeQuestion(
  contactId: string,
  automationId: string
): Promise<void> {
  await prisma.contactQuestion.deleteMany({ where: { contactId, automationId } });
}

/** The question the contact still owes an answer to, if any. */
export async function findOpenQuestion(
  contactId: string
): Promise<OpenQuestion | null> {
  const question = await prisma.contactQuestion.findUnique({
    where: { contactId },
  });
  if (!question) return null;
  if (question.expiresAt.getTime() <= Date.now()) {
    await prisma.contactQuestion.deleteMany({
      where: { contactId, createdAt: question.createdAt },
    });
    return null;
  }
  return question;
}

/**
 * Take the question off the contact so exactly one answer acts on it. False
 * when another message already took it, or a newer question replaced it.
 */
export async function claimQuestion(
  question: Pick<OpenQuestion, "contactId" | "createdAt">
): Promise<boolean> {
  const { count } = await prisma.contactQuestion.deleteMany({
    where: { contactId: question.contactId, createdAt: question.createdAt },
  });
  return count > 0;
}

/**
 * Count an answer that didn't parse. Returns the attempts so far, read back
 * from the same update so answers arriving together each count, or null when
 * the question was answered or replaced in the meantime.
 */
export async function recordFailedAnswer(
  question: Pick<OpenQuestion, "contactId" | "createdAt">
): Promise<number | null> {
  try {
    const updated = await prisma.contactQuestion.update({
      where: { contactId: question.contactId, createdAt: question.createdAt },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });
    return updated.attempts;
  } catch (error) {
    if (hasCode(error, "P2025")) return null;
    throw error;
  }
}

/** Keep a valid answer on the contact. A newer answer replaces an older one. */
export async function saveContactAnswer({
  contactId,
  type,
  fieldKey,
  value,
}: {
  contactId: string;
  type: ContactDataType;
  fieldKey: string | null;
  value: string;
}): Promise<void> {
  if (type === "TEXT") {
    if (!fieldKey) return;
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { fields: true, workspaceId: true },
    });
    if (!contact) return;
    await prisma.contact.update({
      where: { id: contactId },
      data: { fields: { ...asFieldValues(contact.fields), [fieldKey]: value } },
    });
    await enqueueContactSync(contact.workspaceId, [contactId]);
    return;
  }

  const contact = await prisma.contact.update({
    where: { id: contactId },
    data: type === "EMAIL" ? { email: value } : { phone: value },
    select: { workspaceId: true },
  });
  await enqueueContactSync(contact.workspaceId, [contactId]);
}
