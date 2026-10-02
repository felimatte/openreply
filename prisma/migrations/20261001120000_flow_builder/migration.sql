-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "excludedKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "flowDraft" JSONB,
ADD COLUMN     "flowDraftRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "flowEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "flowPublishedVersionId" TEXT,
ADD COLUMN     "nextReelArmedAt" TIMESTAMP(3),
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "assignedUserId" TEXT,
ADD COLUMN     "automationPaused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "automationPausedUntil" TIMESTAMP(3),
ADD COLUMN     "notes" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "FlowVersion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlowVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "commentId" TEXT,
    "currentNodeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "waitType" TEXT,
    "waitExpiresAt" TIMESTAMP(3),
    "resumeAt" TIMESTAMP(3),
    "context" JSONB NOT NULL DEFAULT '{}',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowStepRun" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "visit" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "output" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "FlowStepRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowEventReceipt" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlowEventReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "buttonId" TEXT NOT NULL,
    "destinationUrl" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "clickedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlowLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowLinkClick" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlowLinkClick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowAsset" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "chunkCount" INTEGER NOT NULL,
    "publicToken" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UPLOADING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlowAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowAssetChunk" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "FlowAssetChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingReelComment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "replayedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingReelComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FlowVersion_workspaceId_idx" ON "FlowVersion"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "FlowVersion_automationId_version_key" ON "FlowVersion"("automationId", "version");

-- CreateIndex
CREATE INDEX "FlowRun_workspaceId_createdAt_idx" ON "FlowRun"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "FlowRun_contactId_status_idx" ON "FlowRun"("contactId", "status");

-- CreateIndex
CREATE INDEX "FlowRun_status_resumeAt_idx" ON "FlowRun"("status", "resumeAt");

-- CreateIndex
CREATE INDEX "FlowRun_status_waitExpiresAt_idx" ON "FlowRun"("status", "waitExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "FlowRun_automationId_commentId_key" ON "FlowRun"("automationId", "commentId");

-- CreateIndex
CREATE INDEX "FlowStepRun_runId_startedAt_idx" ON "FlowStepRun"("runId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FlowStepRun_runId_nodeId_visit_key" ON "FlowStepRun"("runId", "nodeId", "visit");

-- CreateIndex
CREATE UNIQUE INDEX "FlowLink_token_key" ON "FlowLink"("token");

-- CreateIndex
CREATE INDEX "FlowLink_runId_clickedAt_idx" ON "FlowLink"("runId", "clickedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FlowLink_runId_nodeId_buttonId_key" ON "FlowLink"("runId", "nodeId", "buttonId");

-- CreateIndex
CREATE INDEX "FlowLinkClick_workspaceId_createdAt_idx" ON "FlowLinkClick"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "FlowLinkClick_automationId_createdAt_idx" ON "FlowLinkClick"("automationId", "createdAt");

-- CreateIndex
CREATE INDEX "FlowLinkClick_instagramAccountId_createdAt_idx" ON "FlowLinkClick"("instagramAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "FlowLinkClick_linkId_idx" ON "FlowLinkClick"("linkId");

-- CreateIndex
CREATE UNIQUE INDEX "FlowAsset_publicToken_key" ON "FlowAsset"("publicToken");

-- CreateIndex
CREATE INDEX "FlowAsset_workspaceId_createdAt_idx" ON "FlowAsset"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FlowAssetChunk_assetId_index_key" ON "FlowAssetChunk"("assetId", "index");

-- CreateIndex
CREATE INDEX "PendingReelComment_accountId_mediaId_idx" ON "PendingReelComment"("accountId", "mediaId");

-- CreateIndex
CREATE INDEX "PendingReelComment_expiresAt_idx" ON "PendingReelComment"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PendingReelComment_accountId_commentId_key" ON "PendingReelComment"("accountId", "commentId");

-- AddForeignKey
ALTER TABLE "FlowVersion" ADD CONSTRAINT "FlowVersion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowVersion" ADD CONSTRAINT "FlowVersion_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowRun" ADD CONSTRAINT "FlowRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowRun" ADD CONSTRAINT "FlowRun_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowRun" ADD CONSTRAINT "FlowRun_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "FlowVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowRun" ADD CONSTRAINT "FlowRun_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowRun" ADD CONSTRAINT "FlowRun_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowStepRun" ADD CONSTRAINT "FlowStepRun_runId_fkey" FOREIGN KEY ("runId") REFERENCES "FlowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowLink" ADD CONSTRAINT "FlowLink_runId_fkey" FOREIGN KEY ("runId") REFERENCES "FlowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowLinkClick" ADD CONSTRAINT "FlowLinkClick_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "FlowLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowAsset" ADD CONSTRAINT "FlowAsset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowAssetChunk" ADD CONSTRAINT "FlowAssetChunk_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "FlowAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve the arming time for campaigns that were already waiting for a Reel.
UPDATE "Automation" SET "nextReelArmedAt" = "createdAt" WHERE "pendingNextReel" = true;
