-- Private copies of a complete flow chain share one publication reservation.
ALTER TABLE "MusaPublication" ADD COLUMN "flowCampaignIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE FUNCTION "musa_flow_bundle_ids_valid"(ids TEXT[], root TEXT) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE item TEXT; seen TEXT[]:=ARRAY[]::TEXT[];
BEGIN
  IF cardinality(ids)=0 THEN RETURN true; END IF;
  IF ids IS NULL OR root IS NULL OR cardinality(ids)>25 OR array_ndims(ids) IS DISTINCT FROM 1
    OR NOT (ids @> ARRAY[root]) THEN RETURN false; END IF;
  FOREACH item IN ARRAY ids LOOP
    IF item IS NULL OR item !~ '^musa_flow_[a-f0-9-]{36}$' OR item=ANY(seen) THEN RETURN false; END IF;
    seen:=array_append(seen,item);
  END LOOP;
  RETURN true;
END; $$;
ALTER TABLE "MusaPublication" ADD CONSTRAINT "MusaPublication_flow_bundle_check"
  CHECK ("musa_flow_bundle_ids_valid"("flowCampaignIds","campaignId"));
CREATE INDEX "MusaPublication_flowCampaignIds_idx" ON "MusaPublication" USING GIN ("flowCampaignIds");

CREATE FUNCTION "guard_musa_flow_bundle_snapshot"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."flowCampaignIds" IS DISTINCT FROM OLD."flowCampaignIds" OR cardinality(OLD."flowCampaignIds")>0 AND
    ROW(NEW."campaignId",NEW."campaignUpdatedAt",NEW."payload",NEW."payloadHash",NEW."publicationId",NEW."connectionId",NEW."workspaceId",NEW."accountId",NEW."provider")
      IS DISTINCT FROM ROW(OLD."campaignId",OLD."campaignUpdatedAt",OLD."payload",OLD."payloadHash",OLD."publicationId",OLD."connectionId",OLD."workspaceId",OLD."accountId",OLD."provider") THEN
    RAISE EXCEPTION 'MUSA_FLOW_BUNDLE_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "MusaPublication_flow_bundle_snapshot" BEFORE UPDATE ON "MusaPublication"
FOR EACH ROW EXECUTE FUNCTION "guard_musa_flow_bundle_snapshot"();

CREATE FUNCTION "musa_flow_copy_reserved"(campaign TEXT) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM "MusaPublication" WHERE "flowCampaignIds" @> ARRAY[campaign]
    AND ("status" IN ('processing','uncertain') OR ("status"='published' AND "mediaId" IS NULL)));
$$;
CREATE OR REPLACE FUNCTION "guard_musa_publication_campaign"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Full settings of every private copy stay frozen, including dependency entry/version fields.
  IF "musa_flow_copy_reserved"(OLD."id") THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'MUSA_PUBLICATION_RESERVED' USING ERRCODE='23514'; END IF;
    IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'MUSA_PUBLICATION_RESERVED' USING ERRCODE='23514'; END IF;
  END IF;
  -- Preserve the earlier, narrower behavior for legacy campaignId clients.
  IF EXISTS (SELECT 1 FROM "MusaPublication" WHERE "campaignId"=OLD."id"
    AND ("status" IN ('processing','uncertain') OR ("status"='published' AND "mediaId" IS NULL))) THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'MUSA_PUBLICATION_RESERVED' USING ERRCODE='23514'; END IF;
    IF NEW."isActive" IS DISTINCT FROM OLD."isActive" OR NEW."postId" IS DISTINCT FROM OLD."postId"
      OR NEW."pendingNextReel" IS DISTINCT FROM OLD."pendingNextReel" OR NEW."nextReelArmedAt" IS DISTINCT FROM OLD."nextReelArmedAt"
      OR NEW."matchAnyPost" IS DISTINCT FROM OLD."matchAnyPost" OR NEW."dmTriggerEnabled" IS DISTINCT FROM OLD."dmTriggerEnabled"
      OR NEW."instagramAccountId" IS DISTINCT FROM OLD."instagramAccountId" OR NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId" THEN
      RAISE EXCEPTION 'MUSA_PUBLICATION_RESERVED' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;

CREATE FUNCTION "guard_musa_flow_version"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF "musa_flow_copy_reserved"(OLD."automationId") THEN
    RAISE EXCEPTION 'MUSA_PUBLICATION_RESERVED' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "FlowVersion_musa_bundle_guard" BEFORE UPDATE OR DELETE ON "FlowVersion"
FOR EACH ROW EXECUTE FUNCTION "guard_musa_flow_version"();
