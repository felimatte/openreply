-- Contacts: the people who interact with a connected Instagram account, the
-- data they share when a campaign asks for it, and the tags campaigns add.
-- Every new campaign setting defaults to off, so existing campaigns keep
-- behaving exactly as before.

-- CreateEnum
CREATE TYPE "ContactDataType" AS ENUM ('EMAIL', 'PHONE', 'TEXT');

-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "askAfterLink" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "askEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "askFieldKey" TEXT,
ADD COLUMN     "askMessage" TEXT,
ADD COLUMN     "askRetryMessage" TEXT,
ADD COLUMN     "askThanksMessage" TEXT,
ADD COLUMN     "askType" "ContactDataType",
ADD COLUMN     "contactTags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "igAccountId" TEXT NOT NULL,
    "igsid" TEXT NOT NULL,
    "username" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "sourceAutomationId" TEXT,
    "lastInteractionAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInboundAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactTag" (
    "contactId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactTag_pkey" PRIMARY KEY ("contactId","tagId")
);

-- CreateTable
CREATE TABLE "ContactField" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactQuestion" (
    "contactId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "type" "ContactDataType" NOT NULL,
    "fieldKey" TEXT,
    "afterLink" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactQuestion_pkey" PRIMARY KEY ("contactId")
);

-- CreateTable
CREATE TABLE "ContactSync" (
    "workspaceId" TEXT NOT NULL,
    "url" TEXT,
    "secret" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactSync_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateIndex
CREATE INDEX "Contact_workspaceId_lastInteractionAt_idx" ON "Contact"("workspaceId", "lastInteractionAt");

-- CreateIndex
CREATE INDEX "Contact_sourceAutomationId_idx" ON "Contact"("sourceAutomationId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_workspaceId_igAccountId_igsid_key" ON "Contact"("workspaceId", "igAccountId", "igsid");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_workspaceId_name_key" ON "Tag"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "ContactTag_tagId_idx" ON "ContactTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactField_workspaceId_key_key" ON "ContactField"("workspaceId", "key");

-- CreateIndex
CREATE INDEX "ContactQuestion_automationId_idx" ON "ContactQuestion"("automationId");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_sourceAutomationId_fkey" FOREIGN KEY ("sourceAutomationId") REFERENCES "Automation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactTag" ADD CONSTRAINT "ContactTag_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactTag" ADD CONSTRAINT "ContactTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactField" ADD CONSTRAINT "ContactField_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactQuestion" ADD CONSTRAINT "ContactQuestion_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactQuestion" ADD CONSTRAINT "ContactQuestion_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactSync" ADD CONSTRAINT "ContactSync_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
