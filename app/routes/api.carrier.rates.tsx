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

type CarrierRatePayload = { rate?: { items?: unknown; destination?: CarrierDestination } };

function numeric(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return NaN;
}

/**
 * Cart subtotal from `rate.items`. Shopify sends no `rate.price`, and item prices already arrive
 * in subunits, so they are summed as-is against quantity with no currency conversion.
 *
 * Returns null for a cart that cannot be read in full. An unreadable line must never collapse into
 * a smaller-but-valid-looking subtotal, because that would quietly change which delivery tier — or
 * whether the AUD $250 minimum — applies.
 */
export function cartSubtotalCents(items: unknown): number | null {
  if (!Array.isArray(items)) return null;

  let subtotal = 0;
  for (const entry of items) {
    if (!entry || typeof entry !== "object") return null;

    const { price, quantity } = entry as { price?: unknown; quantity?: unknown };
    const priceCents = numeric(price);
    const count = numeric(quantity);
    if (!Number.isFinite(priceCents) || priceCents < 0) return null;
    if (!Number.isInteger(count) || count < 0) return null;

    subtotal += priceCents * count;
  }

  return Math.round(subtotal);
}

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

  const subtotalCents = cartSubtotalCents(payload.rate?.items);
  if (subtotalCents === null) return noRates();

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
