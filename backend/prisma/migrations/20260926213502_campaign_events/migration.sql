-- CreateTable
CREATE TABLE "CampaignEvent" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "signature" TEXT NOT NULL,
    "slot" BIGINT NOT NULL,
    "blockTime" TIMESTAMP(3),
    "index" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignEvent_campaignId_slot_idx" ON "CampaignEvent"("campaignId", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignEvent_signature_index_key" ON "CampaignEvent"("signature", "index");

-- AddForeignKey
ALTER TABLE "CampaignEvent" ADD CONSTRAINT "CampaignEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
