-- AlterTable
ALTER TABLE `inventory_items` ADD COLUMN `packsPerCase` INTEGER NULL,
    ADD COLUMN `pcsPerPack` INTEGER NULL,
    ADD COLUMN `weightPerPackKg` DECIMAL(10, 3) NULL;
