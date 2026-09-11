import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { Prisma } from "@prisma/client";

import db from "../../db.server";
import { logger } from "../../lib/logger.server";
import { appendAuditLog } from "../audit/audit.server";
import { calculateDeliveryRate, getDeliverySettings } from "../delivery.server";
import type { DeliverySettings } from "../delivery.server";
import type { CartLine, DeliveryAddressInput, PricedCartLine } from "./cart-quote.server";
import { addressFingerprint, cartFingerprint, priceCartLines, quoteExpiry } from "./cart-quote.server";
import { DistanceProviderError, getDrivingDistanceKm } from "./distance-provider.server";
import type { DistanceLookupDeps } from "./distance-provider.server";
import { DeliveryDraftOrderError, createDeliveryDraftOrder } from "./draft-order.server";

/**
 * Quote → revalidate → draft order. Every money value is derived here from Shopify prices and the
 * locked pricing engine; nothing the client posts about price, distance or subtotal is used.
 */

export type QuoteBlockReason =
  | "DELIVERY_DISABLED"
  | "MINIMUM_ORDER"
  | "UNCONFIGURED_DISTANCE"
  | "DISTANCE_UNAVAILABLE"
  | "UNSERVICEABLE";

export type DeliveryQuoteView = {
  quoteId: string;
  lines: PricedCartLine[];
  subtotalCents: number;
  distanceKm: number;
  feeCents: number;
  totalCents: number;
  currency: "AUD";
  expiresAt: string;
};

export type QuoteOutcome =
  | { ok: true; quote: DeliveryQuoteView }
  | { ok: false; reason: QuoteBlockReason; subtotalCents: number; minimumOrderCents: number };

export class DeliveryCheckoutError extends Error {
  readonly reason: "QUOTE_NOT_FOUND" | "QUOTE_EXPIRED" | "QUOTE_CONSUMED" | "CART_CHANGED" | "ADDRESS_CHANGED" | "REPRICED" | "DRAFT_FAILED";

  constructor(reason: DeliveryCheckoutError["reason"], message?: string) {
    super(message ?? reason);
    this.name = "DeliveryCheckoutError";
    this.reason = reason;
  }
}

type QuoteDeps = { distance?: DistanceLookupDeps; now?: () => Date };

async function resolveSettings(): Promise<DeliverySettings | null> {
  return (await getDeliverySettings()) as DeliverySettings | null;
}

/**
 * Prices the cart, resolves driving distance and applies the locked tiers. Fails closed: any
 * provider problem blocks the flow rather than producing a guessed fee.
 */
export async function createDeliveryQuote(
  admin: AdminApiContext,
  params: { shop: string; customerId: string; lines: CartLine[]; address: DeliveryAddressInput },
  deps: QuoteDeps = {},
): Promise<QuoteOutcome> {
  const settings = await resolveSettings();
  const minimumOrderCents = settings?.minDeliverySpendCents ?? 25000;

  const { lines: priced, subtotalCents } = await priceCartLines(admin, params.lines);

  // Cheap, non-distance rules first so a cart that cannot qualify never costs a provider call.
  if (!settings || !settings.deliveryEnabled) {
    return { ok: false, reason: "DELIVERY_DISABLED", subtotalCents, minimumOrderCents };
  }
  if (subtotalCents < minimumOrderCents) {
    return { ok: false, reason: "MINIMUM_ORDER", subtotalCents, minimumOrderCents };
  }
  if (settings.distanceMethod !== "DRIVING" || !settings.kmRoundingMode) {
    return { ok: false, reason: "UNCONFIGURED_DISTANCE", subtotalCents, minimumOrderCents };
  }

  let distanceKm: number;
  try {
    distanceKm = await getDrivingDistanceKm(
      {
        address1: params.address.address1,
        address2: params.address.address2,
        city: params.address.city,
        province: params.address.provinceCode,
        postal_code: params.address.zip,
        country: params.address.countryCode,
      },
      deps.distance ?? {},
    );
  } catch (error) {
    logger.warn("delivery.quote.distance_unavailable", {
      reason: error instanceof DistanceProviderError ? error.reason : "UNEXPECTED_ERROR",
    });
    return { ok: false, reason: "DISTANCE_UNAVAILABLE", subtotalCents, minimumOrderCents };
  }

  const rate = calculateDeliveryRate({ distanceKm, subtotalCents, settings });
  if (!rate.available) {
    const reason: QuoteBlockReason =
      rate.reason === "MINIMUM_ORDER" ? "MINIMUM_ORDER" : rate.reason === "DISABLED" ? "DELIVERY_DISABLED" : rate.reason === "UNCONFIGURED_DISTANCE" ? "UNCONFIGURED_DISTANCE" : "UNSERVICEABLE";
    return { ok: false, reason, subtotalCents, minimumOrderCents };
  }

  const now = deps.now?.() ?? new Date();
  const expiresAt = quoteExpiry(now);
  const quote = await db.deliveryQuote.create({
    data: {
      shop: params.shop,
      shopifyCustomerId: params.customerId,
      cartFingerprint: cartFingerprint(params.lines),
      addressFingerprint: addressFingerprint(params.address),
      lines: params.lines as unknown as Prisma.InputJsonValue,
      shippingAddress: params.address as unknown as Prisma.InputJsonValue,
      subtotalCents,
      distanceKm,
      feeCents: rate.amountCents,
      expiresAt,
    },
    select: { id: true },
  });

  return {
    ok: true,
    quote: {
      quoteId: quote.id,
      lines: priced,
      subtotalCents,
      distanceKm,
      feeCents: rate.amountCents,
      totalCents: subtotalCents + rate.amountCents,
      currency: "AUD",
      expiresAt: expiresAt.toISOString(),
    },
  };
}

