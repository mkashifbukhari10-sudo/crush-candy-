CREATE TYPE "FulfillmentMode" AS ENUM ('DELIVERY', 'PICKUP');

ALTER TABLE "Assignment"
  ADD COLUMN "fulfillmentMode" "FulfillmentMode" NOT NULL DEFAULT 'DELIVERY',
  ADD COLUMN "pickupElectedAt" TIMESTAMP(3);

CREATE INDEX "Assignment_fulfillmentMode_status_idx" ON "Assignment"("fulfillmentMode", "status");
