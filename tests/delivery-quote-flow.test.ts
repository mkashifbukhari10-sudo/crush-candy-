import { beforeEach, describe, expect, it, vi } from "vitest";

const quoteStore = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const auditLog = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const settingsMock = vi.hoisted(() => vi.fn());
const logLines = vi.hoisted(() => [] as string[]);
let nextId = 0;

vi.mock("../app/db.server", () => ({
  default: {
    deliveryQuote: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const id = `quote-${++nextId}`;
        quoteStore.set(id, { id, status: "ACTIVE", consumedAt: null, draftOrderId: null, ...data });
        return { id };
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const row = quoteStore.get(String(where.id));
        if (!row) return null;
        const matches = ["shopifyCustomerId", "shop"].every((key) => where[key] === undefined || row[key] === where[key]);
        return matches ? { ...row } : null;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const row = quoteStore.get(String(where.id));
        if (!row) return { count: 0 };
        if (where.status !== undefined && row.status !== where.status) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        Object.assign(quoteStore.get(where.id) ?? {}, data);
        return {};
      },
    },
    auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => void auditLog.push(data) },
  },
}));

vi.mock("../app/services/delivery.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../app/services/delivery.server")>()),
  getDeliverySettings: settingsMock,
}));

const { confirmDeliveryQuote, createDeliveryQuote, DeliveryCheckoutError } = await import(
  "../app/services/delivery/delivery-checkout.server"
);

const settings = {
  deliveryEnabled: true,
  minDeliverySpendCents: 25000,
  distanceMethod: "DRIVING" as const,
  kmRoundingMode: "CEIL" as const,
  tierUnder25Cents: 5000,
  tier25To40Cents: 7500,
  tier40To55Cents: 12000,
  over55BaseCents: 12000,
  over55PerKmCents: 300,
  baseLatitude: null,
  baseLongitude: null,
};

const address = {
  firstName: "Test",
  lastName: "Customer",
  address1: "12 Sample Street",
  city: "Mandurah",
  provinceCode: "WA",
  zip: "6210",
  countryCode: "AU",
};
const lines = [{ variantId: "gid://shopify/ProductVariant/111", quantity: 2 }];
const CUSTOMER = "gid://shopify/Customer/9";
const SHOP = "shop.myshopify.com";

const providerEnvironment = {
  DISTANCE_PROVIDER: "google",
  DISTANCE_API_KEY: "test-key",
  DELIVERY_ORIGIN_LATITUDE: "-31.25",
  DELIVERY_ORIGIN_LONGITUDE: "115.75",
};

/** Prices the cart at AUD $250 unless told otherwise. */
function admin(unitPrice = "125.00", draftResponse?: unknown) {
  const graphql = vi.fn(async (query: string) => {
    if (query.includes("DeliveryCartVariantPrices")) {
      return {
        json: async () => ({
          data: { nodes: [{ id: lines[0].variantId, title: "Default Title", price: unitPrice, availableForSale: true, product: { title: "Lollies", status: "ACTIVE" } }] },
        }),
      };
    }
    return { json: async () => draftResponse ?? draftOk("123.00") };
  });
  return { admin: { graphql } as never, graphql };
}

const draftOk = (shipping: string) => ({
  data: {
    draftOrderCreate: {
      draftOrder: {
        id: "gid://shopify/DraftOrder/1",
        name: "#D1",
        invoiceUrl: "https://shop.example/invoices/SECRET-TOKEN",
        currencyCode: "AUD",
        subtotalPriceSet: { shopMoney: { amount: "250.00" } },
        totalShippingPriceSet: { shopMoney: { amount: shipping } },
        totalPriceSet: { shopMoney: { amount: "373.00" } },
        shippingLine: { custom: true, discountedPriceSet: { shopMoney: { amount: shipping } } },
      },
      userErrors: [],
    },
  },
});

const distanceFetch = (meters: number) =>
  vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => [{ originIndex: 0, destinationIndex: 0, distanceMeters: meters, condition: "ROUTE_EXISTS", status: {} }],
  }) as unknown as Response);

const deps = (meters: number) => ({ distance: { environment: providerEnvironment, fetchImpl: distanceFetch(meters), cache: null } });

const quote = (adminCtx: never, meters: number, overrides: Partial<{ lines: typeof lines }> = {}) =>
  createDeliveryQuote(adminCtx, { shop: SHOP, customerId: CUSTOMER, lines: overrides.lines ?? lines, address }, deps(meters));

