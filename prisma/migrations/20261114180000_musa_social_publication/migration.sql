CREATE TABLE "MusaSocialPublication" (
    "publicationId" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "connectionId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "targetIdentity" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "providerPostId" TEXT,
    "providerScheduledAt" TIMESTAMP(3),
    "attemptStartedAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "leaseToken" UUID,
    "leaseUntil" TIMESTAMP(3),
    "mediaId" TEXT,
    "permalink" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MusaSocialPublication_pkey" PRIMARY KEY ("publicationId"),
    CONSTRAINT "MusaSocialPublication_platform_check" CHECK ("platform" IN ('facebook', 'tiktok')),
    CONSTRAINT "MusaSocialPublication_status_check" CHECK (
        "status" IN ('processing', 'failed', 'uncertain') OR
        ("status" = 'published' AND "providerPostId" IS NOT NULL AND "mediaId" IS NOT NULL)
    ),
    CONSTRAINT "MusaSocialPublication_lease_check" CHECK (("leaseToken" IS NULL) = ("leaseUntil" IS NULL)),
    CONSTRAINT "MusaSocialPublication_attempt_check" CHECK (
        ("attemptStartedAt" IS NULL) = ("providerScheduledAt" IS NULL) AND
        ("providerPostId" IS NULL OR "attemptStartedAt" IS NOT NULL)
    )
);
