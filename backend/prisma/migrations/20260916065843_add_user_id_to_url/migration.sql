-- AlterTable
ALTER TABLE "Url" ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "Url_userId_idx" ON "Url"("userId");
