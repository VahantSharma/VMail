/*
  Warnings:

  - You are about to drop the column `stripeSubscriptionId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `StripeSubscription` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[razorpaySubscriptionId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_stripeSubscriptionId_fkey";

-- DropIndex
DROP INDEX "User_stripeSubscriptionId_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "stripeSubscriptionId",
ADD COLUMN     "razorpaySubscriptionId" TEXT;

-- DropTable
DROP TABLE "StripeSubscription";

-- CreateTable
CREATE TABLE "RazorpaySubscription" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "razorpaySubscriptionId" TEXT,
    "razorpayPlanId" TEXT,
    "razorpayCustomerId" TEXT,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "status" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RazorpaySubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RazorpaySubscription_userId_key" ON "RazorpaySubscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RazorpaySubscription_razorpaySubscriptionId_key" ON "RazorpaySubscription"("razorpaySubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "User_razorpaySubscriptionId_key" ON "User"("razorpaySubscriptionId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_razorpaySubscriptionId_fkey" FOREIGN KEY ("razorpaySubscriptionId") REFERENCES "RazorpaySubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
