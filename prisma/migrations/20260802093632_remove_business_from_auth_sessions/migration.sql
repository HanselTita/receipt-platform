/*
  Warnings:

  - You are about to drop the column `businessId` on the `AuthSession` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "AuthSession" DROP CONSTRAINT "AuthSession_businessId_fkey";

-- AlterTable
ALTER TABLE "AuthSession" DROP COLUMN "businessId";
