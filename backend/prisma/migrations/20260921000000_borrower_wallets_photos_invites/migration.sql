-- CreateTable
CREATE TABLE "BorrowerWallet" (
    "id" UUID NOT NULL,
    "borrowerId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BorrowerWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BorrowerPhoto" (
    "id" UUID NOT NULL,
    "borrowerId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "caption" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BorrowerPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BorrowerInvite" (
    "id" UUID NOT NULL,
    "borrowerId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BorrowerInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BorrowerWallet_borrowerId_idx" ON "BorrowerWallet"("borrowerId");

-- CreateIndex
CREATE UNIQUE INDEX "BorrowerWallet_borrowerId_address_key" ON "BorrowerWallet"("borrowerId", "address");

-- CreateIndex
CREATE UNIQUE INDEX "BorrowerPhoto_storageKey_key" ON "BorrowerPhoto"("storageKey");

-- CreateIndex
CREATE INDEX "BorrowerPhoto_borrowerId_sortOrder_idx" ON "BorrowerPhoto"("borrowerId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "BorrowerInvite_tokenHash_key" ON "BorrowerInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "BorrowerInvite_borrowerId_idx" ON "BorrowerInvite"("borrowerId");

-- AddForeignKey
ALTER TABLE "BorrowerWallet" ADD CONSTRAINT "BorrowerWallet_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BorrowerPhoto" ADD CONSTRAINT "BorrowerPhoto_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BorrowerInvite" ADD CONSTRAINT "BorrowerInvite_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Переносим единственный кошелёк карточки в новую таблицу: адрес не должен потеряться.
INSERT INTO "BorrowerWallet" ("id", "borrowerId", "label", "address", "isDefault", "createdAt")
SELECT gen_random_uuid(), "id", 'Основной', "payoutWallet", true, CURRENT_TIMESTAMP
FROM "Borrower"
WHERE "payoutWallet" IS NOT NULL;

-- AlterTable
ALTER TABLE "Borrower" DROP COLUMN "payoutWallet";
