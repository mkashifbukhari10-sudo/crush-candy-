-- Delivery-facing fields the driver is entitled to see (architecture 13.9).
-- Deliberately excludes customer email, phone, surname and billing address.
ALTER TABLE "Assignment"
  ADD COLUMN "destinationAddress1" TEXT,
  ADD COLUMN "destinationAddress2" TEXT,
  ADD COLUMN "deliveryNotes" TEXT,
  ADD COLUMN "customerFirstName" TEXT;
