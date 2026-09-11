/* eslint-disable jsx-a11y/label-has-associated-control */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";

import { requireCustomer } from "../auth/customer.server";
import { createCustomerCsrfToken, verifyCustomerCsrfToken } from "../lib/access-code-security.server";
import { RateLimitExceededError } from "../lib/rate-limit.server";
import { getCustomerApprovalState } from "../services/customer/approval.server";
import { customerRateLimiter } from "../services/customer/rate-limit.server";
import type { DeliveryAddressInput, CartLine } from "../services/delivery/cart-quote.server";
import { CartQuoteError, parseCartLines, parseDeliveryAddress } from "../services/delivery/cart-quote.server";
import type { DeliveryQuoteView, QuoteBlockReason } from "../services/delivery/delivery-checkout.server";
import { DeliveryCheckoutError, confirmDeliveryQuote, createDeliveryQuote } from "../services/delivery/delivery-checkout.server";
import { getDeliverySettings } from "../services/delivery.server";

type ActionData =
  | { step: "quoted"; quote: DeliveryQuoteView; address: DeliveryAddressInput; cart: CartLine[] }
  | { step: "blocked"; reason: QuoteBlockReason; subtotalCents: number; minimumOrderCents: number }
  | { step: "redirect"; invoiceUrl: string }
  | { step: "error"; message: string };

const QUOTE_POLICY = { limit: 12, windowSeconds: 10 * 60 };
const CONFIRM_POLICY = { limit: 6, windowSeconds: 10 * 60 };

const money = (cents: number) => `AUD $${(cents / 100).toFixed(2)}`;

const BLOCK_MESSAGE: Record<QuoteBlockReason, (context: { minimumOrderCents: number; subtotalCents: number }) => string> = {
  MINIMUM_ORDER: ({ minimumOrderCents, subtotalCents }) =>
    `Delivery orders start at ${money(minimumOrderCents)}. Your cart is currently ${money(subtotalCents)} — add ${money(Math.max(0, minimumOrderCents - subtotalCents))} more to continue.`,
  DELIVERY_DISABLED: () => "Delivery is temporarily unavailable. Please contact us to arrange your order.",
  UNCONFIGURED_DISTANCE: () => "Delivery pricing is not available right now. Please contact us to arrange your order.",
  DISTANCE_UNAVAILABLE: () => "We could not work out a driving route to that address. Check the address, or contact us and we will arrange delivery for you.",
  UNSERVICEABLE: () => "We cannot deliver to that address. Please contact us and we will help.",
};

const ERROR_MESSAGE: Record<DeliveryCheckoutError["reason"], string> = {
  QUOTE_NOT_FOUND: "That delivery quote is no longer available. Please calculate delivery again.",
  QUOTE_EXPIRED: "Your delivery quote expired. Please calculate delivery again.",
  QUOTE_CONSUMED: "This quote has already been sent to checkout. Check your open checkout tab, or calculate delivery again.",
  CART_CHANGED: "Your cart changed after the quote. Please calculate delivery again.",
  ADDRESS_CHANGED: "The delivery address changed after the quote. Please calculate delivery again.",
  REPRICED: "Prices changed since your quote. Please calculate delivery again.",
  DRAFT_FAILED: "We could not start your checkout. Please try again in a moment.",
};

