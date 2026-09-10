import { createHash } from "node:crypto";
import { z } from "zod";

import { getServerEnvironment } from "../../config/env.server";
import { logger } from "../../lib/logger.server";
import { readCachedDistanceKm, writeCachedDistanceKm } from "./distance-cache.server";

// Routes API replaced the legacy Distance Matrix API on 2025-03-01. computeRouteMatrix
// is the supported server-side product for driving distance between a private origin
// and a checkout destination.
const ROUTE_MATRIX_ENDPOINT = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
const ROUTE_MATRIX_FIELD_MASK = "originIndex,destinationIndex,distanceMeters,condition,status";
const SUPPORTED_PROVIDER = "google";
const DEFAULT_TIMEOUT_MS = 5_000;

export type DistanceFailureReason =
  | "PROVIDER_NOT_CONFIGURED"
  | "ORIGIN_NOT_CONFIGURED"
  | "DESTINATION_INCOMPLETE"
  | "NO_ROUTE"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_ERROR"
  | "INVALID_RESPONSE";

export class DistanceProviderError extends Error {
  readonly reason: DistanceFailureReason;

  constructor(reason: DistanceFailureReason, message?: string) {
    super(message ?? `Driving distance unavailable: ${reason}`);
    this.name = "DistanceProviderError";
    this.reason = reason;
  }
}

/** Shopify Carrier Service `rate.destination`. Fields absent for API-created services arrive as null. */
export type CarrierDestination = {
  address1?: string | null;
  address2?: string | null;
  address3?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
  zip?: string | null;
  country?: string | null;
};

export type DistanceProviderConfig = {
  provider: typeof SUPPORTED_PROVIDER;
  apiKey: string;
  origin: { latitude: number; longitude: number };
};

type DistanceEnvironment = {
  DISTANCE_PROVIDER?: string;
  DISTANCE_API_KEY?: string;
  DELIVERY_ORIGIN_LATITUDE?: string;
  DELIVERY_ORIGIN_LONGITUDE?: string;
};

type DistanceCache = {
  read: (keyHash: string) => Promise<number | null>;
  write: (keyHash: string, distanceKm: number) => Promise<void>;
};

export type DistanceLookupDeps = {
  config?: DistanceProviderConfig;
  environment?: DistanceEnvironment;
  fetchImpl?: typeof fetch;
  cache?: DistanceCache | null;
  timeoutMs?: number;
};

function coordinate(value: string | undefined, limit: number): number | null {
  if (value === undefined) return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && Math.abs(parsed) <= limit ? parsed : null;
}

/**
 * Resolves the private origin and provider credentials. The origin is read only here and
 * never returned to a client — callers receive a distance, never a coordinate.
 */
export function resolveDistanceProviderConfig(
  environment: DistanceEnvironment = getServerEnvironment(),
): DistanceProviderConfig {
  const provider = environment.DISTANCE_PROVIDER?.trim().toLowerCase();
  const apiKey = environment.DISTANCE_API_KEY?.trim();
  if (provider !== SUPPORTED_PROVIDER || !apiKey) {
    throw new DistanceProviderError("PROVIDER_NOT_CONFIGURED");
  }

  const latitude = coordinate(environment.DELIVERY_ORIGIN_LATITUDE, 90);
  const longitude = coordinate(environment.DELIVERY_ORIGIN_LONGITUDE, 180);
  if (latitude === null || longitude === null) {
    throw new DistanceProviderError("ORIGIN_NOT_CONFIGURED");
  }

  return { provider: SUPPORTED_PROVIDER, apiKey, origin: { latitude, longitude } };
}

