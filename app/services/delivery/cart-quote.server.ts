import { createHash } from "node:crypto";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

/**
 * Cart and quote integrity for the Basic-plan delivery flow.
 *
 * The client may say *what* is in the cart (variant + quantity). It never says what anything
 * costs: prices are read from Shopify, the subtotal is derived here, and the distance and fee are
 * computed server-side. A quote is bound to a cart fingerprint, an address fingerprint and the
 * authenticated customer, so a cart or address edited after quoting cannot reach a stale fee.
 */

const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/\d+$/;

/** Long enough to pay, short enough that prices and distance cannot drift materially. */
export const QUOTE_TTL_MINUTES = 20;
export const MAX_CART_LINES = 100;
export const MAX_LINE_QUANTITY = 500;

export type CartLine = { variantId: string; quantity: number };
export type PricedCartLine = CartLine & { title: string; unitPriceCents: number; lineTotalCents: number };

export type DeliveryAddressInput = {
  firstName: string;
  lastName: string;
  address1: string;
  address2?: string;
  city: string;
  provinceCode: string;
  zip: string;
  countryCode: string;
  phone?: string;
};

export type CartQuoteFailure =
  | "INVALID_CART"
  | "EMPTY_CART"
  | "INVALID_ADDRESS"
  | "VARIANT_UNAVAILABLE"
  | "PRICE_UNAVAILABLE";

export class CartQuoteError extends Error {
  readonly reason: CartQuoteFailure;

  constructor(reason: CartQuoteFailure, message?: string) {
    super(message ?? reason);
    this.name = "CartQuoteError";
    this.reason = reason;
  }
}

/** Parses client-supplied cart lines. Accepts identity and quantity only — never money. */
export function parseCartLines(raw: unknown): CartLine[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new CartQuoteError(Array.isArray(raw) ? "EMPTY_CART" : "INVALID_CART");
  }
  if (raw.length > MAX_CART_LINES) throw new CartQuoteError("INVALID_CART");

  const merged = new Map<string, number>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") throw new CartQuoteError("INVALID_CART");
    const { variantId, quantity } = entry as { variantId?: unknown; quantity?: unknown };

    const id = typeof variantId === "string" ? variantId.trim() : "";
    const gid = VARIANT_GID.test(id) ? id : /^\d+$/.test(id) ? `gid://shopify/ProductVariant/${id}` : null;
    if (!gid) throw new CartQuoteError("INVALID_CART");

    const count = typeof quantity === "number" ? quantity : Number(quantity);
    if (!Number.isInteger(count) || count < 1 || count > MAX_LINE_QUANTITY) {
      throw new CartQuoteError("INVALID_CART");
    }

    merged.set(gid, (merged.get(gid) ?? 0) + count);
  }

  // Sorted so the same cart always fingerprints identically regardless of client ordering.
  return [...merged.entries()]
    .map(([variantId, quantity]) => ({ variantId, quantity }))
    .sort((a, b) => a.variantId.localeCompare(b.variantId));
}

export function parseDeliveryAddress(raw: Record<string, unknown>): DeliveryAddressInput {
  const text = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string).trim() : "");
  const address: DeliveryAddressInput = {
    firstName: text("firstName"),
    lastName: text("lastName"),
    address1: text("address1"),
    address2: text("address2") || undefined,
    city: text("city"),
    provinceCode: text("provinceCode").toUpperCase(),
    zip: text("zip"),
    countryCode: (text("countryCode") || "AU").toUpperCase(),
    phone: text("phone") || undefined,
  };

  const required = [address.firstName, address.lastName, address.address1, address.city, address.provinceCode, address.zip, address.countryCode];
  if (required.some((value) => !value)) throw new CartQuoteError("INVALID_ADDRESS");
  if (!/^[A-Z]{2}$/.test(address.countryCode)) throw new CartQuoteError("INVALID_ADDRESS");
  if (address.zip.length > 12 || address.provinceCode.length > 8) throw new CartQuoteError("INVALID_ADDRESS");

  return address;
}

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export function cartFingerprint(lines: CartLine[]): string {
  return digest(lines.map((line) => `${line.variantId}:${line.quantity}`).join("|"));
}

export function addressFingerprint(address: DeliveryAddressInput): string {
  const normalise = (value: string | undefined) => (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return digest(
    [address.firstName, address.lastName, address.address1, address.address2, address.city, address.provinceCode, address.zip, address.countryCode]
      .map(normalise)
      .join("|"),
  );
}

const VARIANT_PRICES = `#graphql
  query DeliveryCartVariantPrices($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        title
        availableForSale
        price
        product { title status }
      }
    }
  }`;

type VariantNode = {
  id?: string;
  title?: string | null;
  availableForSale?: boolean | null;
  price?: string | null;
  product?: { title?: string | null; status?: string | null } | null;
} | null;

function centsFromShopifyPrice(price: string | null | undefined): number {
  const amount = Number(price);
  if (!Number.isFinite(amount) || amount < 0) throw new CartQuoteError("PRICE_UNAVAILABLE");
  return Math.round(amount * 100);
}

/**
 * Prices the cart from Shopify. The merchandise subtotal returned here is the only subtotal the
 * flow ever uses; anything the client sent about money is discarded.
 */
export async function priceCartLines(
  admin: AdminApiContext,
  lines: CartLine[],
): Promise<{ lines: PricedCartLine[]; subtotalCents: number }> {
  const response = await admin.graphql(VARIANT_PRICES, { variables: { ids: lines.map((line) => line.variantId) } });
  const body = (await response.json()) as { data?: { nodes?: VariantNode[] }; errors?: Array<{ message?: string }> };
  if (body.errors?.length) throw new CartQuoteError("PRICE_UNAVAILABLE");

  const nodes = body.data?.nodes ?? [];
  const byId = new Map<string, NonNullable<VariantNode>>();
  for (const node of nodes) if (node?.id) byId.set(node.id, node);

  const priced: PricedCartLine[] = lines.map((line) => {
    const node = byId.get(line.variantId);
    if (!node) throw new CartQuoteError("VARIANT_UNAVAILABLE");
    if (node.availableForSale === false || node.product?.status !== "ACTIVE") {
      throw new CartQuoteError("VARIANT_UNAVAILABLE");
    }
    const unitPriceCents = centsFromShopifyPrice(node.price);
    return {
      ...line,
      title: [node.product?.title, node.title && node.title !== "Default Title" ? node.title : null].filter(Boolean).join(" — ") || "Item",
      unitPriceCents,
      lineTotalCents: unitPriceCents * line.quantity,
    };
  });

  return { lines: priced, subtotalCents: priced.reduce((sum, line) => sum + line.lineTotalCents, 0) };
}

export function quoteExpiry(now = new Date()): Date {
  return new Date(now.getTime() + QUOTE_TTL_MINUTES * 60 * 1000);
}
