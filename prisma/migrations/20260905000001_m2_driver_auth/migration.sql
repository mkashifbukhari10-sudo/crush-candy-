-- M2 app-owned driver identity and authentication foundation.
CREATE TYPE "DriverStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

CREATE TABLE "DriverAccount" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "status" "DriverStatus" NOT NULL DEFAULT 'INVITED',
    "activationTokenHash" TEXT,
    "activationExpiresAt" TIMESTAMP(3),
    "resetTokenHash" TEXT,
    "resetExpiresAt" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginIp" TEXT,
    "createdByAdminId" TEXT NOT NULL,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedBy" TEXT,
    "deactivationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DriverAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Driver" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "phone" TEXT,
    "vehicleNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriverSession" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,
    "idleExpiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "DriverSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriverAuthEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "type" TEXT NOT NULL,
    "emailTried" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DriverAuthEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DriverAccount_email_key" ON "DriverAccount"("email");
CREATE UNIQUE INDEX "DriverAccount_activationTokenHash_key" ON "DriverAccount"("activationTokenHash");
CREATE UNIQUE INDEX "DriverAccount_resetTokenHash_key" ON "DriverAccount"("resetTokenHash");
CREATE INDEX "DriverAccount_status_idx" ON "DriverAccount"("status");
CREATE INDEX "DriverAccount_lockedUntil_idx" ON "DriverAccount"("lockedUntil");
CREATE UNIQUE INDEX "Driver_accountId_key" ON "Driver"("accountId");
CREATE INDEX "Driver_displayName_idx" ON "Driver"("displayName");
CREATE UNIQUE INDEX "DriverSession_tokenHash_key" ON "DriverSession"("tokenHash");
CREATE INDEX "DriverSession_accountId_revokedAt_idx" ON "DriverSession"("accountId", "revokedAt");
CREATE INDEX "DriverSession_absoluteExpiresAt_idx" ON "DriverSession"("absoluteExpiresAt");
CREATE INDEX "DriverSession_idleExpiresAt_idx" ON "DriverSession"("idleExpiresAt");
CREATE INDEX "DriverAuthEvent_accountId_createdAt_idx" ON "DriverAuthEvent"("accountId", "createdAt");
CREATE INDEX "DriverAuthEvent_type_createdAt_idx" ON "DriverAuthEvent"("type", "createdAt");

ALTER TABLE "Driver" ADD CONSTRAINT "Driver_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "DriverAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DriverSession" ADD CONSTRAINT "DriverSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "DriverAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriverAuthEvent" ADD CONSTRAINT "DriverAuthEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "DriverAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
