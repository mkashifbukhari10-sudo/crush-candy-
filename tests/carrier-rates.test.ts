import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "carrier-callback-test-secret";

vi.mock("../app/db.server", () => ({ default: {} }));
vi.mock("../app/config/env.server", () => ({
  getServerEnvironment: () => ({ SHOPIFY_API_SECRET: SECRET }),
}));

const settingsMock = vi.hoisted(() => vi.fn());
vi.mock("../app/services/delivery.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../app/services/delivery.server")>()),
  getDeliverySettings: settingsMock,
}));

const { action, cartSubtotalCents } = await import("../app/routes/api.carrier.rates");
import type { DistanceLookupDeps } from "../app/services/delivery/distance-provider.server";

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

const destination = {
  address1: "12 Sample Street",
  city: "Mandurah",
  province: "WA",
  postal_code: "6210",
  country: "AU",
};

const providerEnvironment = {
  DISTANCE_PROVIDER: "google",
  DISTANCE_API_KEY: "test-key",
  DELIVERY_ORIGIN_LATITUDE: "-31.25",
  DELIVERY_ORIGIN_LONGITUDE: "115.75",
};

function matrixFetch(distanceMeters: number) {
  return vi.fn(async () =>
    ({
      ok: true,
      status: 200,
      json: async () => [
        { originIndex: 0, destinationIndex: 0, distanceMeters, condition: "ROUTE_EXISTS", status: {} },
      ],
    }) as unknown as Response,
  );
}

function carrierRequest(body: unknown, signature?: string) {
  const raw = JSON.stringify(body);
  return new Request("https://crush-candy-production.up.railway.app/api/carrier/rates", {
    method: "POST",
    body: raw,
    headers: {
      "content-type": "application/json",
      "x-shopify-hmac-sha256": signature ?? createHmac("sha256", SECRET).update(raw).digest("base64"),
    },
  });
}

async function callRates(body: unknown, deps: DistanceLookupDeps, signature?: string) {
  const request = carrierRequest(body, signature);
  const args = {
    request,
    params: {},
    context: {} as never,
    url: new URL(request.url),
    pattern: "/api/carrier/rates",
  } as unknown as Parameters<typeof action>[0];
  const response = await action(args, { cache: null, ...deps });
  return { response, json: (await response.json()) as { rates: unknown[] } };
}

/** One line item exactly as Shopify sends it: price already in subunits, no dollar amounts. */
const item = (priceCents: unknown, quantity: unknown = 1) => ({
  name: "Assorted lollies",
  sku: "LOL-1",
  quantity,
  grams: 1000,
  price: priceCents,
  vendor: "Crush Candy Supplies",
  requires_shipping: true,
  taxable: true,
  fulfillment_service: "manual",
  properties: null,
  product_id: 48447225880,
  variant_id: 258644705304,
});

/** Shopify's documented callback body: rate carries origin, destination, items, currency, locale. */
const cart = (items: unknown, dest: unknown = destination) => ({
  rate: {
    origin: { country: "AU", postal_code: "6061", province: "WA", city: "Perth", address1: "Base" },
    destination: dest,
    items,
    currency: "AUD",
    locale: "en",
  },
});

const CART_250 = [item(25_000)];

beforeEach(() => {
  settingsMock.mockReset();
  settingsMock.mockResolvedValue(settings);
});

