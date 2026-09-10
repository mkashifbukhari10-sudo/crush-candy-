import type { ActionFunctionArgs } from "react-router";
import { timingSafeEqual, createHmac } from "node:crypto";
import { getServerEnvironment } from "../config/env.server";
import { logger } from "../lib/logger.server";
import { calculateDeliveryRate, getDeliverySettings } from "../services/delivery.server";
import type { CarrierDestination, DistanceLookupDeps } from "../services/delivery/distance-provider.server";
import { DistanceProviderError, getDrivingDistanceKm } from "../services/delivery/distance-provider.server";

const NO_RATE_HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" } as const;

function validSignature(request: Request, body: string) { const signature = request.headers.get("x-shopify-hmac-sha256"); if (!signature) return false; const expected = createHmac("sha256", getServerEnvironment().SHOPIFY_API_SECRET).update(body).digest("base64"); const a = Buffer.from(signature); const b = Buffer.from(expected); return a.length === b.length && timingSafeEqual(a, b); }
function noRates() { return Response.json({ rates: [] }, { headers: NO_RATE_HEADERS }); }

type CarrierRatePayload = { rate?: { price?: number; destination?: CarrierDestination } };

/**
 * Shopify Carrier Service callback. Fails closed: any unmet precondition, provider failure or
 * unroutable destination returns an empty rate list rather than a guessed price.
 */
export async function action({ request }: ActionFunctionArgs, deps: DistanceLookupDeps = {}) {
  const body = await request.text();
  if (!validSignature(request, body)) return Response.json({ rates: [] }, { status: 401, headers: { "cache-control": "no-store" } });

  let payload: CarrierRatePayload;
  try { payload = JSON.parse(body) as CarrierRatePayload; } catch { return noRates(); }

  const settings = await getDeliverySettings();
  const destination = payload.rate?.destination;
  if (!settings || !destination) return noRates();

  const subtotalCents = Math.round(Number(payload.rate?.price ?? 0) * 100);

  // Preflight through the pricing engine with a valid placeholder distance so the non-distance
  // rules (enabled, AUD $250 minimum, DRIVING-only) stay defined in exactly one place. A billable
  // provider call is only worth making once those already pass.
  const preflight = calculateDeliveryRate({ distanceKm: 0, subtotalCents, settings });
  if (!preflight.available) return noRates();

  let distanceKm: number;
  try {
    distanceKm = await getDrivingDistanceKm(destination, deps);
  } catch (error) {
    // Reason code only — never the address, coordinates or key.
    logger.warn("delivery.distance.unavailable", { reason: error instanceof DistanceProviderError ? error.reason : "UNEXPECTED_ERROR" });
    return noRates();
  }

  const result = calculateDeliveryRate({ distanceKm, subtotalCents, settings });
  return Response.json({ rates: result.available ? [{ service_name: "Perth delivery", service_code: "CCS-PERTH", total_price: String(result.amountCents), currency: "AUD", description: "Calculated delivery" }] : [] }, { headers: NO_RATE_HEADERS });
}
