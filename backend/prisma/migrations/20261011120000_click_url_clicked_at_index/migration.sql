-- Analytics queries filter clicks by url and time range; a composite index
-- serves those and still covers lookups by urlId alone.
DROP INDEX IF EXISTS "Click_urlId_idx";

-- CreateIndex
CREATE INDEX "Click_urlId_clickedAt_idx" ON "Click"("urlId", "clickedAt");
