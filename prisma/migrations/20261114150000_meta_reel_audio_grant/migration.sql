CREATE UNIQUE INDEX "InstagramAccount_id_workspaceId_key" ON "InstagramAccount"("id", "workspaceId");

CREATE TABLE "MetaReelAudioGrant" (
    "accountId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "grantedByUserId" TEXT NOT NULL,
    "facebookAppId" TEXT NOT NULL,
    "instagramId" TEXT NOT NULL,
    "instagramUserId" TEXT NOT NULL,
    "facebookUserId" TEXT NOT NULL,
    "facebookInstagramId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "encryptedTokens" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT[] NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaReelAudioGrant_pkey" PRIMARY KEY ("accountId"),
    CONSTRAINT "MetaReelAudioGrant_accountId_workspaceId_fkey" FOREIGN KEY ("accountId", "workspaceId") REFERENCES "InstagramAccount"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MetaReelAudioGrant_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "MetaReelAudioFlow" (
    "accountId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "facebookAppId" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "browserHash" TEXT NOT NULL,
    "accountTokenHash" TEXT NOT NULL,
    "instagramId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "MetaReelAudioFlow_pkey" PRIMARY KEY ("accountId"),
    CONSTRAINT "MetaReelAudioFlow_accountId_workspaceId_fkey" FOREIGN KEY ("accountId", "workspaceId") REFERENCES "InstagramAccount"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MetaReelAudioFlow_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MetaReelAudioFlow_stateHash_key" ON "MetaReelAudioFlow"("stateHash");
