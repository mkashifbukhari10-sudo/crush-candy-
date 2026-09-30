import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(new URL(`../app/${file}`, import.meta.url), "utf8");

describe("admin dashboard", () => {
  const page = read("routes/app._index.tsx");

  it("no longer shows the stale milestone text", () => {
    expect(page).not.toContain("status.milestone");
    expect(page).not.toContain("APP_PHASE");
    expect(read("routes/_index/route.tsx")).not.toContain("Milestone 8");
  });

  it("uses only the counts getFoundationStatus already returns (no new queries)", () => {
    expect(page).toContain("getFoundationStatus(request)");
    expect(page).not.toMatch(/\bdb\.|prisma/);
    for (const metric of ["pendingOrders", "scheduledDeliveries", "activeDrivers", "openTickets", "activeConversations", "activeAccessCodes"]) {
      expect(page).toContain(`m.${metric}`);
    }
  });

  it("shows '—' instead of a misleading 0 when the database is unreachable", () => {
    expect(page).toContain("status.databaseConnected ? n : null");
    expect(read("components/admin/StatCard.tsx")).toContain('value ?? "—"');
  });

  it("keeps Shopify's embedded context on every dashboard link", () => {
    const links = page.match(/to=\{[^}]+\}/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toContain("withContext(");
  });

  it("uses one shared StatCard instead of inline metric cards", () => {
    expect(page).toContain('import { StatCard } from "../components/admin/StatCard"');
    expect(page).not.toContain("style={{");
  });
});
