CREATE TABLE "MusaPublication" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "publicationId" UUID NOT NULL,
  "accountId" TEXT NOT NULL,
  "provider" "InstagramProvider" NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'processing',
  "stage" TEXT NOT NULL DEFAULT 'PREPARE',
  "campaignId" TEXT,
  "campaignUpdatedAt" TIMESTAMP(3),
  "containerId" TEXT,
  "providerPostId" TEXT,
  "providerScheduledAt" TIMESTAMP(3),
  "mediaId" TEXT,
  "permalink" TEXT,
  "errorCode" TEXT,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3),
  "attemptStartedAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MusaPublication_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MusaPublication_status_check" CHECK ("status" IN ('processing', 'published', 'failed', 'uncertain')),
  CONSTRAINT "MusaPublication_published_id_check" CHECK ("status" <> 'published' OR "mediaId" IS NOT NULL)
);
CREATE UNIQUE INDEX "MusaPublication_publicationId_key" ON "MusaPublication"("publicationId");
CREATE UNIQUE INDEX "MusaPublication_connectionId_publicationId_key" ON "MusaPublication"("connectionId", "publicationId");
CREATE UNIQUE INDEX "MusaPublication_campaignId_key" ON "MusaPublication"("campaignId");
CREATE INDEX "MusaPublication_workspaceId_accountId_idx" ON "MusaPublication"("workspaceId", "accountId");
CREATE INDEX "MusaPublication_status_leaseUntil_idx" ON "MusaPublication"("status", "leaseUntil");

-- Campaign activation and target changes must not race an external publication.
-- The writer locks Automation before creating the publication reservation.
-- Final binding first marks the receipt published in the same transaction.
CREATE FUNCTION "guard_musa_publication_campaign"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "MusaPublication" WHERE "campaignId" = OLD."id" AND "status" IN ('processing', 'uncertain')) THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'MUSA_PUBLICATION_RESERVED' USING ERRCODE = '23514';
    END IF;
    IF NEW."isActive" IS DISTINCT FROM OLD."isActive"
      OR NEW."postId" IS DISTINCT FROM OLD."postId"
      OR NEW."pendingNextReel" IS DISTINCT FROM OLD."pendingNextReel"
      OR NEW."nextReelArmedAt" IS DISTINCT FROM OLD."nextReelArmedAt"
      OR NEW."matchAnyPost" IS DISTINCT FROM OLD."matchAnyPost"
      OR NEW."dmTriggerEnabled" IS DISTINCT FROM OLD."dmTriggerEnabled"
      OR NEW."instagramAccountId" IS DISTINCT FROM OLD."instagramAccountId"
      OR NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId" THEN
      RAISE EXCEPTION 'MUSA_PUBLICATION_RESERVED' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Automation_musa_publication_guard" BEFORE UPDATE OR DELETE ON "Automation"
FOR EACH ROW EXECUTE FUNCTION "guard_musa_publication_campaign"();
