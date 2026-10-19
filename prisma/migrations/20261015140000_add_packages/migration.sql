-- AlterTable
ALTER TABLE `invoice_lines` ADD COLUMN `packageId` INTEGER NULL,
    ADD COLUMN `packageComponents` JSON NULL;

-- CreateTable
CREATE TABLE `packages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessId` INTEGER NOT NULL DEFAULT 1,
    `name` VARCHAR(150) NOT NULL,
    `description` TEXT NULL,
    `price` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `accountId` INTEGER NULL,
    `vatCode` ENUM('VAT', 'EXEMPT', 'ZERO') NOT NULL DEFAULT 'VAT',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `packages_businessId_idx`(`businessId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `package_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `packageId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `quantity` DECIMAL(12, 3) NOT NULL DEFAULT 1,

    INDEX `package_items_packageId_idx`(`packageId`),
    INDEX `package_items_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `package_items` ADD CONSTRAINT `package_items_packageId_fkey` FOREIGN KEY (`packageId`) REFERENCES `packages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `package_items` ADD CONSTRAINT `package_items_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `inventory_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