const CART_QUOTE_MESSAGE: Record<CartQuoteError["reason"], string> = {
  EMPTY_CART: "Your cart is empty.",
  INVALID_CART: "We could not read your cart. Please return to the cart and try again.",
  INVALID_ADDRESS: "Please complete every required address field.",
  VARIANT_UNAVAILABLE: "One of the items in your cart is no longer available. Please review your cart.",
  PRICE_UNAVAILABLE: "We could not price your cart right now. Please try again in a moment.",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const context = await requireCustomer(request);
  const approval = await getCustomerApprovalState(context.admin, context.shopifyCustomerId);
  if (!approval.approved) {
    throw new Response("Approved customer access required", { status: 403, headers: { "cache-control": "no-store" } });
  }
  const settings = await getDeliverySettings();
  return {
    csrfToken: createCustomerCsrfToken(context.shop, context.shopifyCustomerId),
    minimumOrderCents: settings?.minDeliverySpendCents ?? 25000,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const context = await requireCustomer(request);
  const approval = await getCustomerApprovalState(context.admin, context.shopifyCustomerId);
  if (!approval.approved) {
    return Response.json({ step: "error", message: "Approved customer access required." } satisfies ActionData, {
      status: 403,
      headers: { "cache-control": "no-store" },
    });
  }

  const form = Object.fromEntries(await request.formData()) as Record<string, string>;
  if (!verifyCustomerCsrfToken(String(form.csrfToken ?? ""), context.shop, context.shopifyCustomerId)) {
    return json({ step: "error", message: "This page expired. Refresh and try again." });
  }

  const confirming = form.intent === "confirm";
  try {
    const limit = await customerRateLimiter.consume(
      confirming ? "delivery-confirm" : "delivery-quote",
      context.shopifyCustomerId,
      confirming ? CONFIRM_POLICY : QUOTE_POLICY,
    );
    if (!limit.allowed) throw new RateLimitExceededError(limit.retryAfterSeconds ?? 60);

    let cart: CartLine[];
    let address: DeliveryAddressInput;
    try {
      cart = parseCartLines(JSON.parse(form.cart ?? "null"));
      address = parseDeliveryAddress(form);
    } catch (error) {
      if (error instanceof CartQuoteError) return json({ step: "error", message: CART_QUOTE_MESSAGE[error.reason] });
      return json({ step: "error", message: CART_QUOTE_MESSAGE.INVALID_CART });
    }

    if (confirming) {
      const { invoiceUrl } = await confirmDeliveryQuote(context.admin, {
        shop: context.shop,
        customerId: context.shopifyCustomerId,
        quoteId: String(form.quoteId ?? ""),
        lines: cart,
        address,
      });
      // Returned to the browser for redirect. Never logged.
      return json({ step: "redirect", invoiceUrl });
    }

    const outcome = await createDeliveryQuote(context.admin, {
      shop: context.shop,
      customerId: context.shopifyCustomerId,
      lines: cart,
      address,
    });
    return outcome.ok
      ? json({ step: "quoted", quote: outcome.quote, address, cart })
      : json({ step: "blocked", reason: outcome.reason, subtotalCents: outcome.subtotalCents, minimumOrderCents: outcome.minimumOrderCents });
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return Response.json({ step: "error", message: "Too many attempts. Please wait a moment and try again." } satisfies ActionData, {
        status: 429,
        headers: { "retry-after": String(error.retryAfterSeconds), "cache-control": "no-store" },
      });
    }
    if (error instanceof DeliveryCheckoutError) return json({ step: "error", message: ERROR_MESSAGE[error.reason] });
    if (error instanceof CartQuoteError) return json({ step: "error", message: CART_QUOTE_MESSAGE[error.reason] });
    return json({ step: "error", message: "Something went wrong. Please try again." });
  }
}

