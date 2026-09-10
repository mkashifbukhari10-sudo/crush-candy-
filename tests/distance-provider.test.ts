import { describe, expect, it, vi } from "vitest";

import {
  DistanceProviderError,
  buildDestinationAddress,
  buildDestinationKey,
  fetchDrivingDistanceKm,
  getDrivingDistanceKm,
  normalizeDestinationAddress,
  resolveDistanceProviderConfig,
} from "../app/services/delivery/distance-provider.server";

const environment = {
  DISTANCE_PROVIDER: "google",
  DISTANCE_API_KEY: "test-key",
  DELIVERY_ORIGIN_LATITUDE: "-31.25",
  DELIVERY_ORIGIN_LONGITUDE: "115.75",
};
const config = resolveDistanceProviderConfig(environment);

const destination = {
  address1: "12 Sample Street",
  address2: "Unit 4",
  city: "Mandurah",
  province: "WA",
  postal_code: "6210",
  country: "AU",
};

function matrixResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return vi.fn(async () =>
    ({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => body,
    }) as unknown as Response,
  );
}

async function expectReason(promise: Promise<unknown>, reason: string) {
  await expect(promise).rejects.toMatchObject({ name: "DistanceProviderError", reason });
}

describe("M6 distance provider configuration", () => {
  it("resolves the private origin and credentials", () => {
    expect(config).toEqual({
      provider: "google",
      apiKey: "test-key",
      origin: { latitude: -31.25, longitude: 115.75 },
    });
  });

  it("rejects a missing API key", () => {
    expect(() => resolveDistanceProviderConfig({ ...environment, DISTANCE_API_KEY: undefined })).toThrow(
      DistanceProviderError,
    );
    try {
      resolveDistanceProviderConfig({ ...environment, DISTANCE_API_KEY: undefined });
    } catch (error) {
      expect((error as DistanceProviderError).reason).toBe("PROVIDER_NOT_CONFIGURED");
    }
  });

  it("rejects an unsupported or missing provider", () => {
    for (const provider of [undefined, "", "mapbox"]) {
      try {
        resolveDistanceProviderConfig({ ...environment, DISTANCE_PROVIDER: provider });
        throw new Error("expected rejection");
      } catch (error) {
        expect((error as DistanceProviderError).reason).toBe("PROVIDER_NOT_CONFIGURED");
      }
    }
  });

  it("rejects missing, non-numeric and out-of-range origin coordinates", () => {
    const invalid = [
      { DELIVERY_ORIGIN_LATITUDE: undefined },
      { DELIVERY_ORIGIN_LONGITUDE: undefined },
      { DELIVERY_ORIGIN_LATITUDE: "not-a-number" },
      { DELIVERY_ORIGIN_LATITUDE: "91" },
      { DELIVERY_ORIGIN_LONGITUDE: "181" },
    ];
    for (const override of invalid) {
      try {
        resolveDistanceProviderConfig({ ...environment, ...override });
        throw new Error("expected rejection");
      } catch (error) {
        expect((error as DistanceProviderError).reason).toBe("ORIGIN_NOT_CONFIGURED");
      }
    }
  });
});

