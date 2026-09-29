import { createHash } from "node:crypto";
import { UnrecoverableError, Worker, type Job } from "bullmq";
import {
  getDMQueue,
  getRedisConnection,
  MESSAGE_JOB_NAME,
  POSTBACK_JOB_NAME,
  FOLLOWUP_JOB_NAME,
  type DmQueueJob,
  type ProcessCommentJob,
  type ProcessMessageJob,
  type ProcessPostbackJob,
  type ProcessFollowUpJob,
} from "./client";
import { prisma } from "@/lib/db/client";
import {
  MetaApiError,
  RateLimitError,
  TokenExpiredError,
  getUserFollowStatus,
  sendCommentReply,
  sendDirectMessage,
  sendDirectMessageWithButton,
  sendDirectMessageWithLinkButton,
  sendDirectMessageWithQuickReplies,
  sendPrivateReply,
  sendPrivateReplyWithButton,
  sendPrivateReplyWithLinkButton,
  sendPrivateReplyWithQuickReplies,
  type QuickReply,
} from "@/lib/instagram/provider";
import {
  createInstagramContext,
  hasInstagramCredentials,
  type InstagramContext,
} from "@/lib/instagram/provider";
import { matchKeywords } from "@/lib/utils/keyword-matcher";
import { reserveDMSlot, releaseDMSlot } from "@/lib/utils/rate-limiter";
import {
  releaseWorkspaceDMReservation,
  reserveWorkspaceDMSend,
} from "@/lib/billing/usage";
import { recordWorkerAlert } from "@/lib/ops/worker-health";
import {
  buildTrackedUrl,
  renderMessageWithTracking,
  renderMessageWithoutLink,
} from "@/lib/tracking/message";
import { TRACKED_LINK_ORDER } from "@/lib/tracking/link-order";
import { parseAnswer, type ContactDataType } from "@/lib/contacts/answers";
import {
  claimQuestion,
  closeQuestion,
  findOpenQuestion,
  openQuestion,
  recordFailedAnswer,
  saveContactAnswer,
  trackContact,
  type OpenQuestion,
  type TrackedContact,
} from "@/lib/contacts/store";

import {
  ZernioApiError,
  ZernioDeliveryUnconfirmedError,
} from "@/lib/zernio/client";

const BACKOFF_DELAYS = [5 * 60 * 1000, 15 * 60 * 1000, 45 * 60 * 1000];

