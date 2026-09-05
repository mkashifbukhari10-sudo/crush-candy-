import type { Prisma, PrismaClient } from "@prisma/client";

type AuditClient = Pick<PrismaClient, "auditLog"> | Prisma.TransactionClient;

export interface AuditEvent {
  actorPlane: "ADMIN" | "CUSTOMER" | "SYSTEM";
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  payload?: Prisma.InputJsonValue;
  ipHash?: string;
}

export async function appendAuditLog(
  client: AuditClient,
  event: AuditEvent,
): Promise<void> {
  await client.auditLog.create({
    data: {
      actorPlane: event.actorPlane,
      actorId: event.actorId,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      payload: event.payload ?? {},
      ipHash: event.ipHash,
    },
  });
}
