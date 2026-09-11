import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { isPublicDriverPath } from "../app/routes/driver";
import { statusLabel } from "../app/components/driver/ui";

const read = (file: string) => readFileSync(new URL(`../app/${file}`, import.meta.url), "utf8");

const css = read("styles/driver.css");
const layout = read("routes/driver.tsx");
const ui = read("components/driver/ui.tsx");

const DRIVER_ROUTES = [
  "routes/driver._index.tsx",
  "routes/driver.upcoming._index.tsx",
  "routes/driver.upcoming.$id.tsx",
  "routes/driver.scheduled.tsx",
  "routes/driver.chat.tsx",
  "routes/driver.chat.$id.tsx",
  "routes/driver.notice.tsx",
  "routes/driver.account.tsx",
  "routes/driver.logout-all.tsx",
];

describe("shared shell", () => {
  it("shows navigation only on signed-in pages", () => {
    for (const path of ["/driver/login", "/driver/activate", "/driver/forgot-password", "/driver/reset-password"]) {
      expect(isPublicDriverPath(path)).toBe(true);
    }
    for (const path of ["/driver", "/driver/upcoming", "/driver/upcoming/abc", "/driver/chat/abc", "/driver/account"]) {
      expect(isPublicDriverPath(path)).toBe(false);
    }
  });

  it("carries branding and an accessible nav landmark", () => {
    expect(layout).toContain("Crush Candy Supplies");
    expect(layout).toContain('aria-label="Driver portal"');
    expect(layout).toContain("NavLink");
  });

  it("exposes no admin or customer destination", () => {
    expect(layout).not.toMatch(/\/app\/|\/apps\/portal/);
  });

  it("keeps the driver security headers and CSP unchanged", () => {
    expect(layout).toContain("style-src 'self' 'unsafe-inline'");
    expect(layout).not.toContain("cdn.shopify.com");
    for (const header of ["cache-control", "referrer-policy", "x-content-type-options", "x-frame-options", "x-robots-tag"]) {
      expect(layout).toContain(header);
    }
  });

  it("still renders its own error boundary without leaking the error", () => {
    expect(layout).toContain("export function ErrorBoundary");
    expect(layout).not.toMatch(/\{error\}|error\.message|error\.stack/);
  });
});

