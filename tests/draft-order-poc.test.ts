import { describe, expect, it, vi } from "vitest";

import type { DraftOrderPocInput } from "../app/services/delivery/draft-order-poc.server";
import {
  DraftOrderPocError,
  POC_DRAFT_NOTE,
  POC_DRAFT_TAG,
  buildDraftOrderPocVariables,
  createDeliveryPocDraftOrder,
  parseDraftOrderPocResponse,
} from "../app/services/delivery/draft-order-poc.server";

const input: DraftOrderPocInput = {
  variantId: "gid://shopify/ProductVariant/123456789",
  quantity: 2,
  shippingTitle: "Perth delivery (TEST)",
  shippingAmount: "75.00",
  email: "test.customer@example.com",
  address: {
    firstName: "Test",
    lastName: "Customer",
    address1: "12 Sample Street",
    city: "Mandurah",
    provinceCode: "wa",
    zip: "6210",
    countryCode: "au",
  },
};

const money = (amount: string) => ({ shopMoney: { amount, currencyCode: "AUD" } });

const successBody = {
  data: {
    draftOrderCreate: {
      draftOrder: {
        id: "gid://shopify/DraftOrder/987",
        name: "#D1",
        invoiceUrl: "https://example.myshopify.com/12345/invoices/abc",
        ready: true,
        status: "OPEN",
        currencyCode: "AUD",
        subtotalPriceSet: money("300.00"),
        totalShippingPriceSet: money("75.00"),
        totalPriceSet: money("375.00"),
        shippingLine: { title: "Perth delivery (TEST)", custom: true, discountedPriceSet: money("75.00") },
        lineItems: { nodes: [{ title: "Assorted lollies", quantity: 2, variant: { id: input.variantId } }] },
      },
      userErrors: [],
    },
  },
};

describe("draft order POC — request shape", () => {
  const { input: variables } = buildDraftOrderPocVariables(input);

  it("sends the real variant and quantity as a line item", () => {
    expect(variables.lineItems).toEqual([{ variantId: input.variantId, quantity: 2 }]);
  });

  it("sends a custom shipping line priced by us, with no shippingRateHandle", () => {
    expect(variables.shippingLine).toEqual({
      title: "Perth delivery (TEST)",
      priceWithCurrency: { amount: "75.00", currencyCode: "AUD" },
    });
    // Omitting shippingRateHandle is what makes the line custom rather than carrier-supplied.
    expect(variables.shippingLine).not.toHaveProperty("shippingRateHandle");
  });

  it("normalises the address to the non-deprecated code fields", () => {
    expect(variables.shippingAddress).toMatchObject({
      address1: "12 Sample Street",
      city: "Mandurah",
      provinceCode: "WA",
      countryCode: "AU",
      zip: "6210",
    });
    expect(variables.shippingAddress).not.toHaveProperty("province");
    expect(variables.shippingAddress).not.toHaveProperty("country");
  });

  it("omits optional fields that were not supplied", () => {
    const { input: minimal } = buildDraftOrderPocVariables({ ...input, email: undefined, address: { ...input.address, address2: undefined, phone: undefined } });
    expect(minimal).not.toHaveProperty("email");
    expect(minimal.shippingAddress).not.toHaveProperty("address2");
    expect(minimal.shippingAddress).not.toHaveProperty("phone");
  });

  it("marks every draft as test data", () => {
    expect(variables.tags).toEqual([POC_DRAFT_TAG]);
    expect(variables.note).toBe(POC_DRAFT_NOTE);
    expect(POC_DRAFT_NOTE).toMatch(/TEST/);
  });

  it("never requests order completion or payment", () => {
    expect(JSON.stringify(variables)).not.toMatch(/complete|payment|paid|capture/i);
  });

  it.each([
    ["a non-GID variant", { variantId: "123456789" }],
    ["a product GID instead of a variant GID", { variantId: "gid://shopify/Product/123" }],
    ["zero quantity", { quantity: 0 }],
    ["a fractional quantity", { quantity: 1.5 }],
    ["a quantity over the cap", { quantity: 101 }],
    ["a non-numeric amount", { shippingAmount: "seventy five" }],
    ["a negative amount", { shippingAmount: "-75.00" }],
    ["three decimal places", { shippingAmount: "75.000" }],
    ["an empty shipping title", { shippingTitle: "  " }],
  ])("rejects %s", (_label, override) => {
    expect(() => buildDraftOrderPocVariables({ ...input, ...override })).toThrow(DraftOrderPocError);
  });

  it.each(["firstName", "lastName", "address1", "city", "provinceCode", "zip", "countryCode"] as const)(
    "rejects a test address missing %s",
    (field) => {
      expect(() => buildDraftOrderPocVariables({ ...input, address: { ...input.address, [field]: "" } })).toThrow(DraftOrderPocError);
    },
  );
});