describe("M6 destination building", () => {
  it("uses the fullest address available rather than postcode and city alone", () => {
    expect(buildDestinationAddress(destination)).toBe(
      "12 Sample Street, Unit 4, Mandurah, WA, 6210, AU",
    );
  });

  it("skips absent fields and accepts the zip alias", () => {
    expect(buildDestinationAddress({ city: "Perth", zip: "6000", country: "AU" })).toBe(
      "Perth, 6000, AU",
    );
  });

  it("returns null without a postcode so the callback fails closed", () => {
    expect(buildDestinationAddress({ address1: "12 Sample Street", city: "Perth", country: "AU" })).toBeNull();
    expect(buildDestinationAddress({ postal_code: "   " })).toBeNull();
  });

  it("normalises formatting differences onto one cache key", () => {
    expect(normalizeDestinationAddress("12  Sample St., PERTH  WA 6000")).toBe("12 sample st perth wa 6000");
    expect(buildDestinationKey("12 Sample St, Perth WA 6000", config)).toBe(
      buildDestinationKey("12  SAMPLE  ST.,  perth, wa, 6000", config),
    );
  });

  it("keys on the origin so relocating the base invalidates cached distances", () => {
    const moved = resolveDistanceProviderConfig({ ...environment, DELIVERY_ORIGIN_LATITUDE: "-32.0" });
    expect(buildDestinationKey("12 Sample St", config)).not.toBe(buildDestinationKey("12 Sample St", moved));
  });

  it("stores no address material in the key", () => {
    expect(buildDestinationKey("12 Sample St, Perth", config)).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("M6 Google Routes API client", () => {
  it("requests driving distance from the current computeRouteMatrix endpoint", async () => {
    const fetchImpl = matrixResponse([
      { originIndex: 0, destinationIndex: 0, distanceMeters: 32450, condition: "ROUTE_EXISTS", status: {} },
    ]);

    expect(await fetchDrivingDistanceKm("12 Sample St, Perth WA 6000, AU", config, { fetchImpl })).toBe(32.45);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
    expect(url).not.toContain("test-key");

    const sent = JSON.parse(String(init.body));
    expect(sent.travelMode).toBe("DRIVE");
    expect(sent.units).toBe("METRIC");
    expect(sent.origins[0].waypoint.location.latLng).toEqual({ latitude: -31.25, longitude: 115.75 });
    expect(sent.destinations[0].waypoint.address).toBe("12 Sample St, Perth WA 6000, AU");
  });

  it("treats an omitted distanceMeters as zero kilometres", async () => {
    const fetchImpl = matrixResponse([{ condition: "ROUTE_EXISTS", status: {} }]);
    expect(await fetchDrivingDistanceKm("origin address", config, { fetchImpl })).toBe(0);
  });

  it("selects the 0,0 element when the matrix returns several", async () => {
    const fetchImpl = matrixResponse([
      { originIndex: 0, destinationIndex: 1, distanceMeters: 99000, condition: "ROUTE_EXISTS" },
      { originIndex: 0, destinationIndex: 0, distanceMeters: 41000, condition: "ROUTE_EXISTS" },
    ]);
    expect(await fetchDrivingDistanceKm("address", config, { fetchImpl })).toBe(41);
  });

  it("fails closed when no route exists", async () => {
    const fetchImpl = matrixResponse([
      { originIndex: 0, destinationIndex: 0, condition: "ROUTE_NOT_FOUND", status: {} },
    ]);
    await expectReason(fetchDrivingDistanceKm("island address", config, { fetchImpl }), "NO_ROUTE");
  });

  it("fails closed when an element carries an error status", async () => {
    const fetchImpl = matrixResponse([
      { originIndex: 0, destinationIndex: 0, distanceMeters: 100, condition: "ROUTE_EXISTS", status: { code: 3 } },
    ]);
    await expectReason(fetchDrivingDistanceKm("address", config, { fetchImpl }), "NO_ROUTE");
  });

  it("fails closed on a provider HTTP error", async () => {
    const fetchImpl = matrixResponse({ error: {} }, { ok: false, status: 403 });
    await expectReason(fetchDrivingDistanceKm("address", config, { fetchImpl }), "PROVIDER_ERROR");
  });

  it("fails closed on a timeout", async () => {
    const fetchImpl = vi.fn(async () => {
      const abort = new Error("The operation was aborted");
      abort.name = "AbortError";
      throw abort;
    });
    await expectReason(fetchDrivingDistanceKm("address", config, { fetchImpl }), "PROVIDER_TIMEOUT");
  });

  it("aborts the request once the timeout elapses", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const abort = new Error("aborted");
            abort.name = "AbortError";
            reject(abort);
          });
        }),
    ) as unknown as typeof fetch;
    await expectReason(fetchDrivingDistanceKm("address", config, { fetchImpl, timeoutMs: 5 }), "PROVIDER_TIMEOUT");
  });

  it("fails closed on network failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expectReason(fetchDrivingDistanceKm("address", config, { fetchImpl }), "PROVIDER_ERROR");
  });

  it.each([
    ["unparseable body", undefined],
    ["an empty matrix", []],
    ["a non-array payload", { rows: [] }],
    ["a negative distance", [{ condition: "ROUTE_EXISTS", distanceMeters: -5 }]],
  ])("rejects %s", async (_label, body) => {
    const fetchImpl =
      body === undefined
        ? vi.fn(async () =>
            ({
              ok: true,
              status: 200,
              json: async () => {
                throw new SyntaxError("Unexpected token");
              },
            }) as unknown as Response,
          )
        : matrixResponse(body);
    await expectReason(fetchDrivingDistanceKm("address", config, { fetchImpl }), "INVALID_RESPONSE");
  });
});

describe("M6 driving distance lookup", () => {
  it("returns provider distance and caches it", async () => {
    const store = new Map<string, number>();
    const cache = {
      read: vi.fn(async (key: string) => store.get(key) ?? null),
      write: vi.fn(async (key: string, km: number) => void store.set(key, km)),
    };
    const fetchImpl = matrixResponse([
      { originIndex: 0, destinationIndex: 0, distanceMeters: 24990, condition: "ROUTE_EXISTS" },
    ]);

    expect(await getDrivingDistanceKm(destination, { config, fetchImpl, cache })).toBe(24.99);
    expect(cache.write).toHaveBeenCalledTimes(1);

    // Second identical destination is served from cache without a billable call.
    expect(await getDrivingDistanceKm(destination, { config, fetchImpl, cache })).toBe(24.99);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("falls back to a live lookup when the cache faults", async () => {
    const cache = {
      read: vi.fn(async () => {
        throw new Error("cache offline");
      }),
      write: vi.fn(async () => {
        throw new Error("cache offline");
      }),
    };
    const fetchImpl = matrixResponse([
      { originIndex: 0, destinationIndex: 0, distanceMeters: 30000, condition: "ROUTE_EXISTS" },
    ]);
    expect(await getDrivingDistanceKm(destination, { config, fetchImpl, cache })).toBe(30);
  });

  it("rejects an incomplete destination before calling the provider", async () => {
    const fetchImpl = matrixResponse([]);
    await expectReason(
      getDrivingDistanceKm({ city: "Perth", country: "AU" }, { config, fetchImpl, cache: null }),
      "DESTINATION_INCOMPLETE",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects before calling the provider when configuration is absent", async () => {
    const fetchImpl = matrixResponse([]);
    await expectReason(
      getDrivingDistanceKm(destination, { environment: {}, fetchImpl, cache: null }),
      "PROVIDER_NOT_CONFIGURED",
    );
    await expectReason(
      getDrivingDistanceKm(destination, {
        environment: { DISTANCE_PROVIDER: "google", DISTANCE_API_KEY: "k" },
        fetchImpl,
        cache: null,
      }),
      "ORIGIN_NOT_CONFIGURED",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
