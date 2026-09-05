import { Prisma } from "@prisma/client";

import { ACCESS_CODE_TTL_HOURS } from "../../config/constants";
import db from "../../db.server";
import { appendAuditLog } from "../audit/audit.server";
import {
  generateAccessCode,
  hashAccessCode,
} from "../../lib/access-code-security.server";

const GENERATION_ATTEMPTS = 5;

export interface AccessCodeListItem {
  id: string;
  last4: string;
  status: "ACTIVE" | "CLAIMED" | "REDEEMED" | "REVOKED" | "EXPIRED";
  expiresAt: string;
  createdAt: string;
}

export async function createAccessCode(createdByAdminId: string): Promise<{
  id: string;
  plaintext: string;
  expiresAt: string;
}> {
  for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt += 1) {
    const generated = generateAccessCode();
    const expiresAt = new Date(
      Date.now() + ACCESS_CODE_TTL_HOURS * 60 * 60 * 1000,
    );

    try {
      const record = await db.$transaction(async (transaction) => {
        const created = await transaction.accessCode.create({
          data: {
            codeHash: hashAccessCode(generated.plaintext),
            codeLast4: generated.last4,
            createdByAdminId,
            expiresAt,
          },
        });
        await appendAuditLog(transaction, {
          actorPlane: "ADMIN",
          actorId: createdByAdminId,
          action: "ACCESS_CODE_ISSUED",
          targetType: "AccessCode",
          targetId: created.id,
          payload: { expiresAt: expiresAt.toISOString(), last4: generated.last4 },
        });
        return created;
      });

      return {
        id: record.id,
        plaintext: generated.plaintext,
        expiresAt: expiresAt.toISOString(),
      };
    } catch (error) {
      const collision =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002";
      if (!collision || attempt === GENERATION_ATTEMPTS - 1) throw error;
    }
  }

  throw new Error("Unable to generate a unique access code");
}

export async function listAccessCodes(): Promise<AccessCodeListItem[]> {
  const now = new Date();
  const records = await db.accessCode.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      codeLast4: true,
      status: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  return records.map((record) => ({
    id: record.id,
    last4: record.codeLast4,
    status:
      record.status === "ACTIVE" && record.expiresAt <= now
        ? "EXPIRED"
        : record.status,
    expiresAt: record.expiresAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
  }));
}

export async function revokeAccessCode(
  id: string,
  revokedByAdminId: string,
): Promise<boolean> {
  return db.$transaction(async (transaction) => {
    const revokedAt = new Date();
    const result = await transaction.accessCode.updateMany({
      where: { id, status: "ACTIVE", redeemedAt: null },
      data: {
        status: "REVOKED",
        revokedAt,
        revokedBy: revokedByAdminId,
      },
    });

    if (result.count !== 1) return false;
    await appendAuditLog(transaction, {
      actorPlane: "ADMIN",
      actorId: revokedByAdminId,
      action: "ACCESS_CODE_REVOKED",
      targetType: "AccessCode",
      targetId: id,
      payload: { revokedAt: revokedAt.toISOString() },
    });
    return true;
  });
}
