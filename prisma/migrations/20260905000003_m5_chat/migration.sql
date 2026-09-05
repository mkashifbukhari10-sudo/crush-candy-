CREATE TYPE "ConversationKind" AS ENUM ('ORDER_DELIVERY');
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "ParticipantRole" AS ENUM ('CUSTOMER', 'DRIVER');
CREATE TABLE "Conversation" (
  "id" TEXT NOT NULL, "kind" "ConversationKind" NOT NULL DEFAULT 'ORDER_DELIVERY', "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
  "assignmentId" TEXT NOT NULL, "shopifyOrderId" TEXT NOT NULL, "shopifyCustomerId" TEXT NOT NULL,
  "closedAt" TIMESTAMP(3), "visibleToCustomerUntil" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ConversationParticipant" (
  "id" TEXT NOT NULL, "conversationId" TEXT NOT NULL, "role" "ParticipantRole" NOT NULL, "subjectId" TEXT NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "leftAt" TIMESTAMP(3), "lastReadAt" TIMESTAMP(3), "lastReadMessageId" TEXT,
  CONSTRAINT "ConversationParticipant_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Message" (
  "id" TEXT NOT NULL, "conversationId" TEXT NOT NULL, "senderType" "ParticipantRole" NOT NULL, "senderId" TEXT NOT NULL, "senderLabel" TEXT NOT NULL, "body" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Conversation_assignmentId_key" ON "Conversation"("assignmentId");
CREATE UNIQUE INDEX "Conversation_shopifyOrderId_key" ON "Conversation"("shopifyOrderId");
CREATE INDEX "Conversation_shopifyCustomerId_createdAt_idx" ON "Conversation"("shopifyCustomerId", "createdAt");
CREATE INDEX "Conversation_status_updatedAt_idx" ON "Conversation"("status", "updatedAt");
CREATE INDEX "ConversationParticipant_subjectId_leftAt_idx" ON "ConversationParticipant"("subjectId", "leftAt");
CREATE UNIQUE INDEX "ConversationParticipant_conversationId_role_subjectId_key" ON "ConversationParticipant"("conversationId", "role", "subjectId");
CREATE INDEX "Message_conversationId_createdAt_id_idx" ON "Message"("conversationId", "createdAt", "id");
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
