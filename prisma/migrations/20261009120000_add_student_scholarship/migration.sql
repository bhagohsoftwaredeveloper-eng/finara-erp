-- AlterTable
ALTER TABLE `students`
    ADD COLUMN `scholarshipType` ENUM('NONE', 'FULL', 'PARTIAL') NOT NULL DEFAULT 'NONE',
    ADD COLUMN `scholarshipPct` DECIMAL(5, 2) NULL;
