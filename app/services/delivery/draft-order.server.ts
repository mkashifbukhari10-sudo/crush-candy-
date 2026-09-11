import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

import type { CartLine, DeliveryAddressInput } from "./cart-quote.server";

/**
 * Creates the Shopify Draft Order that carries our calculated delivery charge into the native
 * checkout. The fee travels as a custom shipping line — Shopify treats a shipping line with no
 * `shippingRateHandle` as custom — so no CarrierService and no `write_shipping` is involved.
 */

export type DraftOrderFailure = "USER_ERROR" | "TRANSPORT_ERROR" | "NO_DRAFT_ORDER" | "NO_INVOICE_URL";

export class DeliveryDraftOrderError extends Error {
  readonly reason: DraftOrderFailure;

  constructor(reason: DraftOrderFailure, message?: string) {
    super(message ?? reason);
    this.name = "DeliveryDraftOrderError";
    this.reason = reason;
  }
}

export type DeliveryDraftOrderInput = {
  customerId: string;
  lines: CartLine[];
  address: DeliveryAddressInput;
  feeCents: number;
  shippingTitle?: string;
  /** Inventory is held only for the life of the quote so abandoned drafts free stock on their own. */
  reserveInventoryUntil?: Date;
};

export type DeliveryDraftOrder = {
  id: string;
  name: string | null;
  invoiceUrl: string;
  subtotalCents: number | null;
  shippingCents: number | null;
  totalCents: number | null;
  currencyCode: string | null;
  shippingLineIsCustom: boolean | null;
  shippingLineCents: number | null;
};

const CREATE_DRAFT_ORDER = `#graphql
  mutation CreateDeliveryDraftOrder($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder {
        id
        name
        invoiceUrl
        currencyCode
        subtotalPriceSet { shopMoney { amount } }
        totalShippingPriceSet { shopMoney { amount } }
        totalPriceSet { shopMoney { amount } }
        shippingLine { custom discountedPriceSet { shopMoney { amount } } }
      }
      userErrors { field message }
    }
  }`;

type MoneySet = { shopMoney?: { amount?: string | null } | null } | null;

type DraftOrderCreateBody = {
  data?: {
    draftOrderCreate?: {
      draftOrder?: {
        id?: string;
        name?: string | null;
        invoiceUrl?: string | null;
        currencyCode?: string | null;
        subtotalPriceSet?: MoneySet;
        totalShippingPriceSet?: MoneySet;
        totalPriceSet?: MoneySet;
        shippingLine?: { custom?: boolean | null; discountedPriceSet?: MoneySet } | null;
      } | null;
      userErrors?: Array<{ field?: string[] | null; message?: string }>;
    } | null;
  } | null;
  errors?: Array<{ message?: string }>;
};

/** Money crosses the API boundary as a decimal string so no float rounding reaches Shopify. */
export function centsToAmount(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) throw new DeliveryDraftOrderError("USER_ERROR", "Fee must be whole non-negative cents.");
  return (cents / 100).toFixed(2);
}

const centsFrom = (money: MoneySet): number | null => {
  const amount = Number(money?.shopMoney?.amount);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
};

export function buildDeliveryDraftOrderInput(input: DeliveryDraftOrderInput) {
  return {
    input: {
      purchasingEntity: { customerId: input.customerId },
      lineItems: input.lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
      // No shippingRateHandle: this is what makes the line custom and priced by us.
      shippingLine: {
        title: input.shippingTitle ?? "Perth delivery",
        priceWithCurrency: { amount: centsToAmount(input.feeCents), currencyCode: "AUD" },
      },
      shippingAddress: {
        firstName: input.address.firstName,
        lastName: input.address.lastName,
        address1: input.address.address1,
        ...(input.address.address2 ? { address2: input.address.address2 } : {}),
        city: input.address.city,
        provinceCode: input.address.provinceCode,
        zip: input.address.zip,
        countryCode: input.address.countryCode,
        ...(input.address.phone ? { phone: input.address.phone } : {}),
      },
      // Automatic discounts and codes keep their normal Shopify semantics.
      acceptAutomaticDiscounts: true,
      allowDiscountCodesInCheckout: true,
      ...(input.reserveInventoryUntil ? { reserveInventoryUntil: input.reserveInventoryUntil.toISOString() } : {}),
      tags: ["ccs-delivery"],
    },
  };
}

export function parseDeliveryDraftOrder(body: DraftOrderCreateBody): DeliveryDraftOrder {
  if (body.errors?.length) throw new DeliveryDraftOrderError("TRANSPORT_ERROR");

  const userErrors = body.data?.draftOrderCreate?.userErrors ?? [];
  if (userErrors.length) {
    throw new DeliveryDraftOrderError("USER_ERROR", userErrors.map((error) => error.message).filter(Boolean).join("; "));
  }

  const draft = body.data?.draftOrderCreate?.draftOrder;
  if (!draft?.id) throw new DeliveryDraftOrderError("NO_DRAFT_ORDER");
  // Without a checkout link the customer cannot pay, so treat it as a failure rather than
  // leaving a draft order stranded behind a dead end.
  if (!draft.invoiceUrl) throw new DeliveryDraftOrderError("NO_INVOICE_URL");

  return {
    id: draft.id,
    name: draft.name ?? null,
    invoiceUrl: draft.invoiceUrl,
    subtotalCents: centsFrom(draft.subtotalPriceSet ?? null),
    shippingCents: centsFrom(draft.totalShippingPriceSet ?? null),
    totalCents: centsFrom(draft.totalPriceSet ?? null),
    currencyCode: draft.currencyCode ?? null,
    shippingLineIsCustom: draft.shippingLine?.custom ?? null,
    shippingLineCents: centsFrom(draft.shippingLine?.discountedPriceSet ?? null),
  };
}

export async function createDeliveryDraftOrder(
  admin: AdminApiContext,
  input: DeliveryDraftOrderInput,
): Promise<DeliveryDraftOrder> {
  const response = await admin.graphql(CREATE_DRAFT_ORDER, { variables: buildDeliveryDraftOrderInput(input) });
  return parseDeliveryDraftOrder((await response.json()) as DraftOrderCreateBody);
}
