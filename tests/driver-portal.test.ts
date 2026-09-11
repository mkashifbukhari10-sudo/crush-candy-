import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { usesRemoteFont } from "../app/lib/document-assets";
import { headers } from "../app/routes/driver";

const read = (file: string) => readFileSync(new URL(`../app/routes/${file}`, import.meta.url), "utf8");

describe("driver CSP and the remote font agree", () => {
  it("skips the remote font stylesheet on every driver route", () => {
    for (const path of ["/driver", "/driver/", "/driver/login", "/driver/chat/abc", "/driver/upcoming"]) {
      expect(usesRemoteFont(path)).toBe(false);
    }
  });

  it("still loads it everywhere else, including lookalike paths", () => {
    for (const path of ["/", "/app", "/apps/portal", "/apps/portal/delivery", "/drivers", "/driverless"]) {
      expect(usesRemoteFont(path)).toBe(true);
    }
  });

  it("keeps the strict driver policy rather than allowing the CDN", () => {
    const policy = headers()["content-security-policy"];
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).not.toContain("cdn.shopify.com");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("form-action 'self'");
  });

  it("preserves the other driver security headers", () => {
    expect(headers()).toMatchObject({
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "x-robots-tag": "noindex, nofollow",
    });
  });
});

describe("driver navigation is complete and current", () => {
  const home = read("driver._index.tsx");

  it("no longer advertises shipped features as unbuilt", () => {
    for (const file of ["driver._index.tsx", "driver.upcoming._index.tsx", "driver.upcoming.$id.tsx", "driver.chat.tsx", "driver.notice.tsx"]) {
      expect(read(file)).not.toMatch(/coming in M3/i);
    }
  });

  it("links home to upcoming, chat and notices", () => {
    for (const href of ["/driver/upcoming", "/driver/scheduled", "/driver/chat", "/driver/notice", "/driver/account"]) {
      expect(home).toContain(`"${href}"`);
    }
  });

  it("does not query assignments it never renders", () => {
    expect(home).not.toContain("listAssignmentsForDriver");
  });

  it("gives notices and the chat thread a way back", () => {
    expect(read("driver.notice.tsx")).toContain('to="/driver"');
    expect(read("driver.chat.$id.tsx")).toContain('to="/driver/chat"');
  });

  it("leaves the logout route with no reachable component", () => {
    const logout = read("driver.logout.tsx");
    expect(logout).not.toContain("export default");
    expect(logout).toContain("requireDriverCsrf");
    expect(logout).toContain("logoutDriver");
  });
});

describe("driver error handling stays inside the driver plane", () => {
  const layout = read("driver.tsx");

  it("defines its own error boundary alongside the security headers", () => {
    expect(layout).toContain("export function ErrorBoundary");
    expect(layout).toContain("export function headers");
  });

  it("offers recovery links and never renders the raw error", () => {
    expect(layout).toContain('to="/driver"');
    expect(layout).toContain('to="/driver/login"');
    expect(layout).not.toMatch(/\{error\}|error\.message|error\.stack/);
  });
});

describe("security boundaries are untouched", () => {
  it("keeps requireDriver on every authenticated driver route", () => {
    for (const file of ["driver._index.tsx", "driver.upcoming._index.tsx", "driver.upcoming.$id.tsx", "driver.scheduled.tsx", "driver.account.tsx", "driver.chat.tsx", "driver.chat.$id.tsx", "driver.notice.tsx", "driver.logout.tsx", "driver.logout-all.tsx"]) {
      expect(read(file)).toContain("requireDriver");
    }
  });

  it("keeps CSRF enforcement on every driver mutation", () => {
    for (const file of ["driver.chat.$id.tsx", "driver.upcoming.$id.tsx", "driver.account.tsx", "driver.logout.tsx", "driver.logout-all.tsx"]) {
      expect(read(file)).toContain("requireDriverCsrf");
    }
  });

  it("keeps driver-scoped queries", () => {
    expect(read("driver.upcoming._index.tsx")).toContain("auth.context.driverId");
    expect(read("driver.upcoming.$id.tsx")).toContain("auth.context.driverId");
    expect(read("driver.chat.tsx")).toContain("auth.context.driverId");
    expect(read("driver.chat.$id.tsx")).toContain("auth.context.driverId");
  });
});
