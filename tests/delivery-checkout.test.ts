import { describe, expect, it, vi } from "vitest";

import {
  CartQuoteError,
  addressFingerprint,
  cartFingerprint,
  parseCartLines,
  parseDeliveryAddress,
  priceCartLines,
} from "../app/services/delivery/cart-quote.server";
import {
  DeliveryDraftOrderError,
  buildDeliveryDraftOrderInput,
  centsToAmount,
  parseDeliveryDraftOrder,
} from "../app/services/delivery/draft-order.server";

const address = {
  firstName: "Test",
  lastName: "Customer",
  address1: "12 Sample Street",
  city: "Mandurah",
  provinceCode: "WA",
  zip: "6210",
  countryCode: "AU",
};

const lines = [
  { variantId: "gid://shopify/ProductVariant/111", quantity: 2 },
  { variantId: "gid://shopify/ProductVariant/222", quantity: 1 },
];

function variantFetch(nodes: unknown) {
  return vi.fn(async () => ({ json: async () => ({ data: { nodes } }) }));
}
const adminWith = (graphql: unknown) => ({ graphql }) as unknown as Parameters<typeof priceCartLines>[0];

describe("cart parsing rejects anything the server should not trust", () => {
  it("accepts variant identity and quantity only", () => {
    expect(parseCartLines([{ variantId: "111", quantity: 2, price: 999999 }])).toEqual([
      { variantId: "gid://shopify/ProductVariant/111", quantity: 2 },
    ]);
  });

  it("drops any client-supplied money from the parsed cart", () => {
    const parsed = parseCartLines([{ variantId: "111", quantity: 1, price: 1, line_price: 1, subtotal: 1 }]);
    expect(JSON.stringify(parsed)).not.toMatch(/price|subtotal/i);
  });

  it("merges duplicate variants and sorts so fingerprints are order-independent", () => {
    const a = parseCartLines([{ variantId: "222", quantity: 1 }, { variantId: "111", quantity: 1 }, { variantId: "111", quantity: 1 }]);
    expect(a).toEqual(lines);
    expect(cartFingerprint(a)).toBe(cartFingerprint(parseCartLines([{ variantId: "111", quantity: 2 }, { variantId: "222", quantity: 1 }])));
  });

  it.each([
    ["a non-array", {}],
    ["an empty cart", []],
    ["a missing variant", [{ quantity: 1 }]],
    ["a non-variant id", [{ variantId: "gid://shopify/Product/1", quantity: 1 }]],
    ["zero quantity", [{ variantId: "111", quantity: 0 }]],
    ["a fractional quantity", [{ variantId: "111", quantity: 1.5 }]],
    ["a negative quantity", [{ variantId: "111", quantity: -1 }]],
    ["an over-large quantity", [{ variantId: "111", quantity: 501 }]],
  ])("rejects %s", (_label, raw) => {
    expect(() => parseCartLines(raw)).toThrow(CartQuoteError);
  });

  it("requires every mandatory address field", () => {
    expect(parseDeliveryAddress({ ...address, provinceCode: "wa", countryCode: "au" })).toMatchObject({ provinceCode: "WA", countryCode: "AU" });
    for (const field of ["firstName", "lastName", "address1", "city", "provinceCode", "zip"]) {
      expect(() => parseDeliveryAddress({ ...address, [field]: "" })).toThrow(CartQuoteError);
    }
  });

  it("fingerprints an address stably but distinguishes real changes", () => {
    expect(addressFingerprint(parseDeliveryAddress(address))).toBe(
      addressFingerprint(parseDeliveryAddress({ ...address, address1: "12  sample  street" })),
    );
    expect(addressFingerprint(parseDeliveryAddress(address))).not.toBe(
      addressFingerprint(parseDeliveryAddress({ ...address, address1: "14 Sample Street" })),
    );
  });
});

describe("subtotal is derived from Shopify prices, never from the client", () => {
  const nodes = [
    { id: lines[0].variantId, title: "Default Title", price: "125.00", availableForSale: true, product: { title: "Lollies", status: "ACTIVE" } },
    { id: lines[1].variantId, title: "Large", price: "0.50", availableForSale: true, product: { title: "Bag", status: "ACTIVE" } },
  ];

  it("multiplies Shopify unit price by quantity", async () => {
    const { subtotalCents, lines: priced } = await priceCartLines(adminWith(variantFetch(nodes)), lines);
    expect(subtotalCents).toBe(125_00 * 2 + 50);
    expect(priced[0]).toMatchObject({ unitPriceCents: 12500, lineTotalCents: 25000, title: "Lollies" });
    expect(priced[1].title).toBe("Bag — Large");
  });

  it("sends only variant ids to Shopify", async () => {
    const graphql = variantFetch(nodes);
    await priceCartLines(adminWith(graphql), lines);
    const [, options] = graphql.mock.calls[0] as unknown as [string, { variables: { ids: string[] } }];
    expect(options.variables.ids).toEqual([lines[0].variantId, lines[1].variantId]);
  });

  it.each([
    ["a missing variant", []],
    ["an unavailable variant", [{ ...nodes[0], availableForSale: false }, nodes[1]]],
    ["an archived product", [{ ...nodes[0], product: { title: "Lollies", status: "ARCHIVED" } }, nodes[1]]],
    ["a non-numeric price", [{ ...nodes[0], price: "free" }, nodes[1]]],
    ["a negative price", [{ ...nodes[0], price: "-1.00" }, nodes[1]]],
  ])("fails closed on %s", async (_label, badNodes) => {
    await expect(priceCartLines(adminWith(variantFetch(badNodes)), lines)).rejects.toThrow(CartQuoteError);
  });

  it("fails closed when Shopify returns errors", async () => {
    const graphql = vi.fn(async () => ({ json: async () => ({ errors: [{ message: "Throttled" }] }) }));
    await expect(priceCartLines(adminWith(graphql), lines)).rejects.toThrow(CartQuoteError);
  });
});

