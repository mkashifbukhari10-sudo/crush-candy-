CREATE TYPE "DeliveryQuoteStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'EXPIRED');

CREATE TABLE "DeliveryQuote" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "shopifyCustomerId" TEXT NOT NULL,
  "cartFingerprint" TEXT NOT NULL,
  "addressFingerprint" TEXT NOT NULL,
  "lines" JSONB NOT NULL,
  "shippingAddress" JSONB NOT NULL,
  "subtotalCents" INTEGER NOT NULL,
  "distanceKm" DECIMAL(10,3) NOT NULL,
  "feeCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'AUD',
  "status" "DeliveryQuoteStatus" NOT NULL DEFAULT 'ACTIVE',
  "draftOrderId" TEXT,
  "consumedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeliveryQuote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeliveryQuote_shopifyCustomerId_status_idx" ON "DeliveryQuote"("shopifyCustomerId", "status");
CREATE INDEX "DeliveryQuote_expiresAt_idx" ON "DeliveryQuote"("expiresAt");
CREATE INDEX "DeliveryQuote_cartFingerprint_idx" ON "DeliveryQuote"("cartFingerprint");
