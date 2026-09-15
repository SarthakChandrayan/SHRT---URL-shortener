-- CreateTable
CREATE TABLE "Click" (
    "id" TEXT NOT NULL,
    "urlId" TEXT NOT NULL,
    "clickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Click_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Click_urlId_idx" ON "Click"("urlId");

-- AddForeignKey
ALTER TABLE "Click" ADD CONSTRAINT "Click_urlId_fkey" FOREIGN KEY ("urlId") REFERENCES "Url"("id") ON DELETE CASCADE ON UPDATE CASCADE;
