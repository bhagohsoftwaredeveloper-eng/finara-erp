-- CreateTable
CREATE TABLE `delivery_receipts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessId` INTEGER NOT NULL DEFAULT 1,
    `drNo` VARCHAR(30) NOT NULL,
    `customerId` INTEGER NOT NULL,
    `invoiceId` INTEGER NULL,
    `drDate` DATE NOT NULL,
    `deliveryAddress` TEXT NULL,
    `driverName` VARCHAR(100) NULL,
    `vehicleNo` VARCHAR(50) NULL,
    `notes` TEXT NULL,
    `status` ENUM('DRAFT', 'DELIVERED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `deductStock` BOOLEAN NOT NULL DEFAULT false,
    `deliveredAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelReason` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `delivery_receipts_drNo_key`(`drNo`),
    INDEX `delivery_receipts_businessId_idx`(`businessId`),
    INDEX `delivery_receipts_customerId_idx`(`customerId`),
    INDEX `delivery_receipts_invoiceId_idx`(`invoiceId`),
    INDEX `delivery_receipts_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `delivery_receipt_lines` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deliveryReceiptId` INTEGER NOT NULL,
    `itemId` INTEGER NULL,
    `description` VARCHAR(255) NOT NULL,
    `quantity` DECIMAL(12, 3) NOT NULL DEFAULT 1,
    `unit` VARCHAR(20) NULL,

    INDEX `delivery_receipt_lines_deliveryReceiptId_idx`(`deliveryReceiptId`),
    INDEX `delivery_receipt_lines_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `delivery_receipts` ADD CONSTRAINT `delivery_receipts_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_receipts` ADD CONSTRAINT `delivery_receipts_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_receipt_lines` ADD CONSTRAINT `delivery_receipt_lines_deliveryReceiptId_fkey` FOREIGN KEY (`deliveryReceiptId`) REFERENCES `delivery_receipts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_receipt_lines` ADD CONSTRAINT `delivery_receipt_lines_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `inventory_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