function json(data: ActionData, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

const ADDRESS_FIELDS = [
  ["First name", "firstName", "given-name", true],
  ["Last name", "lastName", "family-name", true],
  ["Address", "address1", "address-line1", true],
  ["Apartment, suite (optional)", "address2", "address-line2", false],
  ["Suburb", "city", "address-level2", true],
  ["State", "provinceCode", "address-level1", true],
  ["Postcode", "zip", "postal-code", true],
  ["Phone (optional)", "phone", "tel", false],
] as const;

export default function PortalDelivery() {
  const { csrfToken, minimumOrderCents } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as ActionData | undefined;
  const busy = useNavigation().state !== "idle";

  const quoted = result?.step === "quoted" ? result : null;
  const address = quoted?.address;

  return (
    <>
      <h1 style={{ margin: "8px 0 4px" }}>Delivery details</h1>
      <p style={{ color: "#6c5763", marginTop: 0 }}>
        We price delivery on the actual driving distance from our Perth base. Delivery orders start at {money(minimumOrderCents)}.
      </p>

      {/* Populated from the Shopify cart before submit; identity and quantity only, never prices. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){function load(){fetch('/cart.js',{headers:{accept:'application/json'}}).then(function(r){return r.json()}).then(function(c){var lines=(c.items||[]).map(function(i){return {variantId:String(i.variant_id),quantity:i.quantity}});document.querySelectorAll('input[name="cart"]').forEach(function(el){el.value=JSON.stringify(lines)})}).catch(function(){})}
if(document.readyState!=='loading'){load()}else{document.addEventListener('DOMContentLoaded',load)}})();`,
        }}
      />

      {result?.step === "redirect" ? (
        <>
          <div style={banner("#eaf7ee", "#1d6b34")}>Your checkout is ready. Continue to payment to finish your order.</div>
          <p style={{ marginTop: 16 }}>
            <a style={cta} href={result.invoiceUrl}>Continue to payment</a>
          </p>
          <script dangerouslySetInnerHTML={{ __html: `window.location.replace(${JSON.stringify(result.invoiceUrl)});` }} />
        </>
      ) : null}

      {result?.step === "error" ? <div style={banner("#fdeceb", "#8a1c13")} role="alert">{result.message}</div> : null}
      {result?.step === "blocked" ? (
        <div style={banner("#fff6e5", "#7a4b06")} role="alert">
          {BLOCK_MESSAGE[result.reason]({ minimumOrderCents: result.minimumOrderCents, subtotalCents: result.subtotalCents })}
        </div>
      ) : null}

      {result?.step !== "redirect" ? (
        <Form method="post" style={{ marginTop: 20 }}>
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <input type="hidden" name="cart" value="[]" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            {ADDRESS_FIELDS.map(([label, name, autoComplete, required]) => (
              <label key={name} style={fieldLabel}>
                {label}
                <input
                  name={name}
                  autoComplete={autoComplete}
                  defaultValue={(address?.[name as keyof DeliveryAddressInput] as string | undefined) ?? (name === "provinceCode" ? "WA" : "")}
                  {...(required ? { required: true } : {})}
                  style={fieldInput}
                />
              </label>
            ))}
          </div>
          <input type="hidden" name="countryCode" value="AU" />
          <div style={{ marginTop: 18 }}>
            <button type="submit" name="intent" value="quote" disabled={busy} style={secondaryCta}>
              {busy ? "Calculating…" : quoted ? "Recalculate delivery" : "Calculate delivery"}
            </button>
          </div>
        </Form>
      ) : null}

      {quoted ? (
        <section style={{ marginTop: 24, borderTop: "1px solid #eadde4", paddingTop: 20 }}>
          <h2 style={{ fontSize: 18 }}>Your delivery</h2>
          <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
            {quoted.quote.lines.map((line) => (
              <div key={line.variantId} style={row}>
                <span>{line.title} × {line.quantity}</span>
                <span>{money(line.lineTotalCents)}</span>
              </div>
            ))}
            <div style={row}><span>Subtotal</span><span>{money(quoted.quote.subtotalCents)}</span></div>
            <div style={row}><span>Delivery ({quoted.quote.distanceKm.toFixed(1)} km by road)</span><span>{money(quoted.quote.feeCents)}</span></div>
            <div style={{ ...row, fontWeight: 700, borderBottom: "none" }}><span>Estimated total</span><span>{money(quoted.quote.totalCents)}</span></div>
          </div>
          <p style={{ color: "#6c5763", fontSize: 13 }}>
            Delivering to {address?.address1}, {address?.city} {address?.provinceCode} {address?.zip}. Taxes are calculated at checkout. This quote holds
            until {new Date(quoted.quote.expiresAt).toLocaleTimeString()}.
          </p>

          <Form method="post" style={{ marginTop: 8 }}>
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <input type="hidden" name="quoteId" value={quoted.quote.quoteId} />
            <input type="hidden" name="cart" value={JSON.stringify(quoted.cart)} />
            {ADDRESS_FIELDS.map(([, name]) => (
              <input key={name} type="hidden" name={name} value={(address?.[name as keyof DeliveryAddressInput] as string | undefined) ?? ""} />
            ))}
            <input type="hidden" name="countryCode" value="AU" />
            <button type="submit" name="intent" value="confirm" disabled={busy} style={cta}>
              {busy ? "Starting checkout…" : "Continue to payment"}
            </button>
          </Form>
        </section>
      ) : null}

      <p style={{ marginTop: 24 }}><a href="/cart" style={{ color: "#8a4568" }}>Back to cart</a></p>
    </>
  );
}

const banner = (background: string, color: string) => ({
  background,
  color,
  border: `1px solid ${color}22`,
  borderRadius: 10,
  padding: "12px 14px",
  marginTop: 16,
  fontSize: 14,
});
const row = { display: "flex", justifyContent: "space-between", gap: 16, padding: "8px 0", borderBottom: "1px solid #f2e7ee" } as const;
const fieldLabel = { display: "grid", gap: 4, fontSize: 13, color: "#6c5763" } as const;
const fieldInput = { padding: "10px 12px", border: "1px solid #e0cfda", borderRadius: 8, font: "inherit", color: "#30212a" } as const;
const cta = {
  display: "inline-block",
  background: "#a3346a",
  color: "white",
  border: "none",
  borderRadius: 999,
  padding: "13px 26px",
  font: "inherit",
  fontWeight: 600,
  cursor: "pointer",
  textDecoration: "none",
} as const;
const secondaryCta = { ...cta, background: "#30212a" } as const;
