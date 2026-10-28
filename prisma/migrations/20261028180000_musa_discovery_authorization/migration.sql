CREATE TABLE "MusaDiscoveryFlow" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "connectionId" TEXT NOT NULL REFERENCES "MusaConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "accountId" TEXT NOT NULL REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "ticketHash" TEXT NOT NULL,
  "stateHash" TEXT,
  "browserHash" TEXT,
  "actorUserId" TEXT,
  "accountTokenHash" TEXT NOT NULL,
  "instagramId" TEXT NOT NULL,
  "returnPath" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "MusaDiscoveryFlow_ticketHash_key" ON "MusaDiscoveryFlow"("ticketHash");
CREATE UNIQUE INDEX "MusaDiscoveryFlow_stateHash_key" ON "MusaDiscoveryFlow"("stateHash");
CREATE UNIQUE INDEX "MusaDiscoveryFlow_connectionId_accountId_key" ON "MusaDiscoveryFlow"("connectionId", "accountId");

CREATE TABLE "MusaDiscoveryGrant" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "connectionId" TEXT NOT NULL REFERENCES "MusaConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "accountId" TEXT NOT NULL REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "grantedByUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "accountTokenHash" TEXT NOT NULL,
  "instagramId" TEXT NOT NULL,
  "instagramUserId" TEXT NOT NULL,
  "facebookUserId" TEXT NOT NULL,
  "facebookInstagramId" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "encryptedToken" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "scopes" TEXT[] NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CHECK (("revokedAt" IS NULL) = ("encryptedToken" IS NOT NULL))
);
CREATE UNIQUE INDEX "MusaDiscoveryGrant_connectionId_accountId_key" ON "MusaDiscoveryGrant"("connectionId", "accountId");

-- Every existing MUSA disconnect path revokes the parent. Clear its independent
-- credentials and cancel in-flight callbacks in the same transaction.
CREATE FUNCTION "revokeMusaDiscovery"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "MusaDiscoveryFlow" SET "stateHash" = NULL, "browserHash" = NULL, "consumedAt" = CURRENT_TIMESTAMP
    WHERE "connectionId" = NEW."id";
  UPDATE "MusaDiscoveryGrant" SET "encryptedToken" = NULL, "revokedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "connectionId" = NEW."id";
  RETURN NEW;
END;
$$;
CREATE TRIGGER "MusaConnection_revoke_discovery" AFTER UPDATE OF "revokedAt" ON "MusaConnection"
FOR EACH ROW WHEN (NEW."revokedAt" IS NOT NULL) EXECUTE FUNCTION "revokeMusaDiscovery"();
