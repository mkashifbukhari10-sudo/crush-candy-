import prisma from "./client.server";
import { logger } from "../lib/logger.server";

export interface DatabaseHealth {
  readonly connected: boolean;
  readonly latencyMs: number;
}

export async function checkDatabaseHealth(
  requestId: string,
): Promise<DatabaseHealth> {
  const startedAt = performance.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      connected: true,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    logger.error("database.health_check_failed", {
      requestId,
      error,
    });
    return {
      connected: false,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }
}