describe("draft order POC — response handling", () => {
  it("returns the identifiers and amounts the manual test needs", () => {
    expect(parseDraftOrderPocResponse(successBody)).toEqual({
      id: "gid://shopify/DraftOrder/987",
      name: "#D1",
      invoiceUrl: "https://example.myshopify.com/12345/invoices/abc",
      ready: true,
      status: "OPEN",
      currencyCode: "AUD",
      subtotal: "300.00",
      shipping: "75.00",
      total: "375.00",
      shippingLine: { title: "Perth delivery (TEST)", custom: true, amount: "75.00" },
      lineItems: [{ title: "Assorted lollies", quantity: 2, variantId: input.variantId }],
    });
  });

  it("confirms Shopify treated the shipping line as custom at the quoted amount", () => {
    const parsed = parseDraftOrderPocResponse(successBody);
    expect(parsed.shippingLine?.custom).toBe(true);
    expect(parsed.shippingLine?.amount).toBe("75.00");
    expect(parsed.shipping).toBe("75.00");
  });

  it.each([
    ["transport errors", { errors: [{ message: "Throttled" }] }],
    ["user errors", { data: { draftOrderCreate: { draftOrder: null, userErrors: [{ field: ["input"], message: "Variant not found" }] } } }],
    ["a missing draft order", { data: { draftOrderCreate: { draftOrder: null, userErrors: [] } } }],
    ["an empty body", {}],
  ])("throws on %s", (_label, body) => {
    expect(() => parseDraftOrderPocResponse(body)).toThrow(DraftOrderPocError);
  });

  it("surfaces the Shopify user error text", () => {
    expect(() =>
      parseDraftOrderPocResponse({ data: { draftOrderCreate: { draftOrder: null, userErrors: [{ message: "Variant not found" }] } } }),
    ).toThrow(/Variant not found/);
  });

  it("tolerates a draft with no shipping line or line items", () => {
    const parsed = parseDraftOrderPocResponse({
      data: { draftOrderCreate: { draftOrder: { id: "gid://shopify/DraftOrder/1" }, userErrors: [] } },
    });
    expect(parsed.shippingLine).toBeNull();
    expect(parsed.lineItems).toEqual([]);
    expect(parsed.invoiceUrl).toBeNull();
  });
});

describe("draft order POC — admin call", () => {
  it("posts the mutation through the admin client and returns the parsed draft", async () => {
    const graphql = vi.fn(async () => ({ json: async () => successBody }));
    const admin = { graphql } as unknown as Parameters<typeof createDeliveryPocDraftOrder>[0];

    const draft = await createDeliveryPocDraftOrder(admin, input);
    expect(draft.id).toBe("gid://shopify/DraftOrder/987");

    const [query, options] = graphql.mock.calls[0] as unknown as [string, { variables: Record<string, unknown> }];
    expect(query).toContain("draftOrderCreate");
    expect(query).toContain("invoiceUrl");
    expect(options.variables).toEqual(buildDraftOrderPocVariables(input));
    // No credential is passed by us — the admin client holds the token.
    expect(JSON.stringify(options)).not.toMatch(/shpat_|accessToken|Authorization/i);
  });

  it("does not call Shopify when the input is invalid", async () => {
    const graphql = vi.fn();
    const admin = { graphql } as unknown as Parameters<typeof createDeliveryPocDraftOrder>[0];

    await expect(createDeliveryPocDraftOrder(admin, { ...input, variantId: "nope" })).rejects.toThrow(DraftOrderPocError);
    expect(graphql).not.toHaveBeenCalled();
  });
});
