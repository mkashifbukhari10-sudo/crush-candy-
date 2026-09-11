import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

import { POC_DRAFT_NOTE, POC_DRAFT_TAG } from "../../config/constants";

/**
 * Proof of concept only. Proves a Draft Order can carry an exact custom delivery charge into
 * Shopify checkout on a Basic-plan store — no CarrierService, no write_shipping, no checkout
 * customization. Nothing here is on the customer path and nothing completes or pays an order.
 */

/** Re-exported so callers get the tag alongside the creator. Defined in config/constants. */
export { POC_DRAFT_NOTE, POC_DRAFT_TAG };

const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/\d+$/;
const MONEY = /^\d{1,9}(\.\d{1,2})?$/;

export type PocAddress = {
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

export type DraftOrderPocInput = {
  variantId: string;
  quantity: number;
  shippingTitle: string;
  /** Decimal string in AUD, e.g. "75.00". Kept as a string so no float rounding reaches Shopify. */
  shippingAmount: string;
  email?: string;
  address: PocAddress;
};

export type DraftOrderPocResult = {
  id: string;
  name: string | null;
  invoiceUrl: string | null;
  ready: boolean | null;
  status: string | null;
  currencyCode: string | null;
  subtotal: string | null;
  shipping: string | null;
  total: string | null;
  shippingLine: { title: string | null; custom: boolean | null; amount: string | null } | null;
  lineItems: Array<{ title: string | null; quantity: number | null; variantId: string | null }>;
};

export class DraftOrderPocError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftOrderPocError";
  }
}

const CREATE_DRAFT_ORDER = `#graphql
  mutation CreateDeliveryPocDraftOrder($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder {
        id
        name
        invoiceUrl
        ready
        status
        currencyCode
        subtotalPriceSet { shopMoney { amount currencyCode } }
        totalShippingPriceSet { shopMoney { amount currencyCode } }
        totalPriceSet { shopMoney { amount currencyCode } }
        shippingLine {
          title
          custom
          discountedPriceSet { shopMoney { amount currencyCode } }
        }
        lineItems(first: 10) {
          nodes { title quantity variant { id } }
        }
      }
      userErrors { field message }
    }
  }`;

type MoneySet = { shopMoney?: { amount?: string | null; currencyCode?: string | null } | null } | null;
type DraftOrderCreateResponse = {
  data?: {
    draftOrderCreate?: {
      draftOrder?: {
        id?: string;
        name?: string | null;
        invoiceUrl?: string | null;
        ready?: boolean | null;
        status?: string | null;
        currencyCode?: string | null;
        subtotalPriceSet?: MoneySet;
        totalShippingPriceSet?: MoneySet;
        totalPriceSet?: MoneySet;
        shippingLine?: { title?: string | null; custom?: boolean | null; discountedPriceSet?: MoneySet } | null;
        lineItems?: { nodes?: Array<{ title?: string | null; quantity?: number | null; variant?: { id?: string | null } | null }> } | null;
      } | null;
      userErrors?: Array<{ field?: string[] | null; message?: string }>;
    } | null;
  } | null;
  errors?: Array<{ message?: string }>;
};

const amountOf = (money: MoneySet) => money?.shopMoney?.amount ?? null;

export function buildDraftOrderPocVariables(input: DraftOrderPocInput) {
  if (!VARIANT_GID.test(input.variantId.trim())) {
    throw new DraftOrderPocError("Variant must be a ProductVariant GID, e.g. gid://shopify/ProductVariant/123.");
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 100) {
    throw new DraftOrderPocError("Quantity must be a whole number between 1 and 100.");
  }
  if (!MONEY.test(input.shippingAmount.trim())) {
    throw new DraftOrderPocError("Shipping amount must be a positive decimal with at most two places, e.g. 75.00.");
  }
  const title = input.shippingTitle.trim();
  if (!title) throw new DraftOrderPocError("Shipping title is required.");

  const address = input.address;
  for (const [field, value] of [
    ["first name", address.firstName],
    ["last name", address.lastName],
    ["address line 1", address.address1],
    ["city", address.city],
    ["state/province code", address.provinceCode],
    ["postcode", address.zip],
    ["country code", address.countryCode],
  ] as const) {
    if (!value?.trim()) throw new DraftOrderPocError(`Test address is missing the ${field}.`);
  }

  return {
    input: {
      lineItems: [{ variantId: input.variantId.trim(), quantity: input.quantity }],
      // shippingRateHandle omitted: that is what makes this a custom shipping line, priced by us
      // rather than by a carrier service or a configured shipping rate.
      shippingLine: {
        title,
        priceWithCurrency: { amount: input.shippingAmount.trim(), currencyCode: "AUD" },
      },
      shippingAddress: {
        firstName: address.firstName.trim(),
        lastName: address.lastName.trim(),
        address1: address.address1.trim(),
        ...(address.address2?.trim() ? { address2: address.address2.trim() } : {}),
        city: address.city.trim(),
        provinceCode: address.provinceCode.trim().toUpperCase(),
        zip: address.zip.trim(),
        countryCode: address.countryCode.trim().toUpperCase(),
        ...(address.phone?.trim() ? { phone: address.phone.trim() } : {}),
      },
      ...(input.email?.trim() ? { email: input.email.trim() } : {}),
      tags: [POC_DRAFT_TAG],
      note: POC_DRAFT_NOTE,
    },
  };
}

export function parseDraftOrderPocResponse(body: DraftOrderPocResponseLike): DraftOrderPocResult {
  if (body.errors?.length) throw new DraftOrderPocError("Shopify rejected the draft order request.");

  const userErrors = body.data?.draftOrderCreate?.userErrors ?? [];
  if (userErrors.length) {
    throw new DraftOrderPocError(userErrors.map((error) => error.message).filter(Boolean).join("; ") || "Draft order was rejected.");
  }

  const draft = body.data?.draftOrderCreate?.draftOrder;
  if (!draft?.id) throw new DraftOrderPocError("Shopify returned no draft order.");

  return {
    id: draft.id,
    name: draft.name ?? null,
    invoiceUrl: draft.invoiceUrl ?? null,
    ready: draft.ready ?? null,
    status: draft.status ?? null,
    currencyCode: draft.currencyCode ?? null,
    subtotal: amountOf(draft.subtotalPriceSet ?? null),
    shipping: amountOf(draft.totalShippingPriceSet ?? null),
    total: amountOf(draft.totalPriceSet ?? null),
    shippingLine: draft.shippingLine
      ? {
          title: draft.shippingLine.title ?? null,
          custom: draft.shippingLine.custom ?? null,
          amount: amountOf(draft.shippingLine.discountedPriceSet ?? null),
        }
      : null,
    lineItems: (draft.lineItems?.nodes ?? []).map((node) => ({
      title: node.title ?? null,
      quantity: node.quantity ?? null,
      variantId: node.variant?.id ?? null,
    })),
  };
}

export type DraftOrderPocResponseLike = DraftOrderCreateResponse;

/**
 * Creates the test draft order. The access token stays inside the Shopify admin client and is
 * never returned, logged or rendered.
 */
export async function createDeliveryPocDraftOrder(
  admin: AdminApiContext,
  input: DraftOrderPocInput,
): Promise<DraftOrderPocResult> {
  const variables = buildDraftOrderPocVariables(input);
  const response = await admin.graphql(CREATE_DRAFT_ORDER, { variables });
  return parseDraftOrderPocResponse((await response.json()) as DraftOrderCreateResponse);
}
