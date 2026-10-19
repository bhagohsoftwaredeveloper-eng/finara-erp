-- AlterTable
ALTER TABLE `bills` ADD COLUMN `paymentTerms` VARCHAR(50) NULL;

-- AlterTable
ALTER TABLE `invoices` ADD COLUMN `paymentTerms` VARCHAR(50) NULL;

-- AlterTable
ALTER TABLE `purchase_orders` ADD COLUMN `paymentTerms` VARCHAR(50) NULL;

-- AlterTable
ALTER TABLE `quotations` ADD COLUMN `paymentTerms` VARCHAR(50) NULL;

-- CreateTable
CREATE TABLE `payment_terms` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessId` INTEGER NOT NULL DEFAULT 1,
    `name` VARCHAR(50) NOT NULL,
    `days` INTEGER NOT NULL DEFAULT 0,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `payment_terms_businessId_idx`(`businessId`),
    UNIQUE INDEX `payment_terms_businessId_name_key`(`businessId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
