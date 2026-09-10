import db from "../../db.server";

/** Architecture plan §8.6: driving distance is cached 30 days per normalised address. */
export const DISTANCE_CACHE_TTL_DAYS = 30;
const TTL_MS = DISTANCE_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * Reads a live cache entry. Only the SHA-256 digest of the normalised address is stored, so
 * the table holds no customer address and no coordinate.
 */
export async function readCachedDistanceKm(keyHash: string): Promise<number | null> {
  const entry = await db.deliveryDistanceCache.findFirst({
    where: { keyHash, expiresAt: { gt: new Date() } },
    select: { distanceKm: true },
  });
  if (!entry) return null;

  const distanceKm = Number(entry.distanceKm);
  return Number.isFinite(distanceKm) && distanceKm >= 0 ? distanceKm : null;
}

export async function writeCachedDistanceKm(keyHash: string, distanceKm: number): Promise<void> {
  const expiresAt = new Date(Date.now() + TTL_MS);
  await db.deliveryDistanceCache.upsert({
    where: { keyHash },
    create: { keyHash, distanceKm, expiresAt },
    update: { distanceKm, expiresAt },
  });
}
