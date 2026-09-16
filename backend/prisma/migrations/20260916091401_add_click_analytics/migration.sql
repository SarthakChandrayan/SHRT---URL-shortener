-- AlterTable
ALTER TABLE "Click" ADD COLUMN     "browser" TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN     "deviceType" TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN     "os" TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN     "referrer" TEXT NOT NULL DEFAULT 'direct';
