-- M4 dispatch core: Shopify order operational sidecar, assignment history, settings.
CREATE TYPE "AssignmentStatus" AS ENUM ('PENDING', 'ASSIGNED', 'SCHEDULED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'CANCELLED');

CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyOrderNumber" TEXT NOT NULL,
    "shopifyCustomerId" TEXT,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "slaDueAt" TIMESTAMP(3) NOT NULL,
    "scheduledFor" TIMESTAMP(3),
    "assignedAt" TIMESTAMP(3),
    "assignedBy" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "lineItems" JSONB,
    "destinationCity" TEXT,
    "destinationPostcode" TEXT,
    "driverId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AssignmentEvent" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorPlane" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssignmentEvent_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "autoAssignEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoAssignDriverId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Assignment_shopifyOrderId_key" ON "Assignment"("shopifyOrderId");
CREATE INDEX "Assignment_driverId_scheduledFor_idx" ON "Assignment"("driverId", "scheduledFor");
CREATE INDEX "Assignment_status_slaDueAt_idx" ON "Assignment"("status", "slaDueAt");
CREATE INDEX "Assignment_shopifyCustomerId_createdAt_idx" ON "Assignment"("shopifyCustomerId", "createdAt");
CREATE INDEX "AssignmentEvent_assignmentId_createdAt_idx" ON "AssignmentEvent"("assignmentId", "createdAt");
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssignmentEvent" ADD CONSTRAINT "AssignmentEvent_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
