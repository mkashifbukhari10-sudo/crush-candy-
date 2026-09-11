-- A pickup order has no delivery SLA, so slaDueAt must be clearable.
ALTER TABLE "Assignment" ALTER COLUMN "slaDueAt" DROP NOT NULL;
