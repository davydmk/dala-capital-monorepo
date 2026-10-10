-- CreateEnum
CREATE TYPE "InvestorType" AS ENUM ('INDIVIDUAL', 'COMPANY');

-- CreateEnum
CREATE TYPE "KycProviderName" AS ENUM ('MANUAL', 'SUMSUB');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED', 'DRAFT', 'PENDING', 'ON_HOLD', 'APPROVED', 'RETRY', 'REJECTED');

-- CreateEnum
CREATE TYPE "KycAnswer" AS ENUM ('GREEN', 'RED');

-- CreateEnum
CREATE TYPE "KycRejectType" AS ENUM ('RETRY', 'FINAL');

-- CreateEnum
CREATE TYPE "IdDocType" AS ENUM ('PASSPORT', 'ID_CARD', 'RESIDENCE_PERMIT', 'DRIVERS');

-- CreateEnum
CREATE TYPE "InvestorDocumentKind" AS ENUM ('IDENTITY', 'SELFIE', 'PROOF_OF_ADDRESS', 'COMPANY_REGISTRY', 'COMPANY_CHARTER', 'DIRECTOR_APPOINTMENT', 'OWNERSHIP_STRUCTURE', 'OTHER');

-- CreateEnum
CREATE TYPE "SourceOfFunds" AS ENUM ('SALARY', 'BUSINESS', 'INVESTMENTS', 'SALE_OF_ASSETS', 'INHERITANCE', 'SAVINGS', 'OTHER');

-- CreateTable
CREATE TABLE "Investor" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "InvestorType" NOT NULL DEFAULT 'INDIVIDUAL',
    "status" "KycStatus" NOT NULL DEFAULT 'DRAFT',
    "step" INTEGER NOT NULL DEFAULT 1,
    "provider" "KycProviderName" NOT NULL DEFAULT 'MANUAL',
    "applicantId" TEXT,
    "levelName" TEXT,
    "reviewAnswer" "KycAnswer",
    "reviewRejectType" "KycRejectType",
    "rejectLabels" TEXT[],
    "moderationComment" TEXT,
    "clientComment" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "firstName" TEXT,
    "lastName" TEXT,
    "middleName" TEXT,
    "dob" TIMESTAMP(3),
    "placeOfBirth" TEXT,
    "countryOfBirth" TEXT,
    "nationality" TEXT,
    "country" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "postCode" TEXT,
    "phone" TEXT,
    "position" TEXT,
    "idDocType" "IdDocType",
    "idDocNumber" TEXT,
    "idDocCountry" TEXT,
    "idDocValidUntil" TIMESTAMP(3),
    "companyName" TEXT,
    "registrationNumber" TEXT,
    "incorporatedOn" TIMESTAMP(3),
    "companyCountry" TEXT,
    "legalAddress" TEXT,
    "website" TEXT,
    "sourceOfFunds" "SourceOfFunds",
    "sourceOfFundsNote" TEXT,
    "isPep" BOOLEAN,
    "pepDetails" TEXT,
    "termsAcceptedAt" TIMESTAMP(3),
    "riskAcceptedAt" TIMESTAMP(3),
    "withdrawalAddress" TEXT,
    "withdrawalCheckedAt" TIMESTAMP(3),
    "withdrawalCheckResult" TEXT,
    "pendingWithdrawalAddress" TEXT,
    "pendingRequestedAt" TIMESTAMP(3),
    "onchainAccount" TEXT,
    "onchainSignature" TEXT,
    "onchainCreatedAt" TIMESTAMP(3),
    "whitelistStatus" BOOLEAN NOT NULL DEFAULT false,
    "whitelistBlockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Investor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestorBeneficiary" (
    "id" UUID NOT NULL,
    "investorId" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "shareBps" INTEGER NOT NULL,
    "position" TEXT,
    "isPep" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvestorBeneficiary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestorDocument" (
    "id" UUID NOT NULL,
    "investorId" UUID NOT NULL,
    "kind" "InvestorDocumentKind" NOT NULL DEFAULT 'OTHER',
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT,
    "providerFileId" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvestorDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestorEvent" (
    "id" UUID NOT NULL,
    "investorId" UUID NOT NULL,
    "actorUserId" UUID,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvestorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Investor_userId_key" ON "Investor"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Investor_applicantId_key" ON "Investor"("applicantId");

-- CreateIndex
CREATE INDEX "Investor_status_idx" ON "Investor"("status");

-- CreateIndex
CREATE INDEX "InvestorBeneficiary_investorId_idx" ON "InvestorBeneficiary"("investorId");

-- CreateIndex
CREATE UNIQUE INDEX "InvestorDocument_storageKey_key" ON "InvestorDocument"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "InvestorDocument_providerFileId_key" ON "InvestorDocument"("providerFileId");

-- CreateIndex
CREATE INDEX "InvestorDocument_investorId_idx" ON "InvestorDocument"("investorId");

-- CreateIndex
CREATE INDEX "InvestorEvent_investorId_createdAt_idx" ON "InvestorEvent"("investorId", "createdAt");

-- AddForeignKey
ALTER TABLE "Investor" ADD CONSTRAINT "Investor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestorBeneficiary" ADD CONSTRAINT "InvestorBeneficiary_investorId_fkey" FOREIGN KEY ("investorId") REFERENCES "Investor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestorDocument" ADD CONSTRAINT "InvestorDocument_investorId_fkey" FOREIGN KEY ("investorId") REFERENCES "Investor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestorEvent" ADD CONSTRAINT "InvestorEvent_investorId_fkey" FOREIGN KEY ("investorId") REFERENCES "Investor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