function part(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Builds the richest address the payload allows. Street lines materially improve routing
 * accuracy, so postcode/city alone is only the floor, never the target.
 */
export function buildDestinationAddress(destination: CarrierDestination): string | null {
  const postcode = part(destination.postal_code) ?? part(destination.zip);
  if (!postcode) return null;

  const segments = [
    part(destination.address1),
    part(destination.address2),
    part(destination.address3),
    part(destination.city),
    part(destination.province),
    postcode,
    part(destination.country),
  ].filter((segment): segment is string => segment !== null);

  return segments.join(", ");
}

/** Normalises an address so trivial formatting differences share one cached distance. */
export function normalizeDestinationAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Cache key. The origin is folded in so relocating the base invalidates every entry, and
 * only the digest is persisted — the address itself never reaches the database.
 */
export function buildDestinationKey(address: string, config: DistanceProviderConfig): string {
  return createHash("sha256")
    .update(
      `${config.provider}|${config.origin.latitude}|${config.origin.longitude}|${normalizeDestinationAddress(address)}`,
    )
    .digest("hex");
}

const routeMatrixElementSchema = z.object({
  originIndex: z.number().int().optional(),
  destinationIndex: z.number().int().optional(),
  distanceMeters: z.number().nonnegative().optional(),
  condition: z.string().optional(),
  status: z.object({ code: z.number().optional() }).loose().optional(),
});
const routeMatrixResponseSchema = z.array(routeMatrixElementSchema);

/**
 * Single computeRouteMatrix call for one origin and one destination. Returns road distance
 * in kilometres at metre precision; business rounding stays in the pricing engine.
 */
export async function fetchDrivingDistanceKm(
  address: string,
  config: DistanceProviderConfig,
  deps: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<number> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchImpl(ROUTE_MATRIX_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        // Key travels in a header, never a query string, so it cannot leak via logs or referrers.
        "x-goog-api-key": config.apiKey,
        "x-goog-fieldmask": ROUTE_MATRIX_FIELD_MASK,
      },
      body: JSON.stringify({
        origins: [
          {
            waypoint: {
              location: {
                latLng: { latitude: config.origin.latitude, longitude: config.origin.longitude },
              },
            },
          },
        ],
        destinations: [{ waypoint: { address } }],
        travelMode: "DRIVE",
        // Distance is traffic-independent; the unaware preference keeps results deterministic.
        routingPreference: "TRAFFIC_UNAWARE",
        units: "METRIC",
      }),
    });
  } catch (error) {
    const aborted = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
    throw new DistanceProviderError(aborted ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR");
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // Status only. Google echoes request detail in the body, which would carry the address.
    logger.warn("delivery.distance.provider_http_error", { status: response.status });
    throw new DistanceProviderError("PROVIDER_ERROR");
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new DistanceProviderError("INVALID_RESPONSE");
  }

  const result = routeMatrixResponseSchema.safeParse(parsed);
  if (!result.success || result.data.length === 0) {
    throw new DistanceProviderError("INVALID_RESPONSE");
  }

  const element =
    result.data.find((entry) => (entry.originIndex ?? 0) === 0 && (entry.destinationIndex ?? 0) === 0) ??
    result.data[0];

  if (element.condition !== "ROUTE_EXISTS" || (element.status?.code ?? 0) !== 0) {
    throw new DistanceProviderError("NO_ROUTE");
  }

  // distanceMeters is omitted when zero, which is a legitimate same-address result.
  const distanceKm = (element.distanceMeters ?? 0) / 1000;
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new DistanceProviderError("INVALID_RESPONSE");
  }

  return Math.round(distanceKm * 1000) / 1000;
}

/**
 * Driving distance from the private base to a checkout destination, served from the 30-day
 * cache when possible. Throws DistanceProviderError on every failure so callers fail closed.
 */
export async function getDrivingDistanceKm(
  destination: CarrierDestination,
  deps: DistanceLookupDeps = {},
): Promise<number> {
  const config = deps.config ?? resolveDistanceProviderConfig(deps.environment);
  const address = buildDestinationAddress(destination);
  if (!address) throw new DistanceProviderError("DESTINATION_INCOMPLETE");

  const keyHash = buildDestinationKey(address, config);
  const cache =
    deps.cache === undefined ? { read: readCachedDistanceKm, write: writeCachedDistanceKm } : deps.cache;

  if (cache) {
    // A cache fault must degrade to a live lookup, never to a failed checkout rate.
    try {
      const cached = await cache.read(keyHash);
      if (cached !== null) return cached;
    } catch (error) {
      logger.warn("delivery.distance.cache_read_failed", { error });
    }
  }

  const distanceKm = await fetchDrivingDistanceKm(address, config, {
    fetchImpl: deps.fetchImpl,
    timeoutMs: deps.timeoutMs,
  });

  if (cache) {
    try {
      await cache.write(keyHash, distanceKm);
    } catch (error) {
      logger.warn("delivery.distance.cache_write_failed", { error });
    }
  }

  return distanceKm;
}
