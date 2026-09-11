-- AlterTable
ALTER TABLE `businesses` ADD COLUMN `licenseStatus` ENUM('PENDING', 'ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN `licenseActivatedAt` DATETIME(3) NULL,
    ADD COLUMN `licenseActivatedBy` INTEGER NULL,
    ADD COLUMN `createdByUserId` INTEGER NULL,
    ADD COLUMN `paymentLinkId` VARCHAR(100) NULL,
    ADD COLUMN `paymentLinkUrl` TEXT NULL,
    ADD COLUMN `paymentLinkAmount` DECIMAL(12, 2) NULL,
    ADD COLUMN `paymentLinkGeneratedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `license_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessId` INTEGER NOT NULL,
    `eventType` ENUM('CREATED', 'PAYMENT_LINK_GENERATED', 'PAYMENT_RECEIVED', 'ACTIVATED', 'SUSPENDED', 'REACTIVATED') NOT NULL,
    `note` TEXT NULL,
    `amount` DECIMAL(12, 2) NULL,
    `actorUserId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `license_events_businessId_idx`(`businessId` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `license_events` ADD CONSTRAINT `license_events_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `businesses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
