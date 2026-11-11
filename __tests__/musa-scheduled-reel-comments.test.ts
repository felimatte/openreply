import { expect, it } from "vitest";
import { PRIVATE_REPLY_WINDOW_MS } from "@/lib/flows/runtime-values";
import { scheduledCommentEvents } from "@/lib/integrations/musa/scheduled-reel-comments";

it("replays only the exact account and media, preserving source identity and timestamp", () => {
  const now = Date.UTC(2026, 10, 10, 15);
  const change = (id: string, media: { id: string; original_media_id?: string }, timestamp = now - 5000) => ({
    field: "comments", value: { id, media, timestamp, from: { id: "reader" }, text: "guia" },
  });
  const events = scheduledCommentEvents({ object: "instagram", entry: [
    { id: "account", time: now, changes: [
      change("organic", { id: "exact-reel" }),
      change("advert", { id: "ad", original_media_id: "exact-reel" }),
      change("unrelated", { id: "other-reel" }),
      change("expired", { id: "exact-reel" }, now - PRIVATE_REPLY_WINDOW_MS),
    ] },
    { id: "other-account", time: now, changes: [change("other-account", { id: "exact-reel" })] },
  ] }, "account", "exact-reel", now);
  expect(events.map(event => [event.commentId, event.timestamp])).toEqual([
    ["organic", now - 5000], ["advert", now - 5000],
  ]);
});
