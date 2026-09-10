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

const { action } = await import("../app/routes/api.carrier.rates");
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

const cart = (priceDollars: number, dest: unknown = destination) => ({
  rate: { price: priceDollars, destination: dest, currency: "AUD" },
});

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
    const { json } = await callRates(cart(250), { environment: providerEnvironment, fetchImpl });

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
    await callRates(cart(250), { environment: providerEnvironment, fetchImpl });

    const sent = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(sent.destinations[0].waypoint.address).toBe("12 Sample Street, Mandurah, WA, 6210, AU");
    expect(sent.travelMode).toBe("DRIVE");
  });

  it("rejects an invalid HMAC signature without calling the provider", async () => {
    const fetchImpl = matrixFetch(30_000);
    const { response, json } = await callRates(cart(250), { environment: providerEnvironment, fetchImpl }, "not-a-signature");

    expect(response.status).toBe(401);
    expect(json.rates).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns no rate below the AUD $250 minimum without a billable provider call", async () => {
    const fetchImpl = matrixFetch(30_000);
    const { json } = await callRates(cart(249.99), { environment: providerEnvironment, fetchImpl });

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
    const { json } = await callRates(cart(250), { environment: providerEnvironment, fetchImpl });

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
    const { response, json } = await callRates(cart(250), {
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
      const { json } = await callRates(cart(250), { environment, fetchImpl });
      expect(json.rates).toEqual([]);
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("fails closed on an unusable destination or body", async () => {
    const fetchImpl = matrixFetch(30_000);
    for (const body of [cart(250, { city: "Perth", country: "AU" }), cart(250, null), {}]) {
      const { json } = await callRates(body, { environment: providerEnvironment, fetchImpl });
      expect(json.rates).toEqual([]);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never returns locational data or a straight-line estimate", async () => {
    const fetchImpl = matrixFetch(32_000);
    const { response, json } = await callRates(cart(250), { environment: providerEnvironment, fetchImpl });

    const body = JSON.stringify(json);
    expect(body).not.toContain("31.25");
    expect(body).not.toContain("115.75");
    expect(body).not.toContain("test-key");
    expect(body).not.toContain("6210");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
