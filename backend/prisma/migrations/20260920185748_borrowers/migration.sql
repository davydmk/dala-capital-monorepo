-- CreateEnum
CREATE TYPE "BorrowerStatus" AS ENUM ('DRAFT', 'APPROVED', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CreditRating" AS ENUM ('A', 'B', 'C', 'D');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('REGISTRATION', 'CHARTER', 'FINANCIALS', 'TAX', 'CONTRACT', 'OTHER');

-- CreateTable
CREATE TABLE "Borrower" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "logoKey" TEXT,
    "bin" TEXT NOT NULL,
    "status" "BorrowerStatus" NOT NULL DEFAULT 'DRAFT',
    "rating" "CreditRating",
    "industry" TEXT,
    "address" TEXT,
    "website" TEXT,
    "foundedAt" TIMESTAMP(3),
    "annualRevenueUsd" BIGINT,
    "employees" INTEGER,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "payoutWallet" TEXT,
    "riskNote" TEXT,
    "userId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Borrower_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BorrowerEvent" (
    "id" UUID NOT NULL,
    "borrowerId" UUID NOT NULL,
    "actorUserId" UUID,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BorrowerEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BorrowerDocument" (
    "id" UUID NOT NULL,
    "borrowerId" UUID NOT NULL,
    "kind" "DocumentKind" NOT NULL DEFAULT 'OTHER',
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BorrowerDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Borrower_bin_key" ON "Borrower"("bin");

-- CreateIndex
CREATE UNIQUE INDEX "Borrower_userId_key" ON "Borrower"("userId");

-- CreateIndex
CREATE INDEX "Borrower_status_idx" ON "Borrower"("status");

-- CreateIndex
CREATE INDEX "BorrowerEvent_borrowerId_createdAt_idx" ON "BorrowerEvent"("borrowerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BorrowerDocument_storageKey_key" ON "BorrowerDocument"("storageKey");

-- CreateIndex
CREATE INDEX "BorrowerDocument_borrowerId_idx" ON "BorrowerDocument"("borrowerId");

-- AddForeignKey
ALTER TABLE "Borrower" ADD CONSTRAINT "Borrower_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BorrowerEvent" ADD CONSTRAINT "BorrowerEvent_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BorrowerDocument" ADD CONSTRAINT "BorrowerDocument_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE CASCADE ON UPDATE CASCADE;
