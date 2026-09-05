ALTER TYPE "ConversationKind" ADD VALUE 'PICKUP_ARRANGEMENT';
ALTER TYPE "ParticipantRole" ADD VALUE 'ADMIN';

ALTER TABLE "AppSettings" ADD COLUMN "largeQuantityThresholdGrams" INTEGER DEFAULT 5000;
UPDATE "AppSettings" SET "largeQuantityThresholdGrams" = 5000 WHERE "largeQuantityThresholdGrams" IS NULL;
ALTER TABLE "AppSettings" ALTER COLUMN "largeQuantityThresholdGrams" SET DEFAULT 5000;

ALTER TABLE "Conversation" DROP CONSTRAINT IF EXISTS "Conversation_assignmentId_key";
ALTER TABLE "Conversation" DROP CONSTRAINT IF EXISTS "Conversation_shopifyOrderId_key";
CREATE UNIQUE INDEX "Conversation_assignmentId_kind_key" ON "Conversation"("assignmentId", "kind");
