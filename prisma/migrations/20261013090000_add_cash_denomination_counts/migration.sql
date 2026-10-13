-- CreateTable
CREATE TABLE `cash_denomination_counts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessId` INTEGER NOT NULL,
    `sourceType` VARCHAR(30) NOT NULL,
    `sourceId` INTEGER NOT NULL,
    `direction` VARCHAR(5) NOT NULL,
    `accountCode` VARCHAR(20) NULL,
    `lines` JSON NOT NULL,
    `total` DECIMAL(15, 2) NOT NULL,
    `expectedAmount` DECIMAL(15, 2) NULL,
    `variance` DECIMAL(15, 2) NULL,
    `countedBy` VARCHAR(100) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `cash_denomination_counts_businessId_sourceType_sourceId_idx`(`businessId`, `sourceType`, `sourceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
