import { createHash } from "node:crypto";
import db from "../db.server";

export type DeliverySettings = { deliveryEnabled: boolean; minDeliverySpendCents: number; distanceMethod: "STRAIGHT_LINE" | "DRIVING" | null; kmRoundingMode: "EXACT" | "CEIL" | "FLOOR" | "NEAREST" | null; tierUnder25Cents: number; tier25To40Cents: number; tier40To55Cents: number; over55BaseCents: number; over55PerKmCents: number; baseLatitude: unknown; baseLongitude: unknown };
export type DeliveryRateResult = { available: true; amountCents: number; currency: "AUD"; distanceKm: number } | { available: false; reason: "MINIMUM_ORDER" | "UNCONFIGURED_DISTANCE" | "UNSERVICEABLE" | "DISABLED" | "PROVIDER_UNAVAILABLE" };

export function calculateDeliveryRate(input: { distanceKm: number; subtotalCents: number; settings: DeliverySettings }): DeliveryRateResult {
  const { distanceKm: distance, subtotalCents: subtotal, settings } = input;
  if (!settings.deliveryEnabled) return { available: false, reason: "DISABLED" };
  if (!Number.isFinite(distance) || distance < 0) return { available: false, reason: "UNSERVICEABLE" };
  if (subtotal < settings.minDeliverySpendCents) return { available: false, reason: "MINIMUM_ORDER" };
  if (settings.distanceMethod !== "DRIVING" || !settings.kmRoundingMode) return { available: false, reason: "UNCONFIGURED_DISTANCE" };
  if (distance < 25) return { available: true, amountCents: settings.tierUnder25Cents, currency: "AUD", distanceKm: distance };
  if (distance <= 40) return { available: true, amountCents: settings.tier25To40Cents, currency: "AUD", distanceKm: distance };
  if (distance <= 55) return { available: true, amountCents: settings.tier40To55Cents, currency: "AUD", distanceKm: distance };
  const extra = distance - 55;
  const rounded = settings.kmRoundingMode === "CEIL" ? Math.ceil(extra) : settings.kmRoundingMode === "FLOOR" ? Math.floor(extra) : settings.kmRoundingMode === "NEAREST" ? Math.round(extra) : extra;
  return { available: true, amountCents: settings.over55BaseCents + Math.round(rounded * settings.over55PerKmCents), currency: "AUD", distanceKm: distance };
}

export function straightLineDistanceKm(origin: { latitude: number; longitude: number }, destination: { latitude: number; longitude: number }) { const r = 6371; const dLat = (destination.latitude - origin.latitude) * Math.PI / 180; const dLon = (destination.longitude - origin.longitude) * Math.PI / 180; const a = Math.sin(dLat / 2) ** 2 + Math.cos(origin.latitude * Math.PI / 180) * Math.cos(destination.latitude * Math.PI / 180) * Math.sin(dLon / 2) ** 2; return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); }
export function destinationKey(destination: { postcode: string; city?: string }) { return createHash("sha256").update(`${destination.postcode.trim().toLowerCase()}|${destination.city?.trim().toLowerCase() ?? ""}`).digest("hex"); }
export async function getDeliverySettings() { return db.appSettings.findUnique({ where: { id: "singleton" } }); }
export async function saveDeliverySettings(input: Partial<DeliverySettings>) { const data = { id: "singleton", ...(input as Record<string, unknown>) }; return db.appSettings.upsert({ where: { id: "singleton" }, create: data as never, update: input as never }); }
