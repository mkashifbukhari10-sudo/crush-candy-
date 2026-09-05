CREATE TYPE "AnnouncementAudience" AS ENUM ('CUSTOMER', 'DRIVER');
CREATE TYPE "AnnouncementStatus" AS ENUM ('DRAFT', 'PUBLISHED');
CREATE TYPE "HelpNodeType" AS ENUM ('OPTION', 'ANSWER', 'TERMINAL');
CREATE TYPE "SupportStatus" AS ENUM ('OPEN', 'ANSWERED', 'CLOSED');

ALTER TABLE "AppSettings" ADD COLUMN "largeQuantityThresholdCents" INTEGER;

CREATE TABLE "Announcement" (
  "id" TEXT NOT NULL,
  "audience" "AnnouncementAudience" NOT NULL,
  "status" "AnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "publishAt" TIMESTAMP(3),
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Announcement_audience_status_publishAt_sortOrder_idx" ON "Announcement"("audience", "status", "publishAt", "sortOrder");

CREATE TABLE "HelpNode" (
  "id" TEXT NOT NULL,
  "parentId" TEXT,
  "type" "HelpNodeType" NOT NULL DEFAULT 'OPTION',
  "label" TEXT NOT NULL,
  "guidance" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HelpNode_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HelpNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "HelpNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "HelpNode_parentId_active_sortOrder_idx" ON "HelpNode"("parentId", "active", "sortOrder");

CREATE TABLE "SupportTicket" (
  "id" TEXT NOT NULL,
  "shopifyCustomerId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "nodePath" JSONB NOT NULL,
  "subject" TEXT NOT NULL,
  "initialMessage" TEXT NOT NULL,
  "status" "SupportStatus" NOT NULL DEFAULT 'OPEN',
  "respondedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupportTicket_shopifyCustomerId_createdAt_idx" ON "SupportTicket"("shopifyCustomerId", "createdAt");
CREATE INDEX "SupportTicket_status_updatedAt_idx" ON "SupportTicket"("status", "updatedAt");

CREATE TABLE "SupportMessage" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "senderPlane" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupportMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "SupportMessage_ticketId_createdAt_id_idx" ON "SupportMessage"("ticketId", "createdAt", "id");
