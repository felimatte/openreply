import { prisma } from "@/lib/db/client";
import {
  createInstagramContext,
  hasInstagramCredentials,
  getAllUserMedia,
  type InstagramMedia,
} from "@/lib/instagram/provider";

function isReel(media: InstagramMedia): boolean {
  return media.media_product_type === "REELS";
}

export type AttachNextReelResult = {
  checked: number;
  bound: number;
  failedAccounts: number;
};

/**
 * Bind each pending "next reel" campaign to the earliest reel published after
 * its next-Reel wait was armed. Kept outside the HTTP route so the worker can
 * run the same check on every comment-poll interval.
 */
export async function attachPendingNextReels(options?: { accountConnectionId?: string }): Promise<AttachNextReelResult> {
  const pending = await prisma.automation.findMany({
    where: { pendingNextReel: true, isActive: true, ...(options?.accountConnectionId ? { instagramAccountId: options.accountConnectionId } : {}) },
    include: { instagramAccount: true },
  });

  // Group by connected account so we fetch each account's media only once.
  const byAccount = new Map<
    string,
    {
      account: (typeof pending)[number]["instagramAccount"];
      automations: typeof pending;
    }
  >();
  for (const automation of pending) {
    const key = automation.instagramAccountId;
    const entry = byAccount.get(key);
    if (entry) entry.automations.push(automation);
    else
      byAccount.set(key, {
        account: automation.instagramAccount,
        automations: [automation],
      });
  }

  let checked = 0;
  let bound = 0;
  const failures: string[] = [];

  for (const { account, automations } of byAccount.values()) {
    checked += automations.length;
    if (!account || !hasInstagramCredentials(account)) continue;

    let reels: InstagramMedia[];
    try {
      const context = await createInstagramContext(account);
      const media = await getAllUserMedia({ context, max: 200 });
      reels = media
        .filter(isReel)
        .sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
    } catch (error) {
      failures.push(account.id);
      console.error("[attach-next-reel] media fetch failed", account.id, error);
      continue;
    }

    for (const automation of automations) {
      // Existing waiting campaigns use their original creation date until rearmed.
      const armedAt = automation.nextReelArmedAt ?? automation.createdAt;
      const nextReel = reels.find(
        (reel) => new Date(reel.timestamp) > armedAt
      );
      if (!nextReel) continue;

      const result = await prisma.automation.updateMany({
        where: { id: automation.id, pendingNextReel: true, isActive: true, nextReelArmedAt: automation.nextReelArmedAt },
        data: {
          postId: nextReel.id,
          postUrl: nextReel.permalink ?? null,
          pendingNextReel: false,
        },
      });
      bound += result.count;
    }
  }

  return { checked, bound, failedAccounts: failures.length };
}
