ALTER TABLE "MusaPublication" ADD COLUMN "confirmationContainerId" TEXT;
ALTER TABLE "MusaPublication" DROP CONSTRAINT "MusaPublication_published_id_check";
ALTER TABLE "MusaPublication" ADD CONSTRAINT "MusaPublication_published_id_check" CHECK (
  "status" <> 'published' OR "mediaId" IS NOT NULL OR (
    "provider" = 'META' AND "mediaId" IS NULL AND "permalink" IS NULL
    AND "containerId" IS NOT NULL AND "confirmationContainerId" IS NOT NULL
    AND "containerId" = "confirmationContainerId"
    AND "confirmationContainerId" ~ '^[a-zA-Z0-9_-]{1,128}$'
  )
);
ALTER TABLE "MusaPublication" ADD CONSTRAINT "MusaPublication_confirmation_check" CHECK (
  "confirmationContainerId" IS NULL OR (
    "status" = 'published' AND "provider" = 'META' AND "mediaId" IS NULL AND "permalink" IS NULL
    AND "containerId" IS NOT NULL AND "containerId" = "confirmationContainerId"
    AND "confirmationContainerId" ~ '^[a-zA-Z0-9_-]{1,128}$'
  )
);

-- A confirmed container without a media ID cannot safely bind or release its campaign.
CREATE OR REPLACE FUNCTION "guard_musa_publication_campaign"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "MusaPublication" WHERE "campaignId" = OLD."id"
      AND ("status" IN ('processing', 'uncertain') OR ("status" = 'published' AND "mediaId" IS NULL))
  ) THEN
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
