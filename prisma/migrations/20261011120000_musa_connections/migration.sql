CREATE TABLE "MusaConnection" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "businessName" TEXT NOT NULL,
  "grantedByUserId" TEXT NOT NULL,
  "allowedAccountIds" TEXT[] NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "MusaConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MusaConnection_tokenHash_key" ON "MusaConnection"("tokenHash");
CREATE INDEX "MusaConnection_workspaceId_revokedAt_idx" ON "MusaConnection"("workspaceId", "revokedAt");
CREATE INDEX "MusaConnection_grantedByUserId_idx" ON "MusaConnection"("grantedByUserId");
CREATE INDEX "MusaConnection_businessId_idx" ON "MusaConnection"("businessId");
ALTER TABLE "MusaConnection" ADD CONSTRAINT "MusaConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MusaConnection" ADD CONSTRAINT "MusaConnection_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MusaPairingCode" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "grantedByUserId" TEXT NOT NULL,
  "allowedAccountIds" TEXT[] NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MusaPairingCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MusaPairingCode_codeHash_key" ON "MusaPairingCode"("codeHash");
CREATE INDEX "MusaPairingCode_workspaceId_expiresAt_idx" ON "MusaPairingCode"("workspaceId", "expiresAt");
CREATE INDEX "MusaPairingCode_grantedByUserId_idx" ON "MusaPairingCode"("grantedByUserId");
ALTER TABLE "MusaPairingCode" ADD CONSTRAINT "MusaPairingCode_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MusaPairingCode" ADD CONSTRAINT "MusaPairingCode_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
