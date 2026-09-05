import { describe, expect, it } from "vitest";
import { calculateDeliveryRate } from "../app/services/delivery.server";

const settings = { deliveryEnabled: true, minDeliverySpendCents: 25000, distanceMethod: "STRAIGHT_LINE" as const, kmRoundingMode: "CEIL" as const, tierUnder25Cents: 5000, tier25To40Cents: 7500, tier40To55Cents: 12000, over55BaseCents: 12000, over55PerKmCents: 300, baseLatitude: null, baseLongitude: null };
describe("M6 delivery rate engine", () => {
  it.each([[24.99, 5000], [25, 7500], [40, 7500], [40.01, 12000], [55, 12000], [56, 12300]])("calculates %s km as %s cents", (distance, cents) => expect(calculateDeliveryRate({ distanceKm: distance, subtotalCents: 25000, settings })).toMatchObject({ available: true, amountCents: cents }));
  it("blocks below minimum, invalid distance, and unresolved rules", () => { expect(calculateDeliveryRate({ distanceKm: 10, subtotalCents: 24999, settings })).toEqual({ available: false, reason: "MINIMUM_ORDER" }); expect(calculateDeliveryRate({ distanceKm: -1, subtotalCents: 25000, settings })).toEqual({ available: false, reason: "UNSERVICEABLE" }); expect(calculateDeliveryRate({ distanceKm: 10, subtotalCents: 25000, settings: { ...settings, distanceMethod: null } })).toEqual({ available: false, reason: "UNCONFIGURED_DISTANCE" }); });
});
