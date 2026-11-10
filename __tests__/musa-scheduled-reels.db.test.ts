import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import type { InstagramAccount, MusaConnection, Prisma } from "@/app/generated/prisma/client";
import { hashMusaCredential, type MusaConnectionContext } from "@/lib/integrations/musa/auth";
import { registerSchedulerGrant } from "@/lib/integrations/musa/scheduler";
import { publishScheduledCampaign, readScheduledCampaign } from "@/lib/integrations/musa/scheduled-reels";
import { activateScheduledReel } from "@/lib/integrations/musa/scheduled-reel-activation";
import { replayMusaScheduledComments } from "@/lib/integrations/musa/scheduled-reel-comments";
import { flowSource } from "./fixtures/musa-flow-source";

const queue = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock("@/lib/queue/client", () => ({ getDMQueue: () => queue }));
const databaseUrl = process.env.MUSA_TEST_DATABASE_URL;
const secret = `musa_reel_${"A".repeat(43)}`;

describe.skipIf(!databaseUrl)("OpenReply exact scheduled Reel against local Postgres", () => {
  let userId: string;
  let workspaceId: string;
  let account: InstagramAccount;
  let connection: MusaConnection;
  let context: MusaConnectionContext;
  let remoteStatus: "waiting" | "cancelled";
  const replies = new Map<string, string>();
  const remote = vi.fn(async (url: URL, options?: RequestInit) => {
    expect(url.origin).toBe("http://127.0.0.1:31007");
    expect(options?.headers).toMatchObject({ Authorization: `Bearer ${secret}` });
    if (options?.method === "POST") {
      const body = JSON.parse(options.body as string) as { requestId: string; publicationId: string; accountId: string; instagramId: string };
      expect(body.accountId).toBe(account.id);
      expect(body.instagramId).toBe(account.instagramId);
      const reservationId = replies.get(body.requestId) ?? randomUUID();
      replies.set(body.requestId, reservationId);
      return Response.json({ version: 1, reservationId, status: "waiting" });
    }
    expect(url.searchParams.get("accountId")).toBe(account.id);
    expect(url.searchParams.get("instagramId")).toBe(account.instagramId);
    const id = url.pathname.split("/").at(-1);
    if (id === "scheduled-reels") return Response.json({ version: 1, reels: [] });
    const attempt = await prisma.musaScheduledReel.findUniqueOrThrow({ where: { reservationId: id } });
    return Response.json({ version: 1, reservationId: id, status: remoteStatus,
      publicationId: attempt.publicationId, title: "Reel de prueba", scheduledAt: "2026-11-11T16:00:00Z", timezone: "America/Argentina/Buenos_Aires" });
  });

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.hostname !== "127.0.0.1" || url.port !== "57322" || url.pathname !== "/openreply_musa_qa")
      throw new Error("Refusing a database outside the dedicated local MUSA QA instance");
    process.env.DATABASE_URL = databaseUrl;
    vi.stubEnv("MUSA_SCHEDULER_BASE_URL", "http://127.0.0.1:31007");
    vi.stubEnv("ENCRYPTION_KEY", "1234567890abcdef".repeat(4));
    const user = await prisma.user.create({ data: { email: `qa-schedule-${randomUUID()}@example.invalid` } });
    userId = user.id;
    const workspace = await prisma.workspace.create({ data: { name: "QA scheduled Reels", ownerId: userId,
      members: { create: { userId, role: "OWNER" } } } });
    workspaceId = workspace.id;
    account = await prisma.instagramAccount.create({ data: { workspaceId, instagramId: `qa-${randomUUID()}`,
      username: "qa_never_connected", provider: "META", accessToken: "not-a-real-token" } });
    connection = await prisma.musaConnection.create({ data: { workspaceId, businessId: randomUUID(), businessName: "Fixture",
      allowedAccountIds: [account.id], grantedByUserId: userId, tokenHash: hashMusaCredential(randomUUID()) } });
    context = { connectionId: connection.id, workspaceId, allowedInstagramAccountIds: [account.id], connection, workspace, accounts: [account] };
    vi.stubGlobal("fetch", remote);
    await registerSchedulerGrant(context, { version: 1, token: secret, accountId: account.id, instagramId: account.instagramId });
  });

  beforeEach(() => { queue.add.mockClear(); remoteStatus = "waiting"; });

  afterAll(async () => {
    if (workspaceId) await prisma.webhookEvent.deleteMany({ where: { workspaceId } });
    if (userId) await prisma.user.delete({ where: { id: userId } });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  const makeDraft = (publicationId: string, dependencies: string[] = []) => prisma.automation.create({ data: {
    workspaceId, instagramAccountId: account.id, name: "QA exact Reel", keywords: ["qa"], dmMessage: "Never sent",
    isActive: false, musaScheduledPublicationId: publicationId, musaScheduledRequestId: randomUUID(),
    flowDraft: flowSource("scheduled", dependencies).definition as Prisma.InputJsonValue,
  } });
  const activation = (attempt: Awaited<ReturnType<typeof publishScheduledCampaign>>, campaignId: string, flowVersionId: string) => ({
    version: 1 as const, accountId: account.id, instagramId: account.instagramId, automationId: campaignId,
    publicationId: attempt.publicationId, flowVersionId, mediaId: "confirmed_exact",
  });

  it("rejects a wrong account before reverse verification and stores a ciphertext", async () => {
    await expect(registerSchedulerGrant(context, { version: 1, token: secret, accountId: account.id, instagramId: "other" }))
      .rejects.toMatchObject({ code: "ACCOUNT_NOT_ALLOWED" });
    const grant = await prisma.musaSchedulerGrant.findFirstOrThrow({ where: { connectionId: connection.id } });
    expect(grant.encryptedToken).not.toContain(secret);
  });

  it("freezes the selected flow, rejects another Reel and binds once across concurrent callbacks", async () => {
    const dependency = await prisma.automation.create({ data: { workspaceId, instagramAccountId: account.id,
      name: "Dependency", dmMessage: "QA", keywords: ["qa"], isActive: false } });
    const depVersion = await prisma.flowVersion.create({ data: { workspaceId, automationId: dependency.id, version: 1,
      definition: flowSource("dependency").definition as Prisma.InputJsonValue } });
    await prisma.automation.update({ where: { id: dependency.id }, data: { flowPublishedVersionId: depVersion.id } });
    const campaign = await makeDraft(randomUUID(), [dependency.id]);
    const requestId = randomUUID();
    expect(await readScheduledCampaign(campaign)).toMatchObject({ status: "draft" });
    const attempts = await Promise.all([publishScheduledCampaign(campaign, { publicationId: campaign.musaScheduledPublicationId!, requestId }),
      publishScheduledCampaign(campaign, { publicationId: campaign.musaScheduledPublicationId!, requestId })]);
    expect(attempts[0]).toMatchObject({ status: "waiting", reservationId: attempts[1].reservationId });
    const saved = await prisma.musaScheduledReel.findUniqueOrThrow({ where: { requestId } });
    expect(saved.flowCampaignIds).toHaveLength(2);
    expect(saved.flowCampaignIds).not.toContain(dependency.id);
    await prisma.flowVersion.update({ where: { id: depVersion.id }, data: {
      definition: flowSource("edited-after-reservation").definition as Prisma.InputJsonValue,
    } });
    const payload = activation(attempts[0], campaign.id, saved.flowVersionId);
    await expect(activateScheduledReel(context, saved.reservationId!, { ...payload, publicationId: randomUUID() }))
      .rejects.toMatchObject({ code: "RESERVATION_CONFLICT" });
    const incoming = { object: "instagram", entry: [{ id: account.instagramId, time: Date.now(),
      changes: [
        { field: "comments", value: { id: "eligible-early", media: { id: payload.mediaId }, from: { id: "contact" }, text: "qa" } },
        { field: "comments", value: { id: "other-reel", media: { id: "wrong-reel" }, from: { id: "contact" }, text: "qa" } },
      ] }] };
    await prisma.webhookEvent.create({ data: { workspaceId, object: "instagram", payload: incoming } });
    await Promise.all([activateScheduledReel(context, saved.reservationId!, payload), activateScheduledReel(context, saved.reservationId!, payload)]);
    expect(await prisma.automation.findUnique({ where: { id: campaign.id } })).toMatchObject({
      isActive: true, postId: payload.mediaId, flowEnabled: true, flowPublishedVersionId: saved.flowVersionId,
    });
    await expect(activateScheduledReel(context, saved.reservationId!, { ...payload, mediaId: "wrong-id" }))
      .rejects.toMatchObject({ code: "RESERVATION_CONFLICT" });
    await replayMusaScheduledComments();
    await replayMusaScheduledComments();
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith("process-comment", expect.objectContaining({
      commentId: "eligible-early", mediaId: payload.mediaId, accountConnectionId: account.id,
    }), expect.anything());
  });

  it("retains the draft for reselection after cancellation and closes the pending reservation on revocation", async () => {
    const campaign = await makeDraft(randomUUID());
    await publishScheduledCampaign(campaign, { publicationId: campaign.musaScheduledPublicationId! });
    remoteStatus = "cancelled";
    expect(await readScheduledCampaign(campaign)).toMatchObject({ status: "cancelled" });
    const next = await publishScheduledCampaign(campaign, { publicationId: randomUUID() });
    const pending = await prisma.musaScheduledReel.findUniqueOrThrow({ where: { reservationId: next.reservationId } });
    expect(pending.status).toBe("waiting");
    await prisma.musaConnection.update({ where: { id: connection.id }, data: { revokedAt: new Date() } });
    expect(await prisma.musaSchedulerGrant.findFirst({ where: { connectionId: connection.id } })).toBeNull();
    expect(await readScheduledCampaign(campaign)).toMatchObject({ status: "cancelled", code: "MUSA_NOT_CONNECTED" });
    await expect(activateScheduledReel(context, pending.reservationId!, activation(next, campaign.id, pending.flowVersionId)))
      .rejects.toMatchObject({ code: "GRANT_REVOKED" });
  });
});
