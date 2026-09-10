CREATE TABLE "DeliveryDistanceCache" (
  "keyHash" TEXT NOT NULL,
  "distanceKm" DECIMAL(10,3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeliveryDistanceCache_pkey" PRIMARY KEY ("keyHash")
);

CREATE INDEX "DeliveryDistanceCache_expiresAt_idx" ON "DeliveryDistanceCache"("expiresAt");
