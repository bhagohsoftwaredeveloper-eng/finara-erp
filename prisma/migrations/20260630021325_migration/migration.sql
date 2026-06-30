-- DropForeignKey
ALTER TABLE `user_businesses` DROP FOREIGN KEY `user_businesses_businessId_fkey`;

-- DropForeignKey
ALTER TABLE `user_businesses` DROP FOREIGN KEY `user_businesses_userId_fkey`;

-- DropIndex
DROP INDEX `accounts_accountCode_idx` ON `accounts`;

-- DropIndex
DROP INDEX `inventory_items_sku_idx` ON `inventory_items`;

-- AddForeignKey
ALTER TABLE `user_businesses` ADD CONSTRAINT `user_businesses_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_businesses` ADD CONSTRAINT `user_businesses_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `businesses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER TABLE `remittance_periods` RENAME INDEX `remittance_periods_biz_type_month_year_key` TO `remittance_periods_businessId_type_periodMonth_periodYear_key`;
