-- CreateEnum
CREATE TYPE "VoteChoice" AS ENUM ('FOR', 'AGAINST');

-- CreateTable
CREATE TABLE "BondSnapshot" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "actionIndex" INTEGER NOT NULL,
    "recordTs" INTEGER NOT NULL,
    "holders" JSONB NOT NULL,
    "units" BIGINT NOT NULL,
    "totalAmount" BIGINT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BondSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BondVote" (
    "id" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "investorId" UUID NOT NULL,
    "choice" "VoteChoice" NOT NULL,
    "weight" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BondVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BondSnapshot_campaignId_actionIndex_key" ON "BondSnapshot"("campaignId", "actionIndex");

-- CreateIndex
CREATE INDEX "BondVote_investorId_idx" ON "BondVote"("investorId");

-- CreateIndex
CREATE UNIQUE INDEX "BondVote_snapshotId_investorId_key" ON "BondVote"("snapshotId", "investorId");

-- AddForeignKey
ALTER TABLE "BondSnapshot" ADD CONSTRAINT "BondSnapshot_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BondVote" ADD CONSTRAINT "BondVote_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "BondSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BondVote" ADD CONSTRAINT "BondVote_investorId_fkey" FOREIGN KEY ("investorId") REFERENCES "Investor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
