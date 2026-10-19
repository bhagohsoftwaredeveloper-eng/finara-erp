ALTER TABLE `cash_sale_items` ADD COLUMN `discountType` VARCHAR(10) NULL,
    ADD COLUMN `discountValue` DECIMAL(15, 2) NOT NULL DEFAULT 0;
