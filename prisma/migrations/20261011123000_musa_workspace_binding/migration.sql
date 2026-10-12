ALTER TABLE "Workspace" ADD COLUMN "musaBusinessId" TEXT;

-- This migration precedes the first release. Refuse ambiguous legacy data rather
-- than silently assign a shared workspace to an arbitrary client.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "MusaConnection" GROUP BY "workspaceId"
    HAVING COUNT(DISTINCT "businessId") > 1
  ) THEN
    RAISE EXCEPTION 'Separate MUSA businesses into dedicated OpenReply workspaces before migrating';
  END IF;
END $$;

UPDATE "Workspace" w SET "musaBusinessId" = c."businessId"
FROM (SELECT "workspaceId", MIN("businessId") AS "businessId"
      FROM "MusaConnection" GROUP BY "workspaceId") c
WHERE w.id = c."workspaceId";
