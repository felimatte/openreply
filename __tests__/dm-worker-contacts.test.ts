/**
 * DM worker — contacts and the "ask for their data" step.
 *
 * The data layer (lib/contacts/store) is mocked: these tests pin down what the
 * worker sends to Instagram and when it opens, reads and closes a question.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockPrisma,
  meta,
  store,
  mockMatchKeywords,
  mockQueueAdd,
} = vi.hoisted(() => ({
  mockPrisma: {
    zernioConnection: { findUnique: vi.fn() },
    postbackDelivery: { create: vi.fn(), delete: vi.fn() },
    automation: { findMany: vi.fn(), findFirst: vi.fn() },
    dmLog: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    instagramAccount: { findUnique: vi.fn() },
    operationalEvent: { create: vi.fn() },
  },
  meta: {
    sendPrivateReply: vi.fn(),
    sendPrivateReplyWithLinkButton: vi.fn(),
    sendPrivateReplyWithButton: vi.fn(),
    sendPrivateReplyWithQuickReplies: vi.fn(),
    sendDirectMessage: vi.fn(),
    sendDirectMessageWithButton: vi.fn(),
    sendDirectMessageWithLinkButton: vi.fn(),
    sendDirectMessageWithQuickReplies: vi.fn(),
    getUserFollowStatus: vi.fn(),
  },
  store: {
    trackContact: vi.fn(),
    findOpenQuestion: vi.fn(),
    openQuestion: vi.fn(),
    closeQuestion: vi.fn(),
    claimQuestion: vi.fn(),
    recordFailedAnswer: vi.fn(),
    saveContactAnswer: vi.fn(),
  },
  mockMatchKeywords: vi.fn(),
  mockQueueAdd: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));

vi.mock("@/lib/meta/client", () => ({
  ...meta,
  sendCommentReply: vi.fn(),
  MetaApiError: class MetaApiError extends Error {},
  TokenExpiredError: class TokenExpiredError extends Error {
    name = "TokenExpiredError";
  },
  RateLimitError: class RateLimitError extends Error {
    name = "RateLimitError";
  },
}));

vi.mock("@/lib/meta/oauth", () => ({ decryptToken: () => "decrypted_token" }));
vi.mock("@/lib/utils/keyword-matcher", () => ({ matchKeywords: mockMatchKeywords }));
vi.mock("@/lib/utils/rate-limiter", () => ({
  reserveDMSlot: vi.fn(async () => ({
    allowed: true,
    shouldRequeue: false,
    requeueDelayMs: 0,
    shouldSkip: false,
    reserved: true,
  })),
  releaseDMSlot: vi.fn(),
}));
vi.mock("@/lib/billing/usage", () => ({
  reserveWorkspaceDMSend: vi.fn(async () => ({
    allowed: true,
    reserved: true,
    remaining: 100,
    limit: 2000,
    periodStart: new Date("2026-09-01T00:00:00.000Z"),
  })),
  releaseWorkspaceDMReservation: vi.fn(),
}));
vi.mock("@/lib/ops/worker-health", () => ({ recordWorkerAlert: vi.fn() }));
vi.mock("@/lib/contacts/store", () => store);
vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({ add: mockQueueAdd }),
  getRedisConnection: vi.fn(),
  POSTBACK_JOB_NAME: "process-postback",
  FOLLOWUP_JOB_NAME: "process-followup",
  MESSAGE_JOB_NAME: "process-message",
}));
vi.mock("bullmq", () => {
  function MockWorker(_name: string, processor: unknown) {
    (global as Record<string, unknown>).__contactsWorkerProcessor = processor;
    return { on: vi.fn(), close: vi.fn() };
  }
  return {
    Worker: MockWorker,
    UnrecoverableError: class UnrecoverableError extends Error {},
  };
});

import { createDMWorker } from "../lib/queue/dm-worker";

type Processor = (job: {
  name?: string;
  data: Record<string, unknown>;
  id: string;
  attemptsMade: number;
}) => Promise<void>;

function processor(): Processor {
  createDMWorker();
  return (global as Record<string, unknown>).__contactsWorkerProcessor as Processor;
}

const account = {
  id: "ig_account_row_1",
  instagramId: "ig_456",
  accessToken: "encrypted_token",
  provider: "META",
  workspaceId: "workspace_123",
  zernioAccountId: null,
};

const baseCampaign = {
  id: "auto_789",
  workspaceId: "workspace_123",
  instagramAccountId: "ig_account_row_1",
  postId: "media_101",
  keywords: ["GUIDE"],
  matchAnyWord: false,
  wholeWordMatch: true,
  dmTriggerEnabled: true,
  dmMessage: "Here is the guide {username}: {link}",
  openingDmEnabled: false,
  openingDmMessage: null,
  openingDmButtonLabel: null,
  linkButtonLabel: "Open guide",
  requireFollow: false,
  followPromptMessage: null,
  followPromptButtonLabel: null,
  followUpEnabled: false,
  followUpMessage: null,
  followUpDelayMinutes: 0,
  publicReplyEnabled: false,
  publicReplyMessage: null,
  publicReplyMessages: [],
  askEnabled: false,
  askType: null,
  askMessage: null,
  askRetryMessage: null,
  askFieldKey: null,
  askAfterLink: false,
  askThanksMessage: null,
  contactTags: [] as string[],
  instagramAccount: account,
  workspace: { id: "workspace_123" },
  trackedLinks: [
    { slug: "abc123", label: "Open guide", destinationUrl: "https://example.com/guide" },
  ],
};

const askForEmail = {
  askEnabled: true,
  askType: "EMAIL",
  askMessage: "Where should I send it, {username}? Drop your email",
  askRetryMessage: "Hmm, that doesn't look like an email. Try again?",
};

const QUESTION = "Where should I send it, ana? Drop your email";
const EMAIL_QUICK_REPLY = [
  { content_type: "user_email", title: "Email", payload: "ask_email:auto_789" },
];

function commentJob() {
  return {
    name: "process-comment",
    data: {
      instagramAccountId: "ig_456",
      commentId: "comment_555",
      commentText: "GUIDE please",
      commenterId: "person_1",
      commenterName: "ana",
      mediaId: "media_101",
    },
    id: "job_comment",
    attemptsMade: 0,
  };
}

function tapJob(extra: Record<string, unknown> = {}) {
  return {
    name: "process-postback",
    data: {
      instagramAccountId: "ig_456",
      userId: "person_1",
      payload: "reveal:auto_789",
      mid: "mid_tap",
      ...extra,
    },
    id: "job_tap",
    attemptsMade: 0,
  };
}

function messageJob(text: string) {
  return {
    name: "process-message",
    data: {
      instagramAccountId: "ig_456",
      messageId: "mid_answer",
      messageText: text,
      senderId: "person_1",
    },
    id: "job_message",
    attemptsMade: 0,
  };
}

function openQuestionRow(overrides: Record<string, unknown> = {}) {
  return {
    contactId: "contact_1",
    automationId: "auto_789",
    type: "EMAIL",
    fieldKey: null,
    afterLink: false,
    attempts: 0,
    createdAt: new Date("2026-09-29T10:00:00.000Z"),
    ...overrides,
  };
}

const sent = { recipient_id: "person_1", message_id: "m" };

beforeEach(() => {
  vi.clearAllMocks();
  mockQueueAdd.mockReset().mockResolvedValue(undefined);
  mockPrisma.automation.findMany.mockResolvedValue([baseCampaign]);
  mockPrisma.automation.findFirst.mockResolvedValue(baseCampaign);
  mockPrisma.dmLog.findUnique.mockResolvedValue(null);
  mockPrisma.dmLog.findFirst.mockImplementation(
    async (args: { where?: { status?: string } } = {}) =>
      args.where?.status === "SENT" ? null : { commenterName: "ana" }
  );
  mockPrisma.dmLog.create.mockResolvedValue({});
  mockPrisma.dmLog.update.mockResolvedValue({});
  mockPrisma.dmLog.upsert.mockResolvedValue({});
  mockPrisma.instagramAccount.findUnique.mockResolvedValue({
    id: "ig_account_row_1",
    workspaceId: "workspace_123",
  });
  mockPrisma.postbackDelivery.create.mockResolvedValue({});
  mockMatchKeywords.mockReturnValue({ matched: true, matchedKeyword: "GUIDE" });
  for (const send of Object.values(meta)) send.mockResolvedValue(sent);
  meta.getUserFollowStatus.mockResolvedValue(true);

  store.trackContact.mockResolvedValue({ id: "contact_1", username: "ana" });
  store.findOpenQuestion.mockResolvedValue(null);
  store.openQuestion.mockResolvedValue(true);
  store.closeQuestion.mockResolvedValue(undefined);
  store.claimQuestion.mockResolvedValue(true);
  store.recordFailedAnswer.mockResolvedValue(1);
  store.saveContactAnswer.mockResolvedValue(undefined);
});

describe("contacts from comments", () => {
  it("records everyone a campaign fires for, with the campaign's tags", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      { ...baseCampaign, contactTags: ["guide-oct"] },
    ]);

    await processor()(commentJob());

    expect(store.trackContact).toHaveBeenCalledWith({
      workspaceId: "workspace_123",
      igAccountId: "ig_456",
      igsid: "person_1",
      username: "ana",
      automationId: "auto_789",
      tags: ["guide-oct"],
    });
  });

  it("does not record a commenter no campaign fired for", async () => {
    mockMatchKeywords.mockReturnValue({ matched: false, matchedKeyword: null });

    await processor()(commentJob());

    expect(store.trackContact).not.toHaveBeenCalled();
  });

  it("asks for the email as the comment's private reply, in exchange for the link", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      { ...baseCampaign, ...askForEmail },
    ]);

    await processor()(commentJob());

    expect(store.openQuestion).toHaveBeenCalledWith({
      contactId: "contact_1",
      automationId: "auto_789",
      type: "EMAIL",
      fieldKey: null,
      afterLink: false,
    });
    expect(meta.sendPrivateReplyWithQuickReplies).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "comment_555",
      QUESTION,
      EMAIL_QUICK_REPLY
    );
    // The link waits for the answer.
    expect(meta.sendPrivateReplyWithLinkButton).not.toHaveBeenCalled();
    expect(meta.sendPrivateReply).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SENT" }) })
    );
  });

  it("asks in plain text when Meta rejects the quick reply on a private reply", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      { ...baseCampaign, ...askForEmail },
    ]);
    meta.sendPrivateReplyWithQuickReplies.mockRejectedValue(
      new Error("(#100) Invalid parameter")
    );

    await processor()(commentJob());

    expect(meta.sendPrivateReply).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "comment_555",
      QUESTION
    );
    expect(store.closeQuestion).not.toHaveBeenCalled();
  });

  it("closes the question and keeps the real error when the private reply is refused", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      { ...baseCampaign, ...askForEmail },
    ]);
    meta.sendPrivateReplyWithQuickReplies.mockRejectedValue(
      new Error("The comment is invalid for a private reply")
    );

    await expect(processor()(commentJob())).rejects.toThrow(
      "invalid for a private reply"
    );

    expect(meta.sendPrivateReply).not.toHaveBeenCalled();
    expect(store.closeQuestion).toHaveBeenCalledWith("contact_1", "auto_789");
    expect(mockPrisma.dmLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) })
    );
  });

  it("puts the question under the link when it comes after the link", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      { ...baseCampaign, ...askForEmail, askAfterLink: true },
    ]);

    await processor()(commentJob());

    expect(store.openQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ afterLink: true })
    );
    expect(meta.sendPrivateReplyWithLinkButton).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "comment_555",
      `Here is the guide ana:\n\n${QUESTION}`,
      [{ title: "Open guide", url: "http://localhost:3000/r/abc123" }]
    );
  });

  it("sends the link right away when another campaign's question is still waiting", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      { ...baseCampaign, ...askForEmail },
    ]);
    store.openQuestion.mockResolvedValue(false);

    await processor()(commentJob());

    expect(meta.sendPrivateReplyWithQuickReplies).not.toHaveBeenCalled();
    expect(meta.sendPrivateReplyWithLinkButton).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "comment_555",
      "Here is the guide ana:",
      [{ title: "Open guide", url: "http://localhost:3000/r/abc123" }]
    );
  });

  it("leaves a question after the link out when both don't fit in one message", async () => {
    const longMessage = `${"Here is everything you need to know. ".repeat(17)}{link}`;
    mockPrisma.automation.findMany.mockResolvedValue([
      { ...baseCampaign, ...askForEmail, askAfterLink: true, dmMessage: longMessage },
    ]);

    await processor()(commentJob());

    expect(store.openQuestion).not.toHaveBeenCalled();
    const [, , , text] = meta.sendPrivateReplyWithLinkButton.mock.calls[0];
    expect(text).not.toContain("Drop your email");
  });

  it("sends the link as usual when the contact could not be recorded", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      { ...baseCampaign, ...askForEmail },
    ]);
    store.trackContact.mockResolvedValue(null);

    await processor()(commentJob());

    expect(store.openQuestion).not.toHaveBeenCalled();
    expect(meta.sendPrivateReplyWithLinkButton).toHaveBeenCalled();
  });
});

describe("the question after a button tap", () => {
  it("asks for the email instead of sending the link, and holds the follow-up", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue({
      ...baseCampaign,
      ...askForEmail,
      followUpEnabled: true,
      followUpMessage: "Thanks!",
    });

    await processor()(tapJob());

    expect(store.trackContact).toHaveBeenCalledWith(
      expect.objectContaining({ igsid: "person_1", inbound: true })
    );
    expect(meta.sendDirectMessageWithQuickReplies).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "person_1",
      QUESTION,
      EMAIL_QUICK_REPLY
    );
    expect(meta.sendDirectMessageWithLinkButton).not.toHaveBeenCalled();
    expect(mockQueueAdd).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          automationId_commentId: { automationId: "auto_789", commentId: "reveal:person_1" },
        },
        create: expect.objectContaining({ status: "SENT", commentText: "(button tap)" }),
      })
    );
  });

  it("sends the link after the answer, logged on its own row, then the follow-up", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue({
      ...baseCampaign,
      ...askForEmail,
      followUpEnabled: true,
      followUpMessage: "Thanks!",
    });

    await processor()(tapJob({ answered: true, mid: "mid_answer" }));

    expect(meta.sendDirectMessageWithQuickReplies).not.toHaveBeenCalled();
    expect(store.openQuestion).not.toHaveBeenCalled();
    expect(meta.sendDirectMessageWithLinkButton).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "person_1",
      "Here is the guide ana:",
      [{ title: "Open guide", url: "http://localhost:3000/r/abc123" }]
    );
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "process-followup",
      expect.objectContaining({ userId: "person_1", automationId: "auto_789" }),
      expect.objectContaining({ jobId: "followup_auto_789_person_1" })
    );
    expect(mockPrisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          automationId_commentId: { automationId: "auto_789", commentId: "answer:person_1" },
        },
        create: expect.objectContaining({ commentText: "(answered question)" }),
      })
    );
  });

  it("sends the link and then the question when it comes after the link", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue({
      ...baseCampaign,
      ...askForEmail,
      askAfterLink: true,
      followUpEnabled: true,
      followUpMessage: "Thanks!",
    });

    await processor()(tapJob());

    expect(meta.sendDirectMessageWithLinkButton).toHaveBeenCalled();
    expect(store.openQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ afterLink: true })
    );
    expect(meta.sendDirectMessageWithQuickReplies).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "person_1",
      QUESTION,
      EMAIL_QUICK_REPLY
    );
    // The follow-up waits for the answer.
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("sends the link after a tap when another campaign's question is still waiting", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue({ ...baseCampaign, ...askForEmail });
    store.openQuestion.mockResolvedValue(false);

    await processor()(tapJob());

    expect(meta.sendDirectMessageWithQuickReplies).not.toHaveBeenCalled();
    expect(meta.sendDirectMessageWithLinkButton).toHaveBeenCalled();
  });

  it("asks a free-text question without quick replies", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue({
      ...baseCampaign,
      askEnabled: true,
      askType: "TEXT",
      askMessage: "Which city are you in?",
      askFieldKey: "city",
    });

    await processor()(tapJob());

    expect(meta.sendDirectMessage).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "person_1",
      "Which city are you in?"
    );
    expect(meta.sendDirectMessageWithQuickReplies).not.toHaveBeenCalled();
    expect(store.openQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ type: "TEXT", fieldKey: "city" })
    );
  });
});

describe("answers in DMs", () => {
  beforeEach(() => {
    store.findOpenQuestion.mockResolvedValue(openQuestionRow());
    mockPrisma.automation.findFirst.mockResolvedValue({
      ...baseCampaign,
      ...askForEmail,
    });
  });

  it("records the sender as a contact whose DM opened the window", async () => {
    await processor()(messageJob("sure: Ana@Example.com"));

    expect(store.trackContact).toHaveBeenCalledWith({
      workspaceId: "workspace_123",
      igAccountId: "ig_456",
      igsid: "person_1",
      inbound: true,
    });
  });

  it("keeps a valid email and queues the link it was asked in exchange for", async () => {
    await processor()(messageJob("sure: Ana@Example.com"));

    expect(store.saveContactAnswer).toHaveBeenCalledWith({
      contactId: "contact_1",
      type: "EMAIL",
      fieldKey: null,
      value: "ana@example.com",
    });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "process-postback",
      {
        instagramAccountId: "ig_456",
        accountConnectionId: "ig_account_row_1",
        userId: "person_1",
        payload: "reveal:auto_789",
        mid: "mid_answer",
        answered: true,
      },
      { jobId: `answer_ig_456_${Buffer.from("mid_answer").toString("base64url")}` }
    );
    // An answer never reaches keyword matching.
    expect(mockPrisma.automation.findMany).not.toHaveBeenCalled();
  });

  it("puts the question back when the link can't be queued, so a retry reads the answer again", async () => {
    mockQueueAdd.mockRejectedValue(new Error("Redis unavailable"));

    await expect(processor()(messageJob("ana@example.com"))).rejects.toThrow(
      "Redis unavailable"
    );

    expect(store.saveContactAnswer).toHaveBeenCalled();
    expect(store.openQuestion).toHaveBeenCalledWith({
      contactId: "contact_1",
      automationId: "auto_789",
      type: "EMAIL",
      fieldKey: null,
      afterLink: false,
    });
  });

  it("asks again with the retry message when the answer isn't an email", async () => {
    await processor()(messageJob("GUIDE"));

    expect(store.saveContactAnswer).not.toHaveBeenCalled();
    expect(store.recordFailedAnswer).toHaveBeenCalled();
    expect(meta.sendDirectMessageWithQuickReplies).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "person_1",
      "Hmm, that doesn't look like an email. Try again?",
      EMAIL_QUICK_REPLY
    );
    expect(mockQueueAdd).not.toHaveBeenCalled();
    // "GUIDE" is a keyword, but the person was answering: no campaign fires.
    expect(mockPrisma.automation.findMany).not.toHaveBeenCalled();
  });

  it("repeats the question itself when the campaign has no retry message", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue({
      ...baseCampaign,
      ...askForEmail,
      askRetryMessage: null,
    });

    await processor()(messageJob("no"));

    expect(meta.sendDirectMessageWithQuickReplies).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "person_1",
      QUESTION,
      EMAIL_QUICK_REPLY
    );
  });

  it("stops asking after the third try and sends the link anyway", async () => {
    store.findOpenQuestion.mockResolvedValue(openQuestionRow({ attempts: 2 }));
    store.recordFailedAnswer.mockResolvedValue(3);

    await processor()(messageJob("still not an email"));

    expect(store.claimQuestion).toHaveBeenCalled();
    expect(store.saveContactAnswer).not.toHaveBeenCalled();
    expect(meta.sendDirectMessageWithQuickReplies).not.toHaveBeenCalled();
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "process-postback",
      expect.objectContaining({ answered: true }),
      expect.anything()
    );
  });

  it("does nothing more when another message already answered", async () => {
    store.claimQuestion.mockResolvedValue(false);

    await processor()(messageJob("ana@example.com"));

    expect(store.saveContactAnswer).not.toHaveBeenCalled();
    expect(mockQueueAdd).not.toHaveBeenCalled();
    expect(mockPrisma.automation.findMany).not.toHaveBeenCalled();
  });

  it("thanks them and releases the follow-up when the question came after the link", async () => {
    store.findOpenQuestion.mockResolvedValue(openQuestionRow({ afterLink: true }));
    mockPrisma.automation.findFirst.mockResolvedValue({
      ...baseCampaign,
      ...askForEmail,
      askAfterLink: true,
      askThanksMessage: "Got it, {username}!",
      followUpEnabled: true,
      followUpMessage: "Thanks!",
    });

    await processor()(messageJob("ana@example.com"));

    expect(meta.sendDirectMessage).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "person_1",
      "Got it, ana!"
    );
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "process-followup",
      expect.objectContaining({ userId: "person_1" }),
      expect.objectContaining({ jobId: "followup_auto_789_person_1" })
    );
    expect(meta.sendDirectMessageWithLinkButton).not.toHaveBeenCalled();
  });

  it("doesn't read the DM that asked the question as its answer when its job runs again", async () => {
    // "GUIDE" set off this campaign, which asked for an email and logged the
    // DM; the job is running again because another campaign's send failed.
    mockPrisma.dmLog.findUnique.mockImplementation(
      async (args: { where: { automationId_commentId: { commentId: string } } }) =>
        args.where.automationId_commentId.commentId === "dm:mid_answer"
          ? { id: "log_1", status: "SENT" }
          : null
    );

    await processor()(messageJob("GUIDE"));

    expect(store.recordFailedAnswer).not.toHaveBeenCalled();
    expect(store.saveContactAnswer).not.toHaveBeenCalled();
    // Back to keyword matching, where the log keeps it from asking twice.
    expect(mockPrisma.automation.findMany).toHaveBeenCalled();
    expect(meta.sendDirectMessageWithQuickReplies).not.toHaveBeenCalled();
  });

  it("reads the DM normally when the question's campaign is gone", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue(null);

    await processor()(messageJob("GUIDE"));

    expect(store.closeQuestion).toHaveBeenCalledWith("contact_1", "auto_789");
    expect(mockPrisma.automation.findMany).toHaveBeenCalled();
  });
});

describe("keyword DMs", () => {
  it("asks the question instead of sending the link", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      { ...baseCampaign, ...askForEmail, contactTags: ["dm-guide"] },
    ]);

    await processor()(messageJob("GUIDE"));

    expect(store.trackContact).toHaveBeenCalledWith(
      expect.objectContaining({ automationId: "auto_789", tags: ["dm-guide"] })
    );
    expect(meta.sendDirectMessageWithQuickReplies).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "person_1",
      QUESTION,
      EMAIL_QUICK_REPLY
    );
    expect(meta.sendDirectMessageWithLinkButton).not.toHaveBeenCalled();
  });

  it("does not record a sender whose account isn't connected", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(null);
    mockPrisma.automation.findMany.mockResolvedValue([]);

    await processor()(messageJob("hello"));

    expect(store.trackContact).not.toHaveBeenCalled();
    expect(store.findOpenQuestion).not.toHaveBeenCalled();
  });
});
