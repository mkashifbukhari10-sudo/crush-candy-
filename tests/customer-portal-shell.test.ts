import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(new URL(`../app/${file}`, import.meta.url), "utf8");

describe("customer portal shell (App Proxy)", () => {
  const shell = read("routes/apps.portal.tsx");
  const css = read("styles/customer.css");

  it("embeds its styles so they load on the storefront domain", () => {
    expect(shell).toContain('import tokensCss from "../styles/tokens.css?raw"');
    expect(shell).toContain('import customerCss from "../styles/customer.css?raw"');
    expect(shell).toContain("<style dangerouslySetInnerHTML");
  });

  it("scopes every customer class under .ccs so nothing reaches the Dawn theme", () => {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const classes = [...withoutComments.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((match) => match[1]);
    expect(classes.length).toBeGreaterThan(20);
    expect(classes.every((name) => name === "ccs" || name.startsWith("ccs-"))).toBe(true);
  });

  it("uses plain anchors (works without client JavaScript) and hides member nav when signed out or unapproved", () => {
    expect(shell).not.toContain("<Link");
    expect(shell).toContain("leaf?.authenticated !== false && leaf?.approved !== false");
  });

  it("does not authenticate in the shell — every child route keeps its own App Proxy check", () => {
    expect(shell).not.toContain("authenticateCustomerProxy");
    for (const route of ["routes/apps.portal._index.tsx", "routes/apps.portal.onboarding.tsx"]) {
      expect(read(route)).toContain("authenticateCustomerProxy(request)");
    }
  });
});

describe("customer login and home screens", () => {
  it("renders onboarding with a labelled, described access-code field and no inline styles", () => {
    const onboarding = read("routes/apps.portal.onboarding.tsx");
    expect(onboarding).toContain('htmlFor="accessCode"');
    expect(onboarding).toContain('autoComplete="one-time-code"');
    expect(onboarding).toContain("aria-describedby");
    expect(onboarding).toContain('role="alert"');
    expect(onboarding).not.toContain("style={{");
  });

  it("keeps the generic access-code failure message from the service", () => {
    expect(read("services/customer/access-code.server.ts")).toContain('"This access code is invalid or unavailable"');
  });

  it("gives the portal home one h1 per state and no inline styles", () => {
    const home = read("routes/apps.portal._index.tsx");
    expect(home.match(/<h1 /g)?.length).toBe(3);
    expect(home).not.toContain("style={{");
  });

  it("no longer uses dark-on-dark hard-coded colours on the delivery page", () => {
    const delivery = read("routes/apps.portal.delivery.tsx");
    expect(delivery).not.toContain("#6c5763");
    expect(delivery).not.toContain("#8a4568");
  });
});
