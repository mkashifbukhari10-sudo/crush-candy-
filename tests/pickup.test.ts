import { describe, expect, it } from "vitest";
import { isPickupEligible, normalizeWeightToGrams, orderWeightGrams } from "../app/services/pickup.server";
describe("confirmed 5 kg pickup eligibility", () => {
  it("normalizes supported units", () => { expect(normalizeWeightToGrams(5, "kg")).toBe(5000); expect(normalizeWeightToGrams(5000, "g")).toBe(5000); expect(normalizeWeightToGrams(1, "lb")).toBeCloseTo(453.59237); expect(normalizeWeightToGrams(1, "oz")).toBeCloseTo(28.3495); });
  it("uses total applicable product weight", () => { expect(orderWeightGrams([{ weightValue: 2.5, weightUnit: "kg", quantity: 2 }])).toBe(5000); expect(isPickupEligible([{ weightValue: 4.999, weightUnit: "kg", quantity: 1 }])).toBe(false); expect(isPickupEligible([{ weightValue: 5, weightUnit: "kg", quantity: 1 }])).toBe(true); expect(isPickupEligible([{ weightValue: 6, weightUnit: "kg", quantity: 1 }])).toBe(true); });
});
