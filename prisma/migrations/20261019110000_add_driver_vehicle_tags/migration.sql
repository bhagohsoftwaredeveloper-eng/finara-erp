-- AlterTable
ALTER TABLE `journal_lines` ADD COLUMN `driverId` INTEGER NULL,
    ADD COLUMN `vehicleId` INTEGER NULL;

-- AlterTable
ALTER TABLE `expense_voucher_items` ADD COLUMN `driverId` INTEGER NULL,
    ADD COLUMN `vehicleId` INTEGER NULL;

-- AlterTable
ALTER TABLE `bill_lines` ADD COLUMN `driverId` INTEGER NULL,
    ADD COLUMN `vehicleId` INTEGER NULL;

-- CreateTable
CREATE TABLE `drivers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessId` INTEGER NOT NULL DEFAULT 1,
    `code` VARCHAR(30) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `drivers_businessId_idx`(`businessId`),
    UNIQUE INDEX `drivers_businessId_code_key`(`businessId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vehicles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessId` INTEGER NOT NULL DEFAULT 1,
    `code` VARCHAR(30) NOT NULL,
    `description` VARCHAR(150) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `vehicles_businessId_idx`(`businessId`),
    UNIQUE INDEX `vehicles_businessId_code_key`(`businessId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `journal_lines_driverId_idx` ON `journal_lines`(`driverId`);

-- CreateIndex
CREATE INDEX `journal_lines_vehicleId_idx` ON `journal_lines`(`vehicleId`);
