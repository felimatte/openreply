ALTER TABLE "Automation"
  ADD COLUMN "musaScheduledPublicationId" UUID,
  ADD COLUMN "musaScheduledRequestId" UUID;

CREATE UNIQUE INDEX "Automation_workspaceId_musaScheduledRequestId_key"
  ON "Automation" ("workspaceId", "musaScheduledRequestId");

CREATE TABLE "MusaSchedulerGrant" (
  "connectionId" TEXT NOT NULL REFERENCES "MusaConnection"("id") ON DELETE CASCADE,
  "accountId" TEXT NOT NULL REFERENCES "InstagramAccount"("id") ON DELETE CASCADE,
  "instagramId" TEXT NOT NULL,
  "encryptedToken" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("connectionId", "accountId")
);
CREATE INDEX "MusaSchedulerGrant_accountId_idx" ON "MusaSchedulerGrant" ("accountId");

CREATE TABLE "MusaScheduledReel" (
  "requestId" UUID PRIMARY KEY,
  "automationId" TEXT NOT NULL REFERENCES "Automation"("id") ON DELETE CASCADE,
  "connectionId" TEXT NOT NULL REFERENCES "MusaConnection"("id") ON DELETE CASCADE,
  "accountId" TEXT NOT NULL,
  "publicationId" UUID NOT NULL,
  "reservationId" UUID UNIQUE,
  "flowVersionId" TEXT NOT NULL,
  "rootCampaignId" TEXT NOT NULL,
  "flowCampaignIds" TEXT[] NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'reserving',
  "errorCode" TEXT,
  "mediaId" TEXT,
  "activatedAt" TIMESTAMP(3),
  "replayDueAt" TIMESTAMP(3),
  "replayCursorId" TEXT,
  "replayCursorAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MusaScheduledReel_status_check" CHECK ("status" IN ('reserving','waiting','active','cancelled','failed')),
  CONSTRAINT "MusaScheduledReel_bundle_check" CHECK (cardinality("flowCampaignIds") BETWEEN 1 AND 25 AND "rootCampaignId" = ANY("flowCampaignIds")),
  CONSTRAINT "MusaScheduledReel_active_check" CHECK ("status" <> 'active' OR ("reservationId" IS NOT NULL AND "mediaId" IS NOT NULL AND "activatedAt" IS NOT NULL)),
  CONSTRAINT "MusaScheduledReel_cursor_check" CHECK (("replayCursorId" IS NULL) = ("replayCursorAt" IS NULL))
);

CREATE INDEX "MusaScheduledReel_automationId_createdAt_idx" ON "MusaScheduledReel" ("automationId", "createdAt");
CREATE INDEX "MusaScheduledReel_connectionId_publicationId_idx" ON "MusaScheduledReel" ("connectionId", "publicationId");
CREATE INDEX "MusaScheduledReel_replayDueAt_idx" ON "MusaScheduledReel" ("replayDueAt");
CREATE UNIQUE INDEX "MusaScheduledReel_live_automation_key" ON "MusaScheduledReel" ("automationId")
  WHERE "status" IN ('reserving','waiting','active');


ALTER TABLE "Automation" ADD CONSTRAINT "Automation_musa_schedule_scope_check"
  CHECK (("musaScheduledPublicationId" IS NULL) = ("musaScheduledRequestId" IS NULL)
    AND ("musaScheduledPublicationId" IS NULL OR
      (NOT "pendingNextReel" AND NOT "matchAnyPost" AND NOT "dmTriggerEnabled"
        AND ("postId" IS NOT NULL OR (NOT "isActive" AND NOT "flowEnabled")))));

CREATE INDEX "WebhookEvent_createdAt_id_idx" ON "WebhookEvent" ("createdAt", "id");

CREATE FUNCTION close_musa_scheduled_reels_on_revoke() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  EXECUTE format('UPDATE %I."MusaScheduledReel"
    SET "status" = ''cancelled'', "errorCode" = ''MUSA_NOT_CONNECTED'', "updatedAt" = CURRENT_TIMESTAMP
    WHERE "connectionId" = $1 AND "status" IN (''reserving'',''waiting'')', TG_TABLE_SCHEMA) USING NEW."id";
  EXECUTE format('DELETE FROM %I."MusaSchedulerGrant" WHERE "connectionId" = $1', TG_TABLE_SCHEMA) USING NEW."id";
  RETURN NEW;
END;
$$;

CREATE TRIGGER "MusaConnection_close_scheduled_reels_on_revoke"
AFTER UPDATE OF "revokedAt" ON "MusaConnection"
FOR EACH ROW WHEN (OLD."revokedAt" IS NULL AND NEW."revokedAt" IS NOT NULL)
EXECUTE FUNCTION close_musa_scheduled_reels_on_revoke();