describe("draft order payload", () => {
  const built = buildDeliveryDraftOrderInput({
    customerId: "gid://shopify/Customer/9",
    lines,
    address,
    feeCents: 12300,
    reserveInventoryUntil: new Date("2026-09-11T10:00:00.000Z"),
  }).input;

  it("uses real variant lines and never a delivery-fee product", () => {
    expect(built.lineItems).toEqual([
      { variantId: lines[0].variantId, quantity: 2 },
      { variantId: lines[1].variantId, quantity: 1 },
    ]);
    expect(JSON.stringify(built.lineItems)).not.toMatch(/deliver|shipping|fee/i);
  });

  it("carries the exact fee as a custom shipping line with no rate handle", () => {
    expect(built.shippingLine).toEqual({
      title: "Perth delivery",
      priceWithCurrency: { amount: "123.00", currencyCode: "AUD" },
    });
    expect(built.shippingLine).not.toHaveProperty("shippingRateHandle");
  });

  it("binds the draft to the authenticated customer and validated address", () => {
    expect(built.purchasingEntity).toEqual({ customerId: "gid://shopify/Customer/9" });
    expect(built.shippingAddress).toMatchObject({ address1: "12 Sample Street", provinceCode: "WA", countryCode: "AU", zip: "6210" });
    expect(built.shippingAddress).not.toHaveProperty("country");
  });

  it("reserves inventory for the life of the quote and preserves discount semantics", () => {
    expect(built.reserveInventoryUntil).toBe("2026-09-11T10:00:00.000Z");
    expect(built.acceptAutomaticDiscounts).toBe(true);
    expect(built.allowDiscountCodesInCheckout).toBe(true);
  });

  it("never depends on a carrier service or shipping scope", () => {
    const payload = JSON.stringify(built);
    expect(payload).not.toMatch(/write_shipping|carrierIdentifier|carrierService|shippingRateHandle/i);
  });

  it.each([
    [5000, "50.00"],
    [7500, "75.00"],
    [12000, "120.00"],
    [12300, "123.00"],
    [13800, "138.00"],
  ])("formats %s cents as %s", (cents, amount) => expect(centsToAmount(cents)).toBe(amount));

  it.each([-1, 1.5])("rejects %s cents", (cents) => expect(() => centsToAmount(cents)).toThrow(DeliveryDraftOrderError));
});

describe("draft order response", () => {
  const ok = {
    data: {
      draftOrderCreate: {
        draftOrder: {
          id: "gid://shopify/DraftOrder/1",
          name: "#D1",
          invoiceUrl: "https://shop.example/invoices/abc",
          currencyCode: "AUD",
          subtotalPriceSet: { shopMoney: { amount: "250.00" } },
          totalShippingPriceSet: { shopMoney: { amount: "123.00" } },
          totalPriceSet: { shopMoney: { amount: "373.00" } },
          shippingLine: { custom: true, discountedPriceSet: { shopMoney: { amount: "123.00" } } },
        },
        userErrors: [],
      },
    },
  };

  it("returns the checkout URL and confirms Shopify kept the custom fee", () => {
    const draft = parseDeliveryDraftOrder(ok);
    expect(draft.invoiceUrl).toBe("https://shop.example/invoices/abc");
    expect(draft.shippingLineIsCustom).toBe(true);
    expect(draft.shippingLineCents).toBe(12300);
    expect(draft.subtotalCents).toBe(25000);
    expect(draft.totalCents).toBe(37300);
  });

  it.each([
    ["transport errors", { errors: [{ message: "Throttled" }] }],
    ["user errors", { data: { draftOrderCreate: { draftOrder: null, userErrors: [{ message: "Variant not found" }] } } }],
    ["a missing draft", { data: { draftOrderCreate: { draftOrder: null, userErrors: [] } } }],
    ["a draft with no invoice URL", { data: { draftOrderCreate: { draftOrder: { id: "gid://shopify/DraftOrder/1" }, userErrors: [] } } }],
  ])("fails closed on %s", (_label, body) => {
    expect(() => parseDeliveryDraftOrder(body)).toThrow(DeliveryDraftOrderError);
  });
});
