-- CreateTable
CREATE TABLE "CampaignDeposit" (
    "id" UUID NOT NULL,
    "investorId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "owner" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "openSignature" TEXT,
    "claimedAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepositCredit" (
    "id" UUID NOT NULL,
    "depositId" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "signature" TEXT NOT NULL,
    "sender" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepositCredit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignDeposit_campaignId_idx" ON "CampaignDeposit"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignDeposit_investorId_campaignId_key" ON "CampaignDeposit"("investorId", "campaignId");

-- CreateIndex
CREATE INDEX "DepositCredit_depositId_idx" ON "DepositCredit"("depositId");

-- AddForeignKey
ALTER TABLE "CampaignDeposit" ADD CONSTRAINT "CampaignDeposit_investorId_fkey" FOREIGN KEY ("investorId") REFERENCES "Investor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignDeposit" ADD CONSTRAINT "CampaignDeposit_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositCredit" ADD CONSTRAINT "DepositCredit_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "CampaignDeposit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
