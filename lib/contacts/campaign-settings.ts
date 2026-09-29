import { z } from "zod";
import { prisma } from "@/lib/db/client";
import type { ContactDataType } from "@/app/generated/prisma/client";
import {
  RESERVED_FIELD_KEYS,
  fieldKeyFromLabel,
  normalizeFieldLabel,
  normalizeTagNames,
} from "./answers";
import { ensureTags } from "./store";

/**
 * The campaign settings for contacts, as the campaign editor sends them. A
 * free-text question names its field by label; the server turns that into a
 * custom field, creating it the first time.
 */
export const campaignContactFields = {
  askEnabled: z.boolean().optional(),
  askType: z.enum(["EMAIL", "PHONE", "TEXT"]).optional().nullable(),
  askMessage: z.string().max(1000).optional().nullable(),
  askRetryMessage: z.string().max(1000).optional().nullable(),
  askFieldLabel: z.string().max(40).optional().nullable(),
  askAfterLink: z.boolean().optional(),
  askThanksMessage: z.string().max(1000).optional().nullable(),
  contactTags: z.array(z.string().max(50)).max(20).optional(),
};

// A question after the link can share one message with it (a comment's
// private reply allows no second message), and Instagram caps a button
// message at 640 characters. The margin leaves room for {username}.
const AFTER_LINK_COMBINED_LIMIT = 600;

type CampaignContactInput = {
  /** The DM with the link, to check that a question after it fits. */
  dmMessage?: string;
  askEnabled?: boolean;
  askType?: ContactDataType | null;
  askMessage?: string | null;
  askRetryMessage?: string | null;
  askFieldLabel?: string | null;
  askAfterLink?: boolean;
  askThanksMessage?: string | null;
  contactTags?: string[];
};

export type CampaignContactData = {
  askEnabled?: boolean;
  askType?: ContactDataType | null;
  askMessage?: string | null;
  askRetryMessage?: string | null;
  askFieldKey?: string | null;
  askAfterLink?: boolean;
  askThanksMessage?: string | null;
  contactTags?: string[];
};

const ASK_OFF: CampaignContactData = {
  askEnabled: false,
  askType: null,
  askMessage: null,
  askRetryMessage: null,
  askFieldKey: null,
  askAfterLink: false,
  askThanksMessage: null,
};

/**
 * Check the contact settings of a campaign save and turn them into the
 * columns to write. Settings left out of `input` are left out of the result,
 * so a partial update keeps them as they are. Returns an error message for the
 * editor when the question is incomplete.
 */
export async function resolveCampaignContactSettings(
  workspaceId: string,
  input: CampaignContactInput
): Promise<{ data: CampaignContactData } | { error: string; field: string }> {
  const data: CampaignContactData = {};

  if (input.contactTags !== undefined) {
    const tags = normalizeTagNames(input.contactTags);
    // Created now so they can be filtered on before anyone is tagged.
    await ensureTags(workspaceId, tags);
    data.contactTags = tags;
  }

  if (input.askEnabled === false) return { data: { ...data, ...ASK_OFF } };
  if (input.askEnabled !== true) return { data };

  const message = input.askMessage?.trim();
  if (!input.askType || !message) {
    return { error: "Your question needs a type and a message.", field: "askMessage" };
  }

  let fieldKey: string | null = null;
  if (input.askType === "TEXT") {
    const label = normalizeFieldLabel(input.askFieldLabel ?? "");
    const key = fieldKeyFromLabel(label);
    if (!key) {
      return { error: "Name the field the answer is saved in.", field: "askFieldLabel" };
    }
    if (RESERVED_FIELD_KEYS.has(key)) {
      return {
        error: `"${label}" is already a contact column. Ask for an email or phone number instead, or pick another name.`,
        field: "askFieldLabel",
      };
    }
    await prisma.contactField.upsert({
      where: { workspaceId_key: { workspaceId, key } },
      create: { workspaceId, key, label },
      update: {},
    });
    fieldKey = key;
  }

  const afterLink = Boolean(input.askAfterLink);
  if (
    afterLink &&
    input.dmMessage !== undefined &&
    input.dmMessage.trim().length + message.length > AFTER_LINK_COMBINED_LIMIT
  ) {
    return {
      error: `A question after the link can go out in the same message as the link, so together they have to fit in ${AFTER_LINK_COMBINED_LIMIT} characters. Shorten the DM or the question.`,
      field: "askMessage",
    };
  }

  return {
    data: {
      ...data,
      askEnabled: true,
      askType: input.askType,
      askMessage: message,
      askRetryMessage:
        input.askType === "TEXT" ? null : input.askRetryMessage?.trim() || null,
      askFieldKey: fieldKey,
      askAfterLink: afterLink,
      askThanksMessage: afterLink ? input.askThanksMessage?.trim() || null : null,
    },
  };
}
