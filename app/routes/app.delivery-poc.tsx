/* eslint-disable jsx-a11y/label-has-associated-control */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useNavigation } from "react-router";

import { requireAdmin } from "../auth/admin.server";
// Client-safe: the component renders the tag, so it must not come from the .server module.
import { POC_DRAFT_TAG } from "../config/constants";
import { logger } from "../lib/logger.server";
import type { DraftOrderPocResult } from "../services/delivery/draft-order-poc.server";
import { DraftOrderPocError, createDeliveryPocDraftOrder } from "../services/delivery/draft-order-poc.server";

type ActionResult = { ok: true; draft: DraftOrderPocResult } | { ok: false; message: string };

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await requireAdmin(request);
  const form = await request.formData();
  const text = (key: string) => String(form.get(key) ?? "").trim();

  try {
    const draft = await createDeliveryPocDraftOrder(admin, {
      variantId: text("variantId"),
      quantity: Number(form.get("quantity")),
      shippingTitle: text("shippingTitle") || "Perth delivery (TEST)",
      shippingAmount: text("shippingAmount") || "75.00",
      email: text("email") || undefined,
      address: {
        firstName: text("firstName"),
        lastName: text("lastName"),
        address1: text("address1"),
        address2: text("address2") || undefined,
        city: text("city"),
        provinceCode: text("provinceCode"),
        zip: text("zip"),
        countryCode: text("countryCode") || "AU",
        phone: text("phone") || undefined,
      },
    });
    // Identifier only. No address, customer detail, token or invoice URL reaches the logs.
    logger.info("delivery.poc.draft_created", { draftOrderId: draft.id });
    return { ok: true, draft } satisfies ActionResult;
  } catch (error) {
    if (error instanceof DraftOrderPocError) return { ok: false, message: error.message } satisfies ActionResult;
    logger.error("delivery.poc.draft_failed", { error });
    return { ok: false, message: "Draft order creation failed. Check the server log entry for this request." } satisfies ActionResult;
  }
}

const ADDRESS_FIELDS = [
  ["First name", "firstName", "Test"],
  ["Last name", "lastName", "Customer"],
  ["Address line 1", "address1", "12 Sample Street"],
  ["Address line 2", "address2", ""],
  ["City", "city", "Mandurah"],
  ["State code", "provinceCode", "WA"],
  ["Postcode", "zip", "6210"],
  ["Country code", "countryCode", "AU"],
] as const;

export default function DeliveryPoc() {
  const result = useActionData<typeof action>() as ActionResult | undefined;
  const busy = useNavigation().state !== "idle";
  const draft = result?.ok ? result.draft : null;

  const summary = draft
    ? ([
        ["Draft order ID", draft.id],
        ["Draft name", draft.name ?? "—"],
        ["Status", `${draft.status ?? "—"}${draft.ready === false ? " (not ready yet)" : ""}`],
        ["Subtotal", `${draft.subtotal ?? "—"} ${draft.currencyCode ?? ""}`],
        ["Shipping", `${draft.shipping ?? "—"} ${draft.currencyCode ?? ""}`],
        ["Total", `${draft.total ?? "—"} ${draft.currencyCode ?? ""}`],
        ["Shipping line title", draft.shippingLine?.title ?? "—"],
        ["Shipping line is custom", draft.shippingLine?.custom === true ? "yes" : String(draft.shippingLine?.custom ?? "—")],
        ["Shipping line amount", draft.shippingLine?.amount ?? "—"],
      ] as const)
    : [];

  return (
    <s-page heading="Delivery architecture proof of concept" inlineSize="large">
      <s-stack direction="block" gap="base">
        <s-section>
          <s-banner tone="warning">
            Temporary internal test page. Creates a TEST draft order tagged <code>{POC_DRAFT_TAG}</code> to prove a custom
            delivery charge reaches Shopify checkout without a Carrier Service. It never completes or pays an order. Delete
            the test drafts when finished.
          </s-banner>
        </s-section>

        {result && !result.ok ? (
          <s-section><s-banner tone="critical">{result.message}</s-banner></s-section>
        ) : null}

        <s-section heading="Create test draft order">
          <Form method="post">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              <label>Product variant GID<input name="variantId" required placeholder="gid://shopify/ProductVariant/123" /></label>
              <label>Quantity<input name="quantity" type="number" min="1" max="100" defaultValue={1} required /></label>
              <label>Shipping title<input name="shippingTitle" defaultValue="Perth delivery (TEST)" /></label>
              <label>Shipping amount (AUD)<input name="shippingAmount" defaultValue="75.00" /></label>
              <label>Customer email<input name="email" type="email" placeholder="optional" /></label>
              {ADDRESS_FIELDS.map(([label, name, placeholder]) => (
                <label key={name}>{label}<input name={name} defaultValue={placeholder} /></label>
              ))}
            </div>
            <div style={{ marginTop: 16 }}>
              <s-button type="submit" variant="primary" {...(busy ? { disabled: true } : {})}>
                {busy ? "Creating…" : "Create TEST draft order"}
              </s-button>
            </div>
          </Form>
        </s-section>

        {draft ? (
          <s-section heading="Result">
            <div style={{ display: "grid", gap: 8 }}>
              {summary.map(([label, value]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "10px 0", borderBottom: "1px solid #e1e3e5" }}>
                  <s-text>{label}</s-text>
                  <strong style={{ overflowWrap: "anywhere", textAlign: "right" }}>{value}</strong>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16 }}>
              <s-text>Checkout URL — open manually to verify the fee, then abandon the checkout:</s-text>
              <p><code style={{ overflowWrap: "anywhere" }}>{draft.invoiceUrl ?? "No invoice URL returned"}</code></p>
            </div>
            <div style={{ marginTop: 16 }}>
              <s-text>Line items returned by Shopify:</s-text>
              <ul>
                {draft.lineItems.map((line, index) => (
                  <li key={`${line.variantId ?? "line"}-${index}`}>{line.title ?? "—"} × {line.quantity ?? "—"} ({line.variantId ?? "no variant"})</li>
                ))}
              </ul>
            </div>
          </s-section>
        ) : null}
      </s-stack>
    </s-page>
  );
}
