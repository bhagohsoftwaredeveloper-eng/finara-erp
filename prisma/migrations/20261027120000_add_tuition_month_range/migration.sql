-- AlterTable
ALTER TABLE `fee_types` ADD COLUMN `monthFrom` INTEGER NULL,
    ADD COLUMN `monthTo` INTEGER NULL;

-- AlterTable
ALTER TABLE `fee_structure_lines` ADD COLUMN `monthlyAmount` DECIMAL(15, 2) NULL,
    ADD COLUMN `months` INTEGER NULL;