/**
 * Revalidates immediately before order creation, then creates the draft order and marks the quote
 * consumed in one transaction-guarded step so a double submit cannot produce two drafts.
 */
export async function confirmDeliveryQuote(
  admin: AdminApiContext,
  params: { shop: string; customerId: string; quoteId: string; lines: CartLine[]; address: DeliveryAddressInput },
  deps: QuoteDeps = {},
): Promise<{ invoiceUrl: string; draftOrderId: string }> {
  const now = deps.now?.() ?? new Date();
  const quote = await db.deliveryQuote.findFirst({
    where: { id: params.quoteId, shopifyCustomerId: params.customerId, shop: params.shop },
  });

  if (!quote) throw new DeliveryCheckoutError("QUOTE_NOT_FOUND");
  if (quote.status === "CONSUMED") throw new DeliveryCheckoutError("QUOTE_CONSUMED");
  if (quote.status === "EXPIRED" || quote.expiresAt <= now) throw new DeliveryCheckoutError("QUOTE_EXPIRED");
  if (quote.cartFingerprint !== cartFingerprint(params.lines)) throw new DeliveryCheckoutError("CART_CHANGED");
  if (quote.addressFingerprint !== addressFingerprint(params.address)) throw new DeliveryCheckoutError("ADDRESS_CHANGED");

  // Re-price against Shopify. A price change between quoting and paying must not be absorbed.
  const { subtotalCents } = await priceCartLines(admin, params.lines);
  if (subtotalCents !== quote.subtotalCents) throw new DeliveryCheckoutError("REPRICED");

  const settings = await resolveSettings();
  if (!settings) throw new DeliveryCheckoutError("REPRICED");
  const rate = calculateDeliveryRate({ distanceKm: Number(quote.distanceKm), subtotalCents, settings });
  if (!rate.available || rate.amountCents !== quote.feeCents) throw new DeliveryCheckoutError("REPRICED");

  // Claim the quote before calling Shopify. A concurrent submit updates zero rows and stops here,
  // so one checkout intent can only ever produce one draft order.
  const claim = await db.deliveryQuote.updateMany({
    where: { id: quote.id, status: "ACTIVE" },
    data: { status: "CONSUMED", consumedAt: now },
  });
  if (claim.count === 0) throw new DeliveryCheckoutError("QUOTE_CONSUMED");

  let draft;
  try {
    draft = await createDeliveryDraftOrder(admin, {
      customerId: params.customerId,
      lines: params.lines,
      address: params.address,
      feeCents: quote.feeCents,
      reserveInventoryUntil: quote.expiresAt,
    });
  } catch (error) {
    // Release the claim so the customer can retry rather than being locked out by our own guard.
    await db.deliveryQuote.updateMany({ where: { id: quote.id }, data: { status: "ACTIVE", consumedAt: null } });
    logger.error("delivery.draft.failed", {
      quoteId: quote.id,
      reason: error instanceof DeliveryDraftOrderError ? error.reason : "UNEXPECTED_ERROR",
    });
    throw new DeliveryCheckoutError("DRAFT_FAILED");
  }

  await db.deliveryQuote.update({ where: { id: quote.id }, data: { draftOrderId: draft.id } });

  // Identifiers and amounts only — never the invoice URL, address or customer detail.
  await appendAuditLog(db, {
    actorPlane: "CUSTOMER",
    actorId: params.customerId,
    action: "DELIVERY_DRAFT_ORDER_CREATED",
    targetType: "DraftOrder",
    targetId: draft.id,
    payload: {
      quoteId: quote.id,
      subtotalCents: quote.subtotalCents,
      feeCents: quote.feeCents,
      distanceKm: Number(quote.distanceKm),
      shippingLineIsCustom: draft.shippingLineIsCustom,
      shippingLineCents: draft.shippingLineCents,
    },
  });
  logger.info("delivery.draft.created", { draftOrderId: draft.id, quoteId: quote.id, feeCents: quote.feeCents });

  return { invoiceUrl: draft.invoiceUrl, draftOrderId: draft.id };
}

/**
 * Expires stale quotes. Inventory holds lapse on their own at `reserveInventoryUntil`, so this
 * only tidies quote state; it never touches a draft order that may already be paid.
 */
export async function expireStaleDeliveryQuotes(now = new Date()): Promise<number> {
  const result = await db.deliveryQuote.updateMany({
    where: { status: "ACTIVE", expiresAt: { lte: now } },
    data: { status: "EXPIRED" },
  });
  return result.count;
}