function formatError(error: unknown): string {
  if (error instanceof MetaApiError) {
    return `${error.name} ${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

// Meta rejections that a plain-text retry cannot fix: the send was refused for
// the conversation, not for the button template. Retrying as text just burns
// the attempt and — worse — overwrites the real error with a misleading one
// ("invalid for a private reply", because the first attempt already used up the
// comment's single allowed private reply).
const NON_TEMPLATE_REJECTIONS = [
  /outside of allowed window/i,
  /invalid for a private reply/i,
  /requested user cannot be found/i,
];

function isTemplateRejection(error: unknown): boolean {
  if (
    error instanceof TokenExpiredError ||
    error instanceof RateLimitError ||
    error instanceof ZernioApiError
  ) {
    return false;
  }
  const message = error instanceof Error ? error.message : "";
  return !NON_TEMPLATE_REJECTIONS.some((pattern) => pattern.test(message));
}

type WorkerTrackedLink = {
  slug: string;
  label: string | null;
  destinationUrl: string;
};

/**
 * Build the tappable link buttons for a DM. The first link uses the campaign's
 * `linkButtonLabel`; each additional link uses its own stored `label`. Capped at
 * Meta's 3-button limit for a button template.
 */
function buildLinkButtons(
  trackedLinks: WorkerTrackedLink[],
  primaryLabel: string | null
): { title: string; url: string }[] {
  return trackedLinks.slice(0, 3).map((link, index) => ({
    url: buildTrackedUrl(link.slug),
    title:
      (index === 0 ? primaryLabel : link.label) || link.label || "Open link",
  }));
}

/**
 * Fallback text when Meta rejects the button template: render the primary link
 * inline, then append any extra tracked URLs on their own lines so no link is
 * lost.
 */
function buildInlineLinkFallback(
  message: string,
  commenterName: string | null | undefined,
  trackedLinks: WorkerTrackedLink[],
  bodyText: string
): string {
  const base =
    renderMessageWithTracking({ message, commenterName, trackedLinks }) ||
    bodyText;
  const extraUrls = trackedLinks
    .slice(1)
    .map((link) => buildTrackedUrl(link.slug));
  return extraUrls.length > 0 ? `${base}\n${extraUrls.join("\n")}` : base;
}

type RevealAutomation = {
  dmMessage: string;
  linkButtonLabel: string | null;
  trackedLinks: WorkerTrackedLink[];
  instagramAccount: { instagramId: string };
};

/**
 * Deliver a campaign's reveal message as a direct message. Shared by the
 * button-tap (postback) path and the DM keyword-trigger path — both already
 * have an open conversation with the user, so neither uses a private reply.
 */
async function sendRevealDirectMessage({
  accessToken,
  automation,
  userId,
  commenterName,
  context,
}: {
  accessToken: InstagramContext;
  automation: RevealAutomation;
  userId: string;
  commenterName: string | null;
  context: string;
}): Promise<void> {
  if (automation.trackedLinks.length === 0) {
    await sendDirectMessage({
      context: accessToken,
      instagramAccountId: automation.instagramAccount.instagramId,
      userId: userId,
      message: renderMessageWithTracking({
        message: automation.dmMessage,
        commenterName,
        trackedLinks: automation.trackedLinks,
      }),
    });
    return;
  }

  // Try button template first; if Meta rejects it, fall back to inline links.
  const bodyText =
    renderMessageWithoutLink({
      message: automation.dmMessage,
      commenterName,
    }) || "Here's your link:";
  const buttons = buildLinkButtons(
    automation.trackedLinks,
    automation.linkButtonLabel
  );

  try {
    await sendDirectMessageWithLinkButton({
      context: accessToken,
      instagramAccountId: automation.instagramAccount.instagramId,
      userId: userId,
      text: bodyText,
      buttons: buttons,
    });
  } catch (buttonError) {
    // A closed messaging window rejects the text retry too, so don't let it
    // overwrite the original error with a misleading one.
    if (!isTemplateRejection(buttonError)) throw buttonError;

    console.log(
      `[DM Worker] Button template rejected in ${context}, falling back to inline link:`,
      formatError(buttonError)
    );
    try {
      await sendDirectMessage({
        context: accessToken,
        instagramAccountId: automation.instagramAccount.instagramId,
        userId: userId,
        message: buildInlineLinkFallback(
          automation.dmMessage,
          commenterName,
          automation.trackedLinks,
          bodyText
        ),
      });
    } catch {
      throw buttonError;
    }
  }
}

// Meta's cap on a button template's text, and on a plain text message.
const BUTTON_TEXT_LIMIT = 640;
const TEXT_MESSAGE_LIMIT = 1000;

// An answer that still doesn't parse after this many tries ends the question,
// so nobody is left stuck in front of it.
const MAX_ANSWER_ATTEMPTS = 3;

type AskAutomation = {
  id: string;
  askEnabled?: boolean | null;
  askType?: ContactDataType | null;
  askMessage?: string | null;
  askRetryMessage?: string | null;
  askFieldKey?: string | null;
  askAfterLink?: boolean | null;
  askThanksMessage?: string | null;
};

type AskStep = {
  type: ContactDataType;
  message: string;
  fieldKey: string | null;
  afterLink: boolean;
};

/** The campaign's question, or null when it doesn't ask for anything. */
function askStepFor(automation: AskAutomation): AskStep | null {
  const message = automation.askMessage?.trim();
  if (!automation.askEnabled || !automation.askType || !message) return null;
  if (automation.askType === "TEXT" && !automation.askFieldKey) return null;
  return {
    type: automation.askType,
    message,
    fieldKey: automation.askFieldKey ?? null,
    afterLink: Boolean(automation.askAfterLink),
  };
}

/**
 * The quick reply that offers the email or phone number on the person's
 * Instagram profile. A free-text question gets none.
 */
function quickRepliesFor(
  type: ContactDataType,
  automationId: string
): QuickReply[] | null {
  if (type === "EMAIL") {
    return [
      { content_type: "user_email", title: "Email", payload: `ask_email:${automationId}` },
    ];
  }
  if (type === "PHONE") {
    return [
      {
        content_type: "user_phone_number",
        title: "Phone",
        payload: `ask_phone:${automationId}`,
      },
    ];
  }
  return null;
}

/**
 * A message with the question under it, or null when both don't fit in one
 * Instagram message. Nothing is ever cut: a cut could take the link with it.
 */
function withQuestion(text: string, question: string, limit: number): string | null {
  const combined = `${text}\n\n${question}`;
  return combined.length <= limit ? combined : null;
}

/**
 * Ask a question in an open conversation, with the email or phone quick reply
 * when there is one. If Meta rejects the quick reply, the question goes out as
 * plain text: the answer can always be typed.
 */
async function sendQuestionDirectMessage({
  accessToken,
  instagramAccountId,
  userId,
  text,
  quickReplies,
}: {
  accessToken: InstagramContext;
  instagramAccountId: string;
  userId: string;
  text: string;
  quickReplies: QuickReply[] | null;
}): Promise<void> {
  const sendText = () =>
    sendDirectMessage({
      context: accessToken,
      instagramAccountId,
      userId,
      message: text,
    });
  if (!quickReplies) {
    await sendText();
    return;
  }
  try {
    await sendDirectMessageWithQuickReplies({
      context: accessToken,
      instagramAccountId,
      userId,
      text,
      quickReplies,
    });
  } catch (error) {
    if (!isTemplateRejection(error)) throw error;
    console.log(
      "[DM Worker] Quick reply rejected, asking in plain text:",
      formatError(error)
    );
    try {
      await sendText();
    } catch {
      throw error;
    }
  }
}

/**
 * Ask a question as the one private reply a comment allows. Meta does not
 * document quick replies on private replies, so a rejected one falls back to
 * plain text, exactly as a rejected button template does.
 */
async function sendQuestionAsPrivateReply({
  accessToken,
  instagramAccountId,
  commentId,
  postId,
  text,
  quickReplies,
}: {
  accessToken: InstagramContext;
  instagramAccountId: string;
  commentId: string;
  postId: string;
  text: string;
  quickReplies: QuickReply[] | null;
}): Promise<void> {
  const sendText = () =>
    sendPrivateReply({
      context: accessToken,
      instagramAccountId,
      commentId,
      message: text,
      postId,
    });
  if (!quickReplies) {
    await sendText();
    return;
  }
  try {
    await sendPrivateReplyWithQuickReplies({
      context: accessToken,
      instagramAccountId,
      commentId,
      text,
      quickReplies,
      postId,
    });
  } catch (error) {
    if (!isTemplateRejection(error)) throw error;
    console.log(
      "[DM Worker] Quick reply rejected on a private reply, asking in plain text:",
      formatError(error)
    );
    try {
      await sendText();
    } catch {
      throw error;
    }
  }
}

type FollowUpAutomation = {
  id: string;
  instagramAccountId: string;
  followUpEnabled?: boolean | null;
  followUpMessage?: string | null;
  followUpDelayMinutes?: number | null;
  instagramAccount: { instagramId: string };
};

/**
 * Optional appreciation follow-up: once the link has been delivered, send a
 * short thank-you. It is scheduled as its own delayed job so it can go out
 * some minutes later (followUpDelayMinutes) rather than immediately. The
 * deterministic job id dedupes repeat button taps to one follow-up per user.
 */
async function scheduleFollowUp(
  automation: FollowUpAutomation,
  userId: string,
  commenterName: string | null
): Promise<void> {
  if (!automation.followUpEnabled || !automation.followUpMessage?.trim()) return;
  await getDMQueue().add(
    FOLLOWUP_JOB_NAME,
    {
      instagramAccountId: automation.instagramAccount.instagramId,
      accountConnectionId: automation.instagramAccountId,
      userId,
      automationId: automation.id,
      commenterName,
    },
    {
      delay: Math.max(0, automation.followUpDelayMinutes ?? 0) * 60_000,
      jobId: `followup_${automation.id}_${userId}`,
    }
  );
}

type RevealStepAutomation = RevealAutomation & AskAutomation & FollowUpAutomation;

/**
 * The campaign's next step once the conversation is open — after a button
 * tap, a keyword DM, or a settled question: the link, or, when the campaign
 * asks for data in exchange for it, the question, with the link following the
 * answer. A question asked after the link goes out right after it, and then
 * the follow-up waits for the answer.
 *
 * `once` wraps the message this step always sends, so a repeated tap can be
 * deduplicated; it reports false when that message was already delivered.
 */
async function deliverRevealStep({
  accessToken,
  automation,
  userId,
  commenterName,
  contactId,
  skipQuestion = false,
  context,
  once = async (send) => {
    await send();
    return true;
  },
}: {
  accessToken: InstagramContext;
  automation: RevealStepAutomation;
  userId: string;
  commenterName: string | null;
  contactId: string | null;
  skipQuestion?: boolean;
  context: string;
  once?: (send: () => Promise<unknown>) => Promise<boolean>;
}): Promise<boolean> {
  const ask = contactId && !skipQuestion ? askStepFor(automation) : null;
  const question = (afterLink: boolean) =>
    ask && contactId
      ? openQuestion({
          contactId,
          automationId: automation.id,
          type: ask.type,
          fieldKey: ask.fieldKey,
          afterLink,
        })
      : Promise.resolve(false);
  const sendQuestion = () =>
    sendQuestionDirectMessage({
      accessToken,
      instagramAccountId: automation.instagramAccount.instagramId,
      userId,
      text: renderMessageWithoutLink({ message: ask?.message ?? "", commenterName }),
      quickReplies: ask ? quickRepliesFor(ask.type, automation.id) : null,
    });

  // The question is opened inside `once`, so a repeated tap that `once`
  // stops never reopens a question the person may already have answered.
  // It is opened before its message goes out, so an answer typed the moment
  // it lands still finds it.
  let asked = false;
  const delivered = await once(async () => {
    if (ask && !ask.afterLink && (await question(false))) {
      asked = true;
      try {
        await sendQuestion();
      } catch (error) {
        // A question that never arrived must not claim their next DM. One
        // that may have arrived stays open.
        if (contactId && !(error instanceof ZernioDeliveryUnconfirmedError)) {
          await closeQuestion(contactId, automation.id).catch(() => {});
        }
        throw error;
      }
      return;
    }
    await sendRevealDirectMessage({
      accessToken,
      automation,
      userId,
      commenterName,
      context,
    });
  });
  if (!delivered || asked) return delivered;

  if (ask?.afterLink && contactId && (await question(true))) {
    // The link is already out, so a question that fails is logged rather
    // than retried along with the link, and the follow-up isn't held for it.
    try {
      await sendQuestion();
      return true;
    } catch (error) {
      await closeQuestion(contactId, automation.id).catch(() => {});
      console.log(
        `[DM Worker] Could not ask the question after the link in ${context}:`,
        formatError(error)
      );
    }
  }

  await scheduleFollowUp(automation, userId, commenterName);
  return true;
}


function connectionScope(data: DmQueueJob) {
  return data.accountConnectionId ? { instagramAccountId: data.accountConnectionId } : {};
}

async function processComment(job: Job<ProcessCommentJob>): Promise<void> {
  const {
    instagramAccountId,
    commentId,
    commentText,
    commenterId,
    commenterName,
    mediaId,
    originalMediaId,
  } = job.data;
  const requeueAttempt = job.data.requeueAttempt ?? 0;

  const automations = await prisma.automation.findMany({
    where: {
      ...connectionScope(job.data),
      // Match campaigns bound to this specific post, plus any-post campaigns.
      // A comment left on an ad carries the ad's own media id, while the
      // campaign is bound to the post the ad was created from, so both ids
      // have to be considered or the comment is dropped without a trace.
      OR: [
        { postId: mediaId },
        ...(originalMediaId ? [{ postId: originalMediaId }] : []),
        { matchAnyPost: true },
      ],
      isActive: true,
      instagramAccount: {
        instagramId: instagramAccountId,
      },
    },
    include: {
      instagramAccount: true,
      workspace: true,
      trackedLinks: {
        select: {
          slug: true,
          label: true,
          destinationUrl: true,
        },
        orderBy: TRACKED_LINK_ORDER,
      },
    },
    orderBy: { createdAt: "asc" },
  });

  for (const automation of automations) {
    // "Any word" campaigns fire on every comment; otherwise require a keyword hit.
    const matchResult = automation.matchAnyWord
      ? { matched: true, matchedKeyword: null }
      : matchKeywords(
          commentText,
          automation.keywords,
          automation.wholeWordMatch
        );

    if (!matchResult.matched) {
      continue;
    }

    const existingLog = await prisma.dmLog.findUnique({
      where: {
        automationId_commentId: {
          automationId: automation.id,
          commentId,
        },
      },
    });

    const alreadyDmd = existingLog?.status === "SENT";
    const alreadyPublicReplied = Boolean(existingLog?.publicReplySentAt);
    const needsDm = !alreadyDmd && !existingLog?.dmDeliveryUnconfirmed;

    // Skip only when there is genuinely nothing left to do. A comment whose DM
    // already sent but whose public reply never posted (e.g. it hit a rate
    // limit) must still come back so the public reply can be retried.
    if (existingLog?.status === "SKIPPED_PLAN_LIMIT") continue;
    if (
      !needsDm &&
      (alreadyPublicReplied || existingLog?.publicReplyDeliveryUnconfirmed || !automation.publicReplyEnabled)
    ) {
      continue;
    }

    // Everyone a campaign fires for becomes a contact, with its tags.
    const contact = await trackContact({
      workspaceId: automation.workspaceId,
      igAccountId: instagramAccountId,
      igsid: commenterId,
      username: commenterName,
      automationId: automation.id,
      tags: automation.contactTags,
    });

    if (!hasInstagramCredentials(automation.instagramAccount)) {
      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        create: {
          workspaceId: automation.workspaceId,
          automationId: automation.id,
          instagramAccountId: automation.instagramAccountId,
          commenterId,
          commenterName,
          commentText,
          commentId,
          matchedKeyword: matchResult.matchedKeyword,
          status: "FAILED",
          errorMessage: "No Instagram access token available",
        },
        update: {
          status: "FAILED",
          errorMessage: "No Instagram access token available",
        },
      });
      continue;
    }

    let accessToken: InstagramContext;
    try {
      accessToken = await createInstagramContext(
        automation.instagramAccount,
        `${job.id}:${automation.id}`
      );
    } catch {
      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        create: {
          workspaceId: automation.workspaceId,
          automationId: automation.id,
          instagramAccountId: automation.instagramAccountId,
          commenterId,
          commenterName,
          commentText,
          commentId,
          matchedKeyword: matchResult.matchedKeyword,
          status: "FAILED",
          errorMessage: "Failed to decrypt Instagram access token",
        },
        update: {
          status: "FAILED",
          errorMessage: "Failed to decrypt Instagram access token",
        },
      });
      continue;
    }

    // Ensure a log row exists before the public reply leg (which updates it).
    // Only (re)set PENDING when the DM will actually be attempted, so a prior
    // SENT is never clobbered while we come back just to retry the public reply.
    if (!existingLog) {
      await prisma.dmLog.create({
        data: {
          workspaceId: automation.workspaceId,
          automationId: automation.id,
          instagramAccountId: automation.instagramAccountId,
          commenterId,
          commenterName,
          commentText,
          commentId,
          matchedKeyword: matchResult.matchedKeyword,
          status: "PENDING",
          attempts: job.attemptsMade + 1,
        },
      });
    } else if (needsDm) {
      await prisma.dmLog.update({
        where: {
          automationId_commentId: { automationId: automation.id, commentId },
        },
        data: {
          status: "PENDING",
          attempts: job.attemptsMade + 1,
          matchedKeyword: matchResult.matchedKeyword,
          errorMessage: null,
        },
      });
    }

    // Public reply leg — decoupled from the DM and posted first so a DM failure
    // (e.g. a non-follower whose messaging is restricted) never suppresses it.
    // Idempotent across retries via publicReplySentAt.
    const replyPool =
      automation.publicReplyMessages.length > 0
        ? automation.publicReplyMessages
        : automation.publicReplyMessage
          ? [automation.publicReplyMessage]
          : [];
    if (
      automation.publicReplyEnabled &&
      replyPool.length > 0 &&
      !existingLog?.publicReplySentAt &&
      !existingLog?.publicReplyDeliveryUnconfirmed
    ) {
      try {
        const chosen = replyPool[Math.floor(Math.random() * replyPool.length)];
        const publicReply = renderMessageWithTracking({
          message: chosen,
          commenterName,
          trackedLinks: automation.trackedLinks,
        });
        await sendCommentReply({
          context: accessToken,
          commentId: commentId,
          message: publicReply,
          postId: mediaId,
        });
        await prisma.dmLog.update({
          where: {
            automationId_commentId: { automationId: automation.id, commentId },
          },
          data: { publicReplySentAt: new Date(), publicReplyError: null },
        });
      } catch (error) {
        console.error(
          "[DM Worker] Public comment reply failed:",
          formatError(error)
        );
        await prisma.dmLog
          .update({
            where: {
              automationId_commentId: {
                automationId: automation.id,
                commentId,
              },
            },
            data: { publicReplyError: formatError(error), publicReplyDeliveryUnconfirmed: error instanceof ZernioDeliveryUnconfirmedError },
          })
          .catch(() => {});
      }
    }

    // DM already sent on an earlier pass; the public reply retry above was all
    // this run needed. Don't re-send the DM.
    if (!needsDm) continue;

    // Meta allows exactly ONE private reply per comment, ever — across every
    // campaign. When several campaigns match the same comment (duplicated
    // campaigns, or an any-post campaign overlapping a post-specific one), only
    // the first can deliver; the rest would fail with "The comment is invalid
    // for a private reply". Skip them explicitly instead of burning an API call
    // and logging a failure the user can do nothing about. The public reply
    // above still goes out per campaign — only the DM leg is deduped.
    const privateReplyUsedBy = await prisma.dmLog.findFirst({
      where: {
        commentId,
        status: "SENT",
        automationId: { not: automation.id },
      },
      select: { automation: { select: { name: true } } },
    });
    if (privateReplyUsedBy) {
      await prisma.dmLog.update({
        where: {
          automationId_commentId: { automationId: automation.id, commentId },
        },
        data: {
          status: "SKIPPED_DEDUP",
          matchedKeyword: matchResult.matchedKeyword,
          errorMessage: `Another campaign (${privateReplyUsedBy.automation?.name ?? "unknown"}) already sent the one private reply Instagram allows for this comment`,
        },
      });
      continue;
    }

    const usage = await reserveWorkspaceDMSend(automation.workspaceId);
    if (!usage.allowed) {
      await prisma.dmLog.update({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        data: {
          status: "SKIPPED_PLAN_LIMIT",
          matchedKeyword: matchResult.matchedKeyword,
          errorMessage: `Monthly DM limit reached (${usage.limit})`,
        },
      });
      continue;
    }

    let rateLimit;
    try {
      rateLimit = await reserveDMSlot(instagramAccountId, requeueAttempt);
    } catch (error) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );
      await prisma.dmLog.update({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        data: {
          status: "FAILED",
          attempts: job.attemptsMade + 1,
          errorMessage: formatError(error),
          dmDeliveryUnconfirmed: error instanceof ZernioDeliveryUnconfirmedError,
        },
      });
      throw error;
    }

    if (!rateLimit.allowed) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );

      if (rateLimit.shouldSkip) {
        await prisma.dmLog.update({
          where: {
            automationId_commentId: {
              automationId: automation.id,
              commentId,
            },
          },
          data: {
            status: "SKIPPED_RATE_LIMIT",
            matchedKeyword: matchResult.matchedKeyword,
            errorMessage: "Hourly Instagram DM rate limit reached",
          },
        });
        continue;
      }

      if (rateLimit.shouldRequeue) {
        await prisma.dmLog.update({
          where: {
            automationId_commentId: {
              automationId: automation.id,
              commentId,
            },
          },
          data: {
            status: "PENDING",
            matchedKeyword: matchResult.matchedKeyword,
            errorMessage: "Hourly rate limit hit; retry scheduled",
          },
        });

        await getDMQueue().add(
          "process-comment",
          {
            ...job.data,
            requeueAttempt: requeueAttempt + 1,
          },
          {
            delay: rateLimit.requeueDelayMs,
            jobId: `comment_${instagramAccountId}_${commentId}_retry_${requeueAttempt + 1}`,
          }
        );
        continue;
      }
    }

    // With an opening DM, the private reply is a button message; tapping it
    // fires a postback that delivers the reveal (see processPostback). Without
    // one, we send the reveal text directly as today.
    const useOpeningDm =
      automation.openingDmEnabled &&
      Boolean(automation.openingDmMessage) &&
      Boolean(automation.openingDmButtonLabel);

    // Follow-gating: the link is revealed only after a follow. When an opening
    // DM is enabled it comes FIRST, and its button routes into the follow check
    // (opening DM → follow gate → link). Without an opening DM, we check follow
    // status at comment time: confirmed followers get the link now, everyone
    // else gets the "follow me first" prompt (re-verified on tap).
    let sendFollowPrompt = false;
    if (automation.requireFollow && !useOpeningDm) {
      const alreadyFollows = await getUserFollowStatus({
        context: accessToken,
        recipientId: commenterId,
      });
      sendFollowPrompt =
        accessToken.provider === "ZERNIO"
          ? alreadyFollows === false
          : alreadyFollows !== true;
    }

    // A campaign that asks for data asks right where the link would go out.
    // Asked in exchange for the link, the question is this comment's one
    // private reply. Asked after the link, it rides in the link's message,
    // since a private reply allows no second message until they answer, and
    // only when both fit in one message. It is opened before the send, so an
    // answer typed the moment it lands still finds it.
    const ask =
      contact && !useOpeningDm && !sendFollowPrompt ? askStepFor(automation) : null;
    const questionText = ask
      ? renderMessageWithoutLink({ message: ask.message, commenterName })
      : "";
    const hasLinks = automation.trackedLinks.length > 0;
    // The button template's text: its buttons carry the links.
    const linkText =
      renderMessageWithoutLink({
        message: automation.dmMessage,
        commenterName,
      }) || "Here's your link:";
    const plainText = renderMessageWithTracking({
      message: automation.dmMessage,
      commenterName,
      trackedLinks: automation.trackedLinks,
    });
    const linkWithQuestion = ask?.afterLink
      ? withQuestion(
          hasLinks ? linkText : plainText,
          questionText,
          hasLinks ? BUTTON_TEXT_LIMIT : TEXT_MESSAGE_LIMIT
        )
      : null;
    const questionOpen =
      ask && contact && (!ask.afterLink || linkWithQuestion)
        ? await openQuestion({
            contactId: contact.id,
            automationId: automation.id,
            type: ask.type,
            fieldKey: ask.fieldKey,
            afterLink: ask.afterLink,
          })
        : false;
    let questionPending = questionOpen;

    try {
      if (useOpeningDm) {
        const openingText = renderMessageWithTracking({
          message: automation.openingDmMessage as string,
          commenterName,
          trackedLinks: [],
        });
        await sendPrivateReplyWithButton({
          context: accessToken,
          instagramAccountId: automation.instagramAccount.instagramId,
          commentId: commentId,
          text: openingText,
          buttonTitle: automation.openingDmButtonLabel as string,
          payload: automation.requireFollow
            ? `followcheck:${automation.id}`
            : `reveal:${automation.id}`,
          postId: mediaId,
        });
      } else if (sendFollowPrompt) {
        const promptText = renderMessageWithoutLink({
          message:
            automation.followPromptMessage ||
            "quick favor before i send your link. i don't make any money from this, it's free. if you want to support me, just don't unfollow after, and star the repo on github if it helps you. tap the button once you're following and i'll send it over",
          commenterName,
        });
        await sendPrivateReplyWithButton({
          context: accessToken,
          instagramAccountId: automation.instagramAccount.instagramId,
          commentId: commentId,
          text: promptText,
          buttonTitle: automation.followPromptButtonLabel || "i'm following",
          payload: `followcheck:${automation.id}`,
          postId: mediaId,
        });
      } else if (questionOpen && ask && !ask.afterLink) {
        await sendQuestionAsPrivateReply({
          accessToken,
          instagramAccountId: automation.instagramAccount.instagramId,
          commentId,
          postId: mediaId,
          text: questionText,
          quickReplies: quickRepliesFor(ask.type, automation.id),
        });
      } else if (hasLinks) {
        // Try button template first; if Meta rejects it, fall back to inline links.
        const buttons = buildLinkButtons(
          automation.trackedLinks,
          automation.linkButtonLabel
        );

        try {
          await sendPrivateReplyWithLinkButton({
            context: accessToken,
            instagramAccountId: automation.instagramAccount.instagramId,
            commentId: commentId,
            text: (questionOpen && linkWithQuestion) || linkText,
            buttons: buttons,
            postId: mediaId,
          });
        } catch (buttonError) {
          // Only a template rejection is worth retrying as text. Anything else
          // (closed window, comment already replied to) fails the same way and
          // would replace the real error with a misleading one.
          if (!isTemplateRejection(buttonError)) throw buttonError;

          console.log(
            "[DM Worker] Button template rejected, falling back to inline link:",
            formatError(buttonError)
          );
          const inlineMessage = buildInlineLinkFallback(
            automation.dmMessage,
            commenterName,
            automation.trackedLinks,
            linkText
          );
          const inlineWithQuestion = questionOpen
            ? withQuestion(inlineMessage, questionText, TEXT_MESSAGE_LIMIT)
            : null;
          if (questionOpen && !inlineWithQuestion && contact) {
            // The links as text and the question don't both fit: the links win.
            await closeQuestion(contact.id, automation.id).catch(() => {});
            questionPending = false;
          }
          try {
            await sendPrivateReply({
              context: accessToken,
              instagramAccountId: automation.instagramAccount.instagramId,
              commentId: commentId,
              message: inlineWithQuestion ?? inlineMessage,
              postId: mediaId,
            });
          } catch {
            // The first attempt consumed the comment's single private reply, so
            // this one reports "invalid for a private reply" no matter what the
            // underlying problem was. Surface the original rejection instead.
            throw buttonError;
          }
        }
      } else {
        await sendPrivateReply({
          context: accessToken,
          instagramAccountId: automation.instagramAccount.instagramId,
          commentId: commentId,
          message: (questionOpen && linkWithQuestion) || plainText,
          postId: mediaId,
        });
      }

      await prisma.dmLog.update({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        data: {
          status: "SENT",
          dmSentAt: new Date(),
          errorMessage: null,
        },
      });
    } catch (error) {
      // A question that never arrived must not claim their next DM.
      if (
        questionPending &&
        contact &&
        !(error instanceof ZernioDeliveryUnconfirmedError)
      ) {
        await closeQuestion(contact.id, automation.id).catch(() => {});
      }
      // The rate slot was reserved before the send; this send did not deliver a
      // DM, so hand the slot back instead of burning it (and burning more on
      // each BullMQ retry) until the hourly TTL expires.
      if (rateLimit?.reserved) {
        await releaseDMSlot(instagramAccountId);
      }
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );

      await prisma.dmLog.update({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        data: {
          status: "FAILED",
          attempts: job.attemptsMade + 1,
          errorMessage: formatError(error),
          dmDeliveryUnconfirmed: error instanceof ZernioDeliveryUnconfirmedError,
        },
      });
      throw error;
    }
  }
}

async function sendPostbackOnce({
  operationId,
  send,
}: {
  operationId: string | null;
  send: () => Promise<unknown>;
}): Promise<boolean> {
  if (!operationId) {
    await send();
    return true;
  }
  try {
    await prisma.postbackDelivery.create({ data: { id: operationId } });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    )
      return false;
    throw error;
  }
  try {
    await send();
    return true;
  } catch (error) {
    // A durable claim survives queue eviction, concurrent redelivery, and a
    // process crash during delivery. Only confirmed rejections permit retry.
    if (
      (error instanceof ZernioApiError && error.code < 500) ||
      error instanceof RateLimitError ||
      error instanceof TokenExpiredError
    ) {
      await prisma.postbackDelivery.delete({ where: { id: operationId } });
      throw error;
    }
    throw error instanceof ZernioDeliveryUnconfirmedError
      ? error
      : new ZernioDeliveryUnconfirmedError();
  }
}

/**
 * Deliver the reveal message after a user taps an opening DM's button.
 * The postback payload is `reveal:<automationId>`; the sender is the user's
 * IGSID (same id as their comment author id), which we DM directly.
 */
async function processPostback(job: Job<ProcessPostbackJob>): Promise<void> {
  const { instagramAccountId, userId, payload, fallback, answered } = job.data;

  const isFollowCheck = payload.startsWith("followcheck:");
  if (!isFollowCheck && !payload.startsWith("reveal:")) return;
  const automationId = payload.slice(
    isFollowCheck ? "followcheck:".length : "reveal:".length,
  );

  const automation = await prisma.automation.findFirst({
    where: { id: automationId, isActive: true, ...connectionScope(job.data) },
    include: {
      instagramAccount: true,
      workspace: true,
      trackedLinks: {
        select: { slug: true, label: true, destinationUrl: true },
        orderBy: TRACKED_LINK_ORDER,
      },
    },
  });

  if (
    !automation ||
    automation.instagramAccount.instagramId !== instagramAccountId ||
    !hasInstagramCredentials(automation.instagramAccount)
  ) {
    return;
  }

  // Duplicate sends are enabled: every button tap re-sends the reveal
  // instead of only firing once per person. The link that follows an
  // answered question is logged on its own row.
  const dedupeId = answered ? `answer:${userId}` : `reveal:${userId}`;
  const logText = answered ? "(answered question)" : "(button tap)";

  if (fallback) {
    const existingReveal = await prisma.dmLog.findUnique({
      where: {
        automationId_commentId: {
          automationId: automation.id,
          commentId: dedupeId,
        },
      },
    });
    if (
      existingReveal?.status === "SENT" ||
      existingReveal?.dmDeliveryUnconfirmed
    )
      return;
  }

  // Personalize {username} from the opening DM log for this user, if present.
  const openingLog = await prisma.dmLog.findFirst({
    where: { automationId: automation.id, commenterId: userId },
    select: { commenterName: true },
  });
  const commenterName = openingLog?.commenterName ?? null;

  // A tap is the person writing to the account: it opens Instagram's 24-hour
  // window. A read receipt doesn't, and an answer was already counted when
  // its DM arrived.
  const contact = await trackContact({
    workspaceId: automation.workspaceId,
    igAccountId: instagramAccountId,
    igsid: userId,
    username: commenterName,
    inbound: !fallback && !answered,
    automationId: automation.id,
    tags: automation.contactTags,
  });

  let accessToken: InstagramContext;
  try {
    accessToken = await createInstagramContext(
      automation.instagramAccount,
      `${job.id}:${automation.id}`,
    );
  } catch {
    return;
  }

  const operationId =
    accessToken.provider === "ZERNIO"
      ? createHash("sha256")
          .update(
            JSON.stringify([
              automation.instagramAccountId,
              automation.id,
              userId,
              job.data.mid ?? job.id ?? payload,
            ]),
          )
          .digest("hex")
      : null;

  // Follow-gate: before revealing the link, verify the user follows. On a
  // `followcheck:` tap a non-follower gets the prompt again (no quota spent);
  // on a read fallback a non-follower is silently skipped — the gate must not
  // be bypassable by just reading the DM and waiting. Following, or
  // unverifiable (null), falls through and delivers the link — fail-open so a
  // real follower is never trapped.
  if ((isFollowCheck || fallback) && automation.requireFollow) {
    const follows = await getUserFollowStatus({
      context: accessToken,
      recipientId: userId,
    });
    if (follows === false) {
      if (fallback) return;
      const promptText = renderMessageWithoutLink({
        message:
          automation.followPromptMessage ||
          "quick favor before i send your link. i don't make any money from this, it's free. if you want to support me, just don't unfollow after, and star the repo on github if it helps you. tap the button once you're following and i'll send it over",
        commenterName,
      });
      try {
        await sendPostbackOnce({
          operationId,
          send: () =>
            sendDirectMessageWithButton({
              context: accessToken,
              instagramAccountId: automation.instagramAccount.instagramId,
              userId: userId,
              text: promptText,
              buttonTitle:
                automation.followPromptButtonLabel || "i'm following",
              payload: `followcheck:${automation.id}`,
            }),
        });
      } catch (error) {
        console.log(
          "[DM Worker] Failed to re-send follow prompt:",
          formatError(error),
        );
      }
      return;
    }
  }

  const usage = await reserveWorkspaceDMSend(automation.workspaceId);
  if (!usage.allowed) {
    await prisma.dmLog.upsert({
      where: {
        automationId_commentId: {
          automationId: automation.id,
          commentId: dedupeId,
        },
      },
      create: {
        workspaceId: automation.workspaceId,
        automationId: automation.id,
        instagramAccountId: automation.instagramAccountId,
        commenterId: userId,
        commenterName,
        commentText: logText,
        commentId: dedupeId,
        status: "SKIPPED_PLAN_LIMIT",
        errorMessage: `Monthly DM limit reached (${usage.limit})`,
      },
      update: { status: "SKIPPED_PLAN_LIMIT" },
    });
    return;
  }

  try {
    const delivered = await deliverRevealStep({
      accessToken,
      automation,
      userId,
      commenterName,
      contactId: contact?.id ?? null,
      skipQuestion: Boolean(answered),
      context: "postback",
      once: (send) => sendPostbackOnce({ operationId, send }),
    });
    if (!delivered) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart,
      );
      return;
    }
    await prisma.dmLog.upsert({
      where: {
        automationId_commentId: {
          automationId: automation.id,
          commentId: dedupeId,
        },
      },
      create: {
        workspaceId: automation.workspaceId,
        automationId: automation.id,
        instagramAccountId: automation.instagramAccountId,
        commenterId: userId,
        commenterName,
        commentText: logText,
        commentId: dedupeId,
        status: "SENT",
        dmSentAt: new Date(),
      },
      update: { status: "SENT", dmSentAt: new Date(), errorMessage: null },
    });
  } catch (error) {
    await releaseWorkspaceDMReservation(
      automation.workspaceId,
      usage.periodStart,
    );

    // The read fallback is speculative: it only runs when the user read the
    // opening DM and never tapped the button, which means they never messaged
    // us, which means the 24-hour window is closed and Meta rejects the send
    // ("outside of allowed window"). That is the expected outcome here, not a
    // failure the user can act on — so don't log it as FAILED and don't retry
    // it against a window that cannot reopen on its own. It still delivers in
    // the case that does work: the user replied by typing instead of tapping.
    if (fallback && !(error instanceof ZernioDeliveryUnconfirmedError)) {
      console.log(
        "[DM Worker] Read fallback not delivered (messaging window closed):",
        formatError(error),
      );
      return;
    }

    await prisma.dmLog.upsert({
      where: {
        automationId_commentId: {
          automationId: automation.id,
          commentId: dedupeId,
        },
      },
      create: {
        workspaceId: automation.workspaceId,
        automationId: automation.id,
        instagramAccountId: automation.instagramAccountId,
        commenterId: userId,
        commenterName,
        commentText: logText,
        commentId: dedupeId,
        status: "FAILED",
        errorMessage: formatError(error),
        dmDeliveryUnconfirmed: error instanceof ZernioDeliveryUnconfirmedError,
      },
      update: {
        status: "FAILED",
        errorMessage: formatError(error),
        dmDeliveryUnconfirmed: error instanceof ZernioDeliveryUnconfirmedError,
      },
    });
    throw error;
  }
}

/**
 * Send the scheduled appreciation follow-up. Runs after its delay elapses.
 * Best-effort: if the message can't be delivered (e.g. the 24-hour messaging
 * window closed because the delay was long), it is logged, not retried forever.
 */
async function processFollowUp(job: Job<ProcessFollowUpJob>): Promise<void> {
  const { instagramAccountId, userId, automationId, commenterName } = job.data;

  const automation = await prisma.automation.findFirst({
    where: { id: automationId, isActive: true, ...connectionScope(job.data) },
    include: { instagramAccount: true },
  });

  if (
    !automation ||
    !automation.followUpEnabled ||
    !automation.followUpMessage?.trim() ||
    automation.instagramAccount.instagramId !== instagramAccountId ||
    !hasInstagramCredentials(automation.instagramAccount)
  ) {
    return;
  }

  let accessToken: InstagramContext;
  try {
    accessToken = await createInstagramContext(
      automation.instagramAccount,
      `${job.id}:${automation.id}`
    );
  } catch {
    return;
  }

  try {
    await sendDirectMessage({
      context: accessToken,
      instagramAccountId: automation.instagramAccount.instagramId,
      userId: userId,
      message: renderMessageWithoutLink({
        message: automation.followUpMessage,
        commenterName: commenterName ?? null,
      }),
    });
  } catch (error) {
    console.log(
      "[DM Worker] Failed to send follow-up message:",
      formatError(error)
    );
  }
}

/** Record whoever sent a DM as a contact of the account it was sent to. */
async function trackMessageSender(
  data: ProcessMessageJob
): Promise<TrackedContact | null> {
  const account = await prisma.instagramAccount
    .findUnique({
      where: { instagramId: data.instagramAccountId },
      select: { id: true, workspaceId: true },
    })
    .catch(() => null);
  if (!account) return null;
  if (data.accountConnectionId && account.id !== data.accountConnectionId) {
    return null;
  }
  return trackContact({
    workspaceId: account.workspaceId,
    igAccountId: data.instagramAccountId,
    igsid: data.senderId,
    inbound: true,
  });
}

/**
 * Read a DM as the answer to the question a campaign is waiting on. Returns
 * false when nothing is waiting — or its campaign was paused or deleted — so
 * the DM is handled like any other.
 */
async function answerOpenQuestion(
  job: Job<ProcessMessageJob>,
  contact: TrackedContact
): Promise<boolean> {
  const { instagramAccountId, messageId, messageText, senderId } = job.data;

  const question = await findOpenQuestion(contact.id);
  if (!question) return false;

  // The DM that set this campaign off is not its answer. When the job for it
  // runs again (a retry after another campaign's send failed), it has to reach
  // keyword matching again rather than answer the question it just asked.
  const askedByThisMessage = await prisma.dmLog.findUnique({
    where: {
      automationId_commentId: {
        automationId: question.automationId,
        commentId: `dm:${messageId}`,
      },
    },
    select: { id: true },
  });
  if (askedByThisMessage) return false;

  const automation = await prisma.automation.findFirst({
    where: {
      id: question.automationId,
      isActive: true,
      ...connectionScope(job.data),
    },
    include: { instagramAccount: true },
  });
  if (
    !automation ||
    automation.instagramAccount.instagramId !== instagramAccountId ||
    !hasInstagramCredentials(automation.instagramAccount)
  ) {
    await closeQuestion(contact.id, question.automationId);
    return false;
  }

  // Once claimed, the question is gone. If carrying on fails, it is put back
  // so the retry of this message reads it as the answer again; every step
  // after the claim is safe to repeat.
  const settle = async (answered: boolean, value?: string) => {
    try {
      if (answered && value !== undefined) {
        await saveContactAnswer({
          contactId: contact.id,
          type: question.type,
          fieldKey: question.fieldKey,
          value,
        });
      }
      await continueAfterQuestion(job, automation, question, contact, answered);
    } catch (error) {
      await openQuestion({
        contactId: contact.id,
        automationId: question.automationId,
        type: question.type,
        fieldKey: question.fieldKey,
        afterLink: question.afterLink,
      });
      throw error;
    }
  };

  const answer = parseAnswer(question.type, messageText);
  if (answer.ok) {
    // Another message may be answering at the same moment; one wins.
    if (await claimQuestion(question)) await settle(true, answer.value);
    return true;
  }

  const attempts = await recordFailedAnswer(question);
  if (attempts === null) return true;
  if (attempts >= MAX_ANSWER_ATTEMPTS) {
    if (await claimQuestion(question)) await settle(false);
    return true;
  }

  // Ask again: the retry message, or the question itself when there is none.
  const retryText = automation.askRetryMessage?.trim() || automation.askMessage?.trim();
  if (!retryText) return true;
  try {
    const accessToken = await createInstagramContext(
      automation.instagramAccount,
      `${job.id}:${automation.id}`
    );
    await sendQuestionDirectMessage({
      accessToken,
      instagramAccountId: automation.instagramAccount.instagramId,
      userId: senderId,
      text: renderMessageWithoutLink({
        message: retryText,
        commenterName: contact.username,
      }),
      quickReplies: quickRepliesFor(question.type, automation.id),
    });
  } catch (error) {
    console.log("[DM Worker] Could not ask the question again:", formatError(error));
  }
  return true;
}

/**
 * Carry the campaign on once its question is settled — answered, or given up
 * on after too many tries, so nobody is left stuck.
 */
async function continueAfterQuestion(
  job: Job<ProcessMessageJob>,
  automation: FollowUpAutomation & {
    askThanksMessage: string | null;
    instagramAccount: Parameters<typeof createInstagramContext>[0];
  },
  question: OpenQuestion,
  contact: TrackedContact,
  answered: boolean
): Promise<void> {
  const { instagramAccountId, messageId, senderId } = job.data;

  if (!question.afterLink) {
    // The link was waiting on the answer. It goes out as a queued tap, which
    // brings the tap path's retries, logging and follow-up; the job id keeps a
    // retried message from sending it twice.
    await getDMQueue().add(
      POSTBACK_JOB_NAME,
      {
        instagramAccountId,
        accountConnectionId: automation.instagramAccountId,
        userId: senderId,
        payload: `reveal:${automation.id}`,
        mid: messageId,
        answered: true,
      },
      {
        jobId: `answer_${instagramAccountId}_${Buffer.from(messageId).toString("base64url")}`,
      }
    );
    return;
  }

  const thanks = automation.askThanksMessage?.trim();
  if (answered && thanks) {
    try {
      const accessToken = await createInstagramContext(
        automation.instagramAccount,
        `${job.id}:${automation.id}`
      );
      await sendDirectMessage({
        context: accessToken,
        instagramAccountId: automation.instagramAccount.instagramId,
        userId: senderId,
        message: renderMessageWithoutLink({
          message: thanks,
          commenterName: contact.username,
        }),
      });
    } catch (error) {
      console.log(
        "[DM Worker] Could not send the thank-you for an answer:",
        formatError(error)
      );
    }
  }
  // With the question after the link, the follow-up waited for this moment.
  await scheduleFollowUp(automation, senderId, contact.username);
}

/**
 * Reply to an inbound DM whose text matches a campaign's keywords.
 *
 * The user has messaged us, so the conversation is already open: this path
 * skips the opening DM (which exists to work around private-reply limits from
 * comments) and delivers the reveal directly, honouring the follow gate.
 * Dedup is per inbound message id, so each message triggers at most one reply.
 */
async function processMessage(job: Job<ProcessMessageJob>): Promise<void> {
  const { instagramAccountId, messageId, messageText, senderId } = job.data;

  // Whoever messages the account is a contact, and their DM opens Instagram's
  // 24-hour window. If a campaign is waiting on an answer from them, this DM
  // is that answer: it is handled here and never reaches keyword matching, so
  // an answer can't set off a campaign.
  const contact = await trackMessageSender(job.data);
  if (contact && (await answerOpenQuestion(job, contact))) return;

  const automations = await prisma.automation.findMany({
    where: {
      ...connectionScope(job.data),
      dmTriggerEnabled: true,
      isActive: true,
      instagramAccount: { instagramId: instagramAccountId },
    },
    include: {
      instagramAccount: true,
      workspace: true,
      trackedLinks: {
        select: { slug: true, label: true, destinationUrl: true },
        orderBy: TRACKED_LINK_ORDER,
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const dedupeId = `dm:${messageId}`;

  for (const automation of automations) {
    const matchResult = automation.matchAnyWord
      ? { matched: true, matchedKeyword: null }
      : matchKeywords(
          messageText,
          automation.keywords,
          automation.wholeWordMatch
        );

    if (!matchResult.matched) continue;

    const existingLog = await prisma.dmLog.findUnique({
      where: {
        automationId_commentId: {
          automationId: automation.id,
          commentId: dedupeId,
        },
      },
    });

    // Already replied to this message (or deliberately skipped it) — a retry
    // of the job must not send a second DM.
    if (
      existingLog?.status === "SENT" ||
      existingLog?.status === "SKIPPED_PLAN_LIMIT" ||
      existingLog?.dmDeliveryUnconfirmed
    ) {
      continue;
    }

    const logBase = {
      workspaceId: automation.workspaceId,
      automationId: automation.id,
      instagramAccountId: automation.instagramAccountId,
      commenterId: senderId,
      commentText: messageText,
      commentId: dedupeId,
      matchedKeyword: matchResult.matchedKeyword,
    };

    if (!hasInstagramCredentials(automation.instagramAccount)) {
      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId: dedupeId,
          },
        },
        create: {
          ...logBase,
          status: "FAILED",
          errorMessage: "No Instagram access token available",
        },
        update: {
          status: "FAILED",
          errorMessage: "No Instagram access token available",
        },
      });
      continue;
    }

    let accessToken: InstagramContext;
    try {
      accessToken = await createInstagramContext(
        automation.instagramAccount,
        `${job.id}:${automation.id}`
      );
    } catch {
      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId: dedupeId,
          },
        },
        create: {
          ...logBase,
          status: "FAILED",
          errorMessage: "Failed to decrypt Instagram access token",
        },
        update: {
          status: "FAILED",
          errorMessage: "Failed to decrypt Instagram access token",
        },
      });
      continue;
    }

    // Reuse a name captured on an earlier interaction so {username} still
    // renders — the messages webhook carries only the sender's IGSID.
    const priorLog = await prisma.dmLog.findFirst({
      where: { automationId: automation.id, commenterId: senderId },
      select: { commenterName: true },
    });
    const commenterName = priorLog?.commenterName ?? contact?.username ?? null;

    // The campaign fired for them: record it as their source and add its tags.
    if (contact) {
      await trackContact({
        workspaceId: automation.workspaceId,
        igAccountId: instagramAccountId,
        igsid: senderId,
        automationId: automation.id,
        tags: automation.contactTags,
      });
    }

    // Follow gate: anyone not confirmed as a follower gets the prompt instead of
    // the link, with the same `followcheck:` button that re-verifies on tap.
    // `null` (unverifiable) prompts too — this is first contact, exactly like a
    // comment, so it follows processComment's fail-closed rule rather than the
    // postback path's fail-open one. Fail-open is only safe after a tap, where
    // the user has already claimed to follow; here it would hand the link to
    // anyone whose status the API happens not to resolve.
    let sendFollowPrompt = false;
    if (automation.requireFollow) {
      const follows = await getUserFollowStatus({
        context: accessToken,
        recipientId: senderId,
      });
      sendFollowPrompt =
        accessToken.provider === "ZERNIO"
          ? follows === false
          : follows !== true;
    }

    const usage = await reserveWorkspaceDMSend(automation.workspaceId);
    if (!usage.allowed) {
      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId: dedupeId,
          },
        },
        create: {
          ...logBase,
          status: "SKIPPED_PLAN_LIMIT",
          errorMessage: `Monthly DM limit reached (${usage.limit})`,
        },
        update: {
          status: "SKIPPED_PLAN_LIMIT",
          errorMessage: `Monthly DM limit reached (${usage.limit})`,
        },
      });
      continue;
    }

    try {
      if (sendFollowPrompt) {
        const promptText = renderMessageWithoutLink({
          message:
            automation.followPromptMessage ||
            "Almost there! Follow me and tap the button below to grab your link 💛",
          commenterName,
        });
        await sendDirectMessageWithButton({
          context: accessToken,
          instagramAccountId: automation.instagramAccount.instagramId,
          userId: senderId,
          text: promptText,
          buttonTitle: automation.followPromptButtonLabel || "I'm following ✅",
          payload: `followcheck:${automation.id}`,
        });
      } else {
        // The link (or the question asked in exchange for it) goes out, and
        // the appreciation follow-up applies here exactly as it does after a
        // button tap. Not behind the follow prompt — no link went out yet in
        // that branch.
        await deliverRevealStep({
          accessToken,
          automation,
          userId: senderId,
          commenterName,
          contactId: contact?.id ?? null,
          context: "message trigger",
        });
      }

      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId: dedupeId,
          },
        },
        create: {
          ...logBase,
          commenterName,
          status: "SENT",
          dmSentAt: new Date(),
        },
        update: {
          status: "SENT",
          dmSentAt: new Date(),
          errorMessage: null,
        },
      });
    } catch (error) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );
      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId: dedupeId,
          },
        },
        create: {
          ...logBase,
          commenterName,
          status: "FAILED",
          attempts: job.attemptsMade + 1,
          errorMessage: formatError(error),
          dmDeliveryUnconfirmed: error instanceof ZernioDeliveryUnconfirmedError,
        },
        update: {
          status: "FAILED",
          attempts: job.attemptsMade + 1,
          errorMessage: formatError(error),
          dmDeliveryUnconfirmed: error instanceof ZernioDeliveryUnconfirmedError,
        },
      });
      throw error;
    }
  }
}

async function dispatchJob(job: Job<DmQueueJob>): Promise<void> {
  if (job.name === POSTBACK_JOB_NAME) {
    return processPostback(job as Job<ProcessPostbackJob>);
  }
  if (job.name === FOLLOWUP_JOB_NAME) {
    return processFollowUp(job as Job<ProcessFollowUpJob>);
  }
  if (job.name === MESSAGE_JOB_NAME) {
    return processMessage(job as Job<ProcessMessageJob>);
  }
  return processComment(job as Job<ProcessCommentJob>);
}

async function processJob(job: Job<DmQueueJob>): Promise<void> {
  try {
    await dispatchJob(job);
  } catch (error) {
    if (error instanceof ZernioDeliveryUnconfirmedError)
      throw new UnrecoverableError(error.message);
    throw error;
  }
}

async function recordWorkerFailure(
  job: Job<DmQueueJob> | undefined,
  error: Error
) {
  try {
    const instagramAccountId = job?.data.instagramAccountId;
    const commentId =
      job && "commentId" in job.data ? job.data.commentId : null;
    const account = instagramAccountId
      ? await prisma.instagramAccount.findUnique({
          where: { instagramId: instagramAccountId },
          select: { workspaceId: true },
        })
      : null;

    await prisma.operationalEvent.create({
      data: {
        workspaceId: account?.workspaceId ?? null,
        source: "WORKER",
        level: "ERROR",
        message: `DM worker job ${job?.id ?? "unknown"} failed: ${error.message}`,
        payload: {
          jobId: job?.id ?? null,
          attemptsMade: job?.attemptsMade ?? null,
          instagramAccountId: instagramAccountId ?? null,
          commentId,
        },
      },
    });

    await recordWorkerAlert({
      level: "error",
      message: error.message,
      jobId: job?.id,
      instagramAccountId,
      commentId: commentId ?? undefined,
    });
  } catch (recordError) {
    console.error(
      "[DM Worker] Failed to record worker failure:",
      formatError(recordError)
    );
  }
}

export function createDMWorker(): Worker<DmQueueJob> {
  const worker = new Worker<DmQueueJob>("dm-processing", processJob, {
    connection: getRedisConnection(),
    concurrency: 5,
    settings: {
      backoffStrategy: (attemptsMade: number) =>
        BACKOFF_DELAYS[Math.min(attemptsMade - 1, BACKOFF_DELAYS.length - 1)],
    },
  });

  worker.on("completed", (job) => {
    console.log(`[DM Worker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(
      `[DM Worker] Job ${job?.id} failed (attempt ${job?.attemptsMade}):`,
      err.message
    );
    void recordWorkerFailure(job, err);
  });

  worker.on("error", (err) => {
    console.error("[DM Worker] Worker error:", err.message);
    void prisma.operationalEvent
      .create({
        data: {
          source: "WORKER",
          level: "ERROR",
          message: `DM worker process error: ${err.message}`,
          payload: { name: err.name },
        },
      })
      .catch((recordError) => {
        console.error(
          "[DM Worker] Failed to record worker process error:",
          formatError(recordError)
        );
      });
  });

  return worker;
}