describe("design system", () => {
  it("defines the dark palette with restrained pink accents", () => {
    for (const token of ["--drv-bg", "--drv-surface", "--drv-text", "--drv-accent", "--drv-muted", "--drv-danger", "--drv-success"]) {
      expect(css).toContain(token);
    }
  });

  it("scopes every class to the driver plane", () => {
    const classes = [...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((match) => match[1]);
    expect(classes.length).toBeGreaterThan(20);
    expect(classes.every((name) => name === "drv" || name.startsWith("drv-"))).toBe(true);
  });

  it("provides the primitives the pages need", () => {
    for (const primitive of [".drv-btn", ".drv-card", ".drv-badge", ".drv-nav__item", ".drv-page__header", ".drv-row", ".drv-empty", ".drv-field", ".drv-alert", ".drv-input", ".drv-msg"]) {
      expect(css).toContain(primitive);
    }
  });

  it("is loaded by the driver layout so it is not shipped to other planes", () => {
    expect(layout).toContain('import "../styles/driver.css"');
  });
});

describe("mobile-first rules", () => {
  it("sets a 44px minimum tap target and applies it to interactive elements", () => {
    expect(css).toContain("--drv-tap: 44px");
    for (const rule of [".drv-btn", ".drv-nav__item", ".drv-input", ".drv-back"]) {
      const block = css.slice(css.indexOf(rule), css.indexOf("}", css.indexOf(rule)));
      expect(block).toContain("min-height: var(--drv-tap)");
    }
  });

  it("uses a 16px input font so mobile browsers do not zoom on focus", () => {
    const block = css.slice(css.indexOf(".drv-input,"), css.indexOf("}", css.indexOf(".drv-input,")));
    expect(block).toContain("font-size: 16px");
  });

  it("keeps the fixed bottom nav from covering content", () => {
    expect(css).toContain("padding: 20px 16px 96px");
    expect(css).toContain("env(safe-area-inset-bottom");
  });

  it("wraps long order numbers, addresses and messages instead of scrolling sideways", () => {
    expect(css).toContain("overflow-wrap: anywhere");
    expect(css).toContain("white-space: pre-wrap");
  });

  it("stacks actions full width on small screens", () => {
    expect(css).toContain("@media (max-width: 480px)");
    expect(css).toContain(".drv-actions .drv-btn { width: 100%; }");
  });

  it("switches to a compact top nav on wider screens", () => {
    expect(css).toContain("@media (min-width: 720px)");
  });
});

describe("accessibility", () => {
  it("keeps focus visible", () => {
    expect(css).toContain(":focus-visible");
    expect(css).toContain("outline: 3px solid var(--drv-accent)");
  });

  it("respects reduced motion", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("labels unread counts for screen readers", () => {
    expect(ui).toContain("aria-label={`${count} unread");
  });

  it("announces errors and successes appropriately", () => {
    expect(ui).toContain('role={tone === "error" ? "alert" : "status"}');
  });

  it("gives every page a single semantic h1 via the shared header", () => {
    expect(ui).toContain('<h1 className="drv-page__title">');
    for (const route of DRIVER_ROUTES) {
      expect(read(route)).not.toContain("<h1");
    }
  });

  it("marks the live conversation as a log region", () => {
    const thread = read("routes/driver.chat.$id.tsx");
    expect(thread).toContain('role="log"');
    expect(thread).toContain('aria-live="polite"');
  });
});

describe("pages use the shared primitives rather than ad-hoc inline styles", () => {
  it.each(DRIVER_ROUTES)("%s carries no inline style attribute", (route) => {
    expect(read(route)).not.toMatch(/style=\{\{/);
  });

  it("uses the shared empty state on every list screen", () => {
    for (const route of ["routes/driver.upcoming._index.tsx", "routes/driver.scheduled.tsx", "routes/driver.chat.tsx", "routes/driver.notice.tsx"]) {
      expect(read(route)).toContain("EmptyState");
    }
  });

  it("shows a submitting state on every mutating form", () => {
    for (const route of ["routes/driver.upcoming.$id.tsx", "routes/driver.account.tsx", "routes/driver.chat.$id.tsx", "routes/driver.logout-all.tsx", "routes/driver._index.tsx"]) {
      const source = read(route);
      expect(source).toContain("useNavigation()");
      expect(source).toContain("disabled={");
    }
  });
});

describe("chat presentation", () => {
  const thread = read("routes/driver.chat.$id.tsx");

  it("distinguishes the driver's own messages", () => {
    expect(thread).toContain('const mine = message.senderType === "DRIVER";');
    expect(thread).toContain("drv-msg--me");
    expect(thread).toContain("drv-msg--them");
    expect(css).toContain("align-self: flex-end");
    expect(css).toContain("align-self: flex-start");
  });

  it("never renders a sender id or GID", () => {
    // Component body only: the server action legitimately passes the driver's own id to sendMessage.
    const component = thread.slice(thread.indexOf("export default function DriverChat"));
    expect(component).not.toMatch(/senderId/);
    expect(component).not.toMatch(/gid:\/\//);
    expect(component).toContain("message.senderLabel");
  });

  it("preserves dedupe, ordering, reset, cleanup and closed state", () => {
    expect(thread).toContain("seenRef.current.has(incoming.id)");
    expect(thread).toContain("a.createdAt === b.createdAt ? a.id.localeCompare(b.id)");
    expect(thread).toContain("seenRef.current = new Set(initial.map((m) => m.id));");
    expect(thread).toContain("return () => source.close();");
    expect(thread).toContain('source.addEventListener("closed"');
  });

  it("preserves near-bottom auto-scroll and visibility-gated read state", () => {
    expect(thread).toContain("nearBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120;");
    expect(thread).toContain('document.visibilityState !== "visible"');
    expect(thread).toContain("}, [latest?.id, csrfToken]);");
  });
});

describe("status labels are presentation only", () => {
  it("humanises without altering the underlying value", () => {
    expect(statusLabel("OUT_FOR_DELIVERY")).toBe("Out for delivery");
    expect(statusLabel("DELIVERED")).toBe("Delivered");
    expect(statusLabel("ASSIGNED")).toBe("Assigned");
  });
});
