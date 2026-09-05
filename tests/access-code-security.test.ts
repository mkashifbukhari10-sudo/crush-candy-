import { describe, expect, it } from "vitest";

import {
  createCustomerCsrfToken,
  generateAccessCode,
  hashAccessCode,
  normalizeAccessCode,
  verifyCustomerCsrfToken,
} from "../app/lib/access-code-security.server";

const HASH_SECRET = "test-hash-secret-that-is-at-least-32-characters";
const CSRF_SECRET = "test-csrf-secret-that-is-at-least-32-characters";

describe("access-code security", () => {
  it("generates high-entropy display codes without ambiguous characters", () => {
    const first = generateAccessCode();
    const second = generateAccessCode();

    expect(first.plaintext).toMatch(/^CCS-(?:[2-9A-HJ-NP-Z]{4}-){4}[2-9A-HJ-NP-Z]{4}$/);
    expect(first.last4).toBe(normalizeAccessCode(first.plaintext).slice(-4));
    expect(second.plaintext).not.toBe(first.plaintext);
  });

  it("uses a keyed deterministic hash over normalized codes", () => {
    const display = "CCS-2345-6789-ABCD-EFGH-JKLM";
    expect(hashAccessCode(display, HASH_SECRET)).toBe(
      hashAccessCode("ccs 2345 6789 abcd efgh jklm", HASH_SECRET),
    );
    expect(hashAccessCode(display, HASH_SECRET)).not.toContain("2345");
    expect(hashAccessCode(display, `${HASH_SECRET}-different`)).not.toBe(
      hashAccessCode(display, HASH_SECRET),
    );
  });

  it("binds short-lived CSRF tokens to the signed shop and customer", () => {
    const now = new Date("2026-09-05T12:00:00.000Z");
    const token = createCustomerCsrfToken(
      "example.myshopify.com",
      "gid://shopify/Customer/1",
      now,
      CSRF_SECRET,
    );

    expect(
      verifyCustomerCsrfToken(
        token,
        "example.myshopify.com",
        "gid://shopify/Customer/1",
        new Date(now.getTime() + 14 * 60 * 1000),
        CSRF_SECRET,
      ),
    ).toBe(true);
    expect(
      verifyCustomerCsrfToken(
        token,
        "example.myshopify.com",
        "gid://shopify/Customer/2",
        now,
        CSRF_SECRET,
      ),
    ).toBe(false);
    expect(
      verifyCustomerCsrfToken(
        token,
        "example.myshopify.com",
        "gid://shopify/Customer/1",
        new Date(now.getTime() + 16 * 60 * 1000),
        CSRF_SECRET,
      ),
    ).toBe(false);
  });
});