describe("M6 carrier rate callback", () => {
  it.each([
    ["under 25 km", 24_990, "5000"],
    ["25 to 40 km", 32_000, "7500"],
    ["over 40 up to 55 km", 47_500, "12000"],
    ["55.1 km rounds the extra kilometre up", 55_100, "12300"],
    ["60.2 km", 60_200, "13800"],
  ])("quotes %s from real provider distance", async (_label, meters, expected) => {
    const fetchImpl = matrixFetch(meters);
    const { json } = await callRates(cart(CART_250), { environment: providerEnvironment, fetchImpl });

    expect(json.rates).toEqual([
      {
        service_name: "Perth delivery",
        service_code: "CCS-PERTH",
        total_price: expected,
        currency: "AUD",
        description: "Calculated delivery",
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sends the full destination address to the provider", async () => {
    const fetchImpl = matrixFetch(30_000);
    await callRates(cart(CART_250), { environment: providerEnvironment, fetchImpl });

    const sent = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(sent.destinations[0].waypoint.address).toBe("12 Sample Street, Mandurah, WA, 6210, AU");
    expect(sent.travelMode).toBe("DRIVE");
  });

  it("rejects an invalid HMAC signature without calling the provider", async () => {
    const fetchImpl = matrixFetch(30_000);
    const { response, json } = await callRates(cart(CART_250), { environment: providerEnvironment, fetchImpl }, "not-a-signature");

    expect(response.status).toBe(401);
    expect(json.rates).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns no rate below the AUD $250 minimum without a billable provider call", async () => {
    const fetchImpl = matrixFetch(30_000);
    const { json } = await callRates(cart([item(24_999)]), { environment: providerEnvironment, fetchImpl });

    expect(json.rates).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["delivery disabled", { deliveryEnabled: false }],
    ["distance method unset", { distanceMethod: null }],
    ["straight line configured", { distanceMethod: "STRAIGHT_LINE" as const }],
    ["rounding unset", { kmRoundingMode: null }],
  ])("returns no rate when %s", async (_label, override) => {
    settingsMock.mockResolvedValue({ ...settings, ...override });
    const fetchImpl = matrixFetch(30_000);
    const { json } = await callRates(cart(CART_250), { environment: providerEnvironment, fetchImpl });

    expect(json.rates).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [
      "provider timeout",
      vi.fn(async () => {
        const abort = new Error("aborted");
        abort.name = "AbortError";
        throw abort;
      }),
    ],
    [
      "no route",
      vi.fn(async () =>
        ({ ok: true, status: 200, json: async () => [{ condition: "ROUTE_NOT_FOUND", status: {} }] }) as unknown as Response,
      ),
    ],
    [
      "provider HTTP error",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response),
    ],
    [
      "malformed provider response",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ rows: [] }) }) as unknown as Response),
    ],
  ])("fails closed on %s", async (_label, fetchImpl) => {
    const { response, json } = await callRates(cart(CART_250), {
      environment: providerEnvironment,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(response.status).toBe(200);
    expect(json.rates).toEqual([]);
  });

  it("fails closed when the provider or origin is unconfigured", async () => {
    for (const environment of [
      {},
      { DISTANCE_PROVIDER: "google" },
      { DISTANCE_PROVIDER: "google", DISTANCE_API_KEY: "k" },
      { ...providerEnvironment, DELIVERY_ORIGIN_LATITUDE: "not-a-number" },
    ]) {
      const fetchImpl = matrixFetch(30_000);
      const { json } = await callRates(cart(CART_250), { environment, fetchImpl });
      expect(json.rates).toEqual([]);
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("fails closed on an unusable destination or body", async () => {
    const fetchImpl = matrixFetch(30_000);
    for (const body of [cart(CART_250, { city: "Perth", country: "AU" }), cart(CART_250, null), {}]) {
      const { json } = await callRates(body, { environment: providerEnvironment, fetchImpl });
      expect(json.rates).toEqual([]);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never returns locational data or a straight-line estimate", async () => {
    const fetchImpl = matrixFetch(32_000);
    const { response, json } = await callRates(cart(CART_250), { environment: providerEnvironment, fetchImpl });

    const body = JSON.stringify(json);
    expect(body).not.toContain("31.25");
    expect(body).not.toContain("115.75");
    expect(body).not.toContain("test-key");
    expect(body).not.toContain("6210");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("M6 carrier cart subtotal", () => {
  it("sums a single line item without currency conversion", () => {
    expect(cartSubtotalCents([item(25_000)])).toBe(25_000);
  });

  it("sums multiple line items", () => {
    expect(cartSubtotalCents([item(10_000), item(9_999), item(5_001)])).toBe(25_000);
  });

  it("multiplies price by quantity", () => {
    expect(cartSubtotalCents([item(5_000, 5)])).toBe(25_000);
    expect(cartSubtotalCents([item(12_500, 2), item(3_000, 3)])).toBe(34_000);
  });

  it("treats an empty cart as a zero subtotal", () => {
    expect(cartSubtotalCents([])).toBe(0);
  });

  it("ignores zero-quantity lines rather than rejecting them", () => {
    expect(cartSubtotalCents([item(25_000), item(9_900, 0)])).toBe(25_000);
  });

  it("accepts numeric strings, which some payload versions send", () => {
    expect(cartSubtotalCents([item("25000", "2")])).toBe(50_000);
  });

  it.each([
    ["a missing items array", undefined],
    ["a non-array items value", { "0": item(25_000) }],
    ["a null line", [item(25_000), null]],
    ["a non-object line", [item(25_000), "25000"]],
    ["a missing price", [{ quantity: 1 }]],
    ["a null price", [item(null)]],
    ["a non-numeric price", [item("free")]],
    ["a NaN price", [item(Number.NaN)]],
    ["an infinite price", [item(Number.POSITIVE_INFINITY)]],
    ["a negative price", [item(-25_000)]],
    ["a missing quantity", [{ price: 25_000 }]],
    ["a non-numeric quantity", [item(25_000, "many")]],
    ["a fractional quantity", [item(25_000, 1.5)]],
    ["a negative quantity", [item(25_000, -1)]],
    ["one bad line among good ones", [item(25_000), item(10_000, "x")]],
  ])("rejects %s rather than guessing a subtotal", (_label, items) => {
    expect(cartSubtotalCents(items)).toBeNull();
  });
});

describe("M6 carrier callback subtotal gating", () => {
  const quote = async (items: unknown) => {
    const fetchImpl = matrixFetch(30_000);
    const { json } = await callRates(cart(items), { environment: providerEnvironment, fetchImpl });
    return { rates: json.rates, calls: fetchImpl.mock.calls.length };
  };

  it("quotes a cart of exactly AUD $250", async () => {
    const { rates, calls } = await quote([item(25_000)]);
    expect(rates).toHaveLength(1);
    expect(calls).toBe(1);
  });

  it("quotes a cart above AUD $250 assembled from several lines", async () => {
    const { rates, calls } = await quote([item(9_000, 2), item(4_000), item(3_500)]);
    expect(rates).toEqual([
      {
        service_name: "Perth delivery",
        service_code: "CCS-PERTH",
        total_price: "7500",
        currency: "AUD",
        description: "Calculated delivery",
      },
    ]);
    expect(calls).toBe(1);
  });

  it.each([
    ["one cent below the minimum", [item(24_999)]],
    ["a quantity that lands below the minimum", [item(8_333, 3)]],
    ["an empty cart", []],
  ])("returns no rate and skips the billable provider call for %s", async (_label, items) => {
    const { rates, calls } = await quote(items);
    expect(rates).toEqual([]);
    expect(calls).toBe(0);
  });

  it.each([
    ["a malformed price", [item("free")]],
    ["a malformed quantity", [item(25_000, "many")]],
    ["a missing items array", undefined],
  ])("fails closed on %s without calling the provider", async (_label, items) => {
    const { rates, calls } = await quote(items);
    expect(rates).toEqual([]);
    expect(calls).toBe(0);
  });

  it("never reads a rate.price field, which Shopify does not send", async () => {
    const fetchImpl = matrixFetch(30_000);
    const body = cart([item(24_999)]);
    // A large rate.price must not rescue a cart whose real line items fall short.
    (body.rate as Record<string, unknown>).price = 999;
    const { json } = await callRates(body, { environment: providerEnvironment, fetchImpl });

    expect(json.rates).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
