-- CreateEnum
CREATE TYPE "ScheduleKind" AS ENUM ('ANNUITY', 'COUPON');

-- CreateEnum
CREATE TYPE "ScheduleStep" AS ENUM ('MONTH', 'WEEK', 'DAY', 'HOUR');

-- CreateEnum
CREATE TYPE "CampaignState" AS ENUM ('DRAFT', 'PUBLISHING', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "PublishStage" AS ENUM ('CREATE', 'PERIODS', 'FINALIZE');

-- CreateTable
CREATE TABLE "Campaign" (
    "id" UUID NOT NULL,
    "borrowerId" UUID NOT NULL,
    "walletId" UUID,
    "payoutWallet" TEXT,
    "title" TEXT NOT NULL,
    "purpose" TEXT,
    "collateral" TEXT,
    "scheduleKind" "ScheduleKind" NOT NULL DEFAULT 'ANNUITY',
    "scheduleStep" "ScheduleStep" NOT NULL DEFAULT 'MONTH',
    "softCap" BIGINT,
    "hardCap" BIGINT,
    "minTicket" BIGINT,
    "maxTicket" BIGINT NOT NULL DEFAULT 0,
    "fundingStart" TIMESTAMP(3),
    "fundingDeadline" TIMESTAMP(3),
    "firstDueAt" TIMESTAMP(3),
    "annualRateBps" INTEGER,
    "periodsPerYear" INTEGER NOT NULL DEFAULT 12,
    "periodCount" INTEGER,
    "penaltyRateBps" INTEGER NOT NULL DEFAULT 2000,
    "defaultThresholdDays" INTEGER NOT NULL DEFAULT 90,
    "prepaymentFeeBps" INTEGER NOT NULL DEFAULT 0,
    "platformFeeBps" INTEGER NOT NULL DEFAULT 0,
    "cancelGraceDays" INTEGER NOT NULL DEFAULT 7,
    "step" INTEGER NOT NULL DEFAULT 1,
    "state" "CampaignState" NOT NULL DEFAULT 'DRAFT',
    "error" TEXT,
    "onchainId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignTx" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "stage" "PublishStage" NOT NULL,
    "signature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignTx_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Campaign_state_idx" ON "Campaign"("state");

-- CreateIndex
CREATE INDEX "Campaign_borrowerId_idx" ON "Campaign"("borrowerId");

-- CreateIndex
CREATE INDEX "CampaignTx_campaignId_idx" ON "CampaignTx"("campaignId");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignTx" ADD CONSTRAINT "CampaignTx_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