beforeEach(() => {
  quoteStore.clear();
  auditLog.length = 0;
  logLines.length = 0;
  settingsMock.mockReset();
  settingsMock.mockResolvedValue(settings);
  for (const level of ["info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logLines.push(args.map(String).join(" ")));
  }
});

describe("quote — locked pricing bands from real driving distance", () => {
  it.each([
    ["under 25 km", 24_990, 5000],
    ["25 to 40 km", 32_000, 7500],
    ["over 40 up to 55 km", 47_500, 12000],
    ["55.1 km rounds the extra kilometre up", 55_100, 12300],
    ["60.2 km", 60_200, 13800],
  ])("prices %s at %s cents", async (_label, meters, feeCents) => {
    const { admin: ctx } = admin();
    const outcome = await quote(ctx, meters);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.quote.feeCents).toBe(feeCents);
    expect(outcome.quote.subtotalCents).toBe(25000);
    expect(outcome.quote.totalCents).toBe(25000 + feeCents);
  });

  it("blocks below the AUD $250 minimum without calling the distance provider", async () => {
    const fetchImpl = distanceFetch(30_000);
    const { admin: ctx } = admin("124.99");
    const outcome = await createDeliveryQuote(
      ctx,
      { shop: SHOP, customerId: CUSTOMER, lines, address },
      { distance: { environment: providerEnvironment, fetchImpl, cache: null } },
    );
    expect(outcome).toMatchObject({ ok: false, reason: "MINIMUM_ORDER", subtotalCents: 24998, minimumOrderCents: 25000 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when the distance provider fails", async () => {
    const { admin: ctx } = admin();
    const failing = vi.fn(async () => {
      const abort = new Error("aborted");
      abort.name = "AbortError";
      throw abort;
    });
    const outcome = await createDeliveryQuote(
      ctx,
      { shop: SHOP, customerId: CUSTOMER, lines, address },
      { distance: { environment: providerEnvironment, fetchImpl: failing as unknown as typeof fetch, cache: null } },
    );
    expect(outcome).toMatchObject({ ok: false, reason: "DISTANCE_UNAVAILABLE" });
  });

  it("blocks when delivery is disabled or distance is unconfigured", async () => {
    const { admin: ctx } = admin();
    settingsMock.mockResolvedValue({ ...settings, deliveryEnabled: false });
    expect(await quote(ctx, 30_000)).toMatchObject({ ok: false, reason: "DELIVERY_DISABLED" });

    settingsMock.mockResolvedValue({ ...settings, distanceMethod: "STRAIGHT_LINE" });
    expect(await quote(ctx, 30_000)).toMatchObject({ ok: false, reason: "UNCONFIGURED_DISTANCE" });
  });
});

describe("confirm — revalidation before the draft order is created", () => {
  const confirm = (ctx: never, quoteId: string, overrides: Partial<{ lines: typeof lines; address: typeof address }> = {}) =>
    confirmDeliveryQuote(ctx, {
      shop: SHOP,
      customerId: CUSTOMER,
      quoteId,
      lines: overrides.lines ?? lines,
      address: overrides.address ?? address,
    });

  async function quoted(meters = 55_100, unitPrice = "125.00") {
    const built = admin(unitPrice);
    const outcome = await quote(built.admin, meters);
    if (!outcome.ok) throw new Error("expected a quote");
    return { ...built, quoteId: outcome.quote.quoteId, fee: outcome.quote.feeCents };
  }

  it("creates the draft and returns the checkout URL on the happy path", async () => {
    const { admin: ctx, quoteId, fee } = await quoted();
    expect(fee).toBe(12300);
    const result = await confirm(ctx, quoteId);
    expect(result.invoiceUrl).toBe("https://shop.example/invoices/SECRET-TOKEN");
    expect(result.draftOrderId).toBe("gid://shopify/DraftOrder/1");
  });

  it("sends the exact quoted fee as the custom shipping line", async () => {
    const { admin: ctx, graphql, quoteId } = await quoted();
    await confirm(ctx, quoteId);
    const calls = graphql.mock.calls as unknown as Array<[string, { variables: { input: Record<string, unknown> } }]>;
    const draftCall = calls.find(([query]) => String(query).includes("CreateDeliveryDraftOrder"));
    const variables = draftCall![1].variables.input;
    expect(variables.shippingLine).toEqual({ title: "Perth delivery", priceWithCurrency: { amount: "123.00", currencyCode: "AUD" } });
    expect(variables.lineItems).toEqual([{ variantId: lines[0].variantId, quantity: 2 }]);
  });

  it("rejects a cart changed after the quote", async () => {
    const { admin: ctx, quoteId } = await quoted();
    await expect(confirm(ctx, quoteId, { lines: [{ ...lines[0], quantity: 3 }] })).rejects.toMatchObject({ reason: "CART_CHANGED" });
  });

  it("rejects an address changed after the quote", async () => {
    const { admin: ctx, quoteId } = await quoted();
    await expect(confirm(ctx, quoteId, { address: { ...address, address1: "99 Other Street" } })).rejects.toMatchObject({ reason: "ADDRESS_CHANGED" });
  });

  it("rejects an expired quote", async () => {
    const { admin: ctx, quoteId } = await quoted();
    (quoteStore.get(quoteId) as { expiresAt: Date }).expiresAt = new Date(Date.now() - 1000);
    await expect(confirm(ctx, quoteId)).rejects.toMatchObject({ reason: "QUOTE_EXPIRED" });
  });

  it("rejects an unknown quote and one belonging to another customer", async () => {
    const { admin: ctx, quoteId } = await quoted();
    await expect(confirm(ctx, "quote-does-not-exist")).rejects.toMatchObject({ reason: "QUOTE_NOT_FOUND" });
    await expect(
      confirmDeliveryQuote(ctx, { shop: SHOP, customerId: "gid://shopify/Customer/999", quoteId, lines, address }),
    ).rejects.toMatchObject({ reason: "QUOTE_NOT_FOUND" });
  });

  it("rejects when Shopify prices moved between quote and confirm", async () => {
    const { quoteId } = await quoted();
    const { admin: repriced } = admin("130.00");
    await expect(confirm(repriced, quoteId)).rejects.toMatchObject({ reason: "REPRICED" });
  });

  it("creates only one draft order for a duplicated submission", async () => {
    const { admin: ctx, graphql, quoteId } = await quoted();
    const [first, second] = await Promise.allSettled([confirm(ctx, quoteId), confirm(ctx, quoteId)]);

    const fulfilled = [first, second].filter((r) => r.status === "fulfilled");
    const rejected = [first, second].filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(DeliveryCheckoutError);

    const draftCalls = graphql.mock.calls.filter(([query]) => String(query).includes("CreateDeliveryDraftOrder"));
    expect(draftCalls).toHaveLength(1);
  });

  it("releases the quote when draft creation fails so the customer can retry", async () => {
    const { quoteId } = await quoted();
    const failing = admin("125.00", { data: { draftOrderCreate: { draftOrder: null, userErrors: [{ message: "nope" }] } } });
    await expect(confirm(failing.admin, quoteId)).rejects.toMatchObject({ reason: "DRAFT_FAILED" });
    expect(quoteStore.get(quoteId)?.status).toBe("ACTIVE");

    const retry = admin();
    await expect(confirm(retry.admin, quoteId)).resolves.toMatchObject({ draftOrderId: "gid://shopify/DraftOrder/1" });
  });
});

describe("audit and logging never leak sensitive data", () => {
  it("audits the draft creation with amounts and identifiers only", async () => {
    const built = admin();
    const outcome = await quote(built.admin, 55_100);
    if (!outcome.ok) throw new Error("expected a quote");
    await confirmDeliveryQuote(built.admin, { shop: SHOP, customerId: CUSTOMER, quoteId: outcome.quote.quoteId, lines, address });

    const entry = auditLog.find((row) => row.action === "DELIVERY_DRAFT_ORDER_CREATED");
    expect(entry).toBeTruthy();
    expect(entry?.payload).toMatchObject({ feeCents: 12300, subtotalCents: 25000 });

    const serialised = JSON.stringify(auditLog);
    expect(serialised).not.toContain("SECRET-TOKEN");
    expect(serialised).not.toContain("12 Sample Street");
    expect(serialised).not.toContain("test-key");
  });

  it("keeps the invoice URL, address, origin and API key out of the logs", async () => {
    const built = admin();
    const outcome = await quote(built.admin, 55_100);
    if (!outcome.ok) throw new Error("expected a quote");
    await confirmDeliveryQuote(built.admin, { shop: SHOP, customerId: CUSTOMER, quoteId: outcome.quote.quoteId, lines, address });

    const logged = logLines.join("\n");
    expect(logged).toContain("delivery.draft.created");
    expect(logged).not.toContain("SECRET-TOKEN");
    expect(logged).not.toContain("invoices/");
    expect(logged).not.toContain("12 Sample Street");
    expect(logged).not.toContain("test-key");
    expect(logged).not.toContain("115.75");
    expect(logged).not.toContain("31.25");
  });
});
