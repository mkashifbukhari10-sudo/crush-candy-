import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, redirect, useActionData, useLoaderData } from "react-router";

import { authenticateCustomerProxy } from "../auth/customer.server";
import { createCustomerCsrfToken, verifyCustomerCsrfToken } from "../lib/access-code-security.server";
import { getCustomerApprovalState } from "../services/customer/approval.server";
import type { PickupView } from "../services/pickup.server";
import { PickupError, electPickup, getPickupForCustomer } from "../services/pickup.server";

const MESSAGE: Record<PickupError["reason"], string> = {
  NOT_FOUND: "That order is not available.",
  NOT_ELIGIBLE: "This order does not qualify for pickup.",
  TERMINAL_STATE: "This order can no longer be changed to pickup.",
  NOT_PICKUP: "This order is not set to pickup.",
  ADDRESS_UNCONFIGURED: "Pickup is temporarily unavailable. Please contact us and we will arrange collection.",
};

async function authorizedCustomer(request: Request) {
  const context = await authenticateCustomerProxy(request);
  if (!context.shopifyCustomerId) throw redirect("/apps/portal");
  if (!(await getCustomerApprovalState(context.admin, context.shopifyCustomerId)).approved) throw redirect("/apps/portal/onboarding");
  return context as typeof context & { shopifyCustomerId: string };
}

/** Read-only. Electing pickup is a POST, so opening this page changes nothing. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const context = await authorizedCustomer(request);
  try {
    const pickup = await getPickupForCustomer(params.id ?? "", context.shopifyCustomerId);
    return { pickup, csrfToken: createCustomerCsrfToken(context.shop, context.shopifyCustomerId), message: null as string | null };
  } catch (error) {
    if (error instanceof PickupError && (error.reason === "NOT_FOUND" || error.reason === "NOT_ELIGIBLE")) {
      throw new Response("Not found", { status: 404 });
    }
    throw error;
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  const context = await authorizedCustomer(request);
  const form = await request.formData();
  if (!verifyCustomerCsrfToken(String(form.get("csrfToken") ?? ""), context.shop, context.shopifyCustomerId)) {
    return Response.json({ ok: false, message: "This page expired. Refresh and confirm again." }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  try {
    const pickup = await electPickup(params.id ?? "", context.shopifyCustomerId);
    return Response.json({ ok: true, pickup }, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch (error) {
    if (error instanceof PickupError) {
      if (error.reason === "NOT_FOUND" || error.reason === "NOT_ELIGIBLE") throw new Response("Not found", { status: 404 });
      return Response.json({ ok: false, message: MESSAGE[error.reason] }, { status: 409, headers: { "cache-control": "no-store" } });
    }
    throw error;
  }
}

export default function Pickup() {
  const { pickup, csrfToken } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as { ok: boolean; message?: string; pickup?: PickupView } | undefined;
  const current = result?.pickup ?? pickup;

  return (
    <>
      <h1 style={{ margin: "8px 0 4px" }}>Pickup for {current.assignment.shopifyOrderNumber}</h1>

      {result && !result.ok ? (
        <p role="alert" style={{ background: "#fdeceb", color: "#8a1c13", borderRadius: 10, padding: "12px 14px" }}>{result.message}</p>
      ) : null}

      {current.elected ? (
        <>
          <p style={{ background: "#eaf7ee", color: "#1d6b34", borderRadius: 10, padding: "12px 14px" }}>
            <strong>Pickup selected.</strong> This order is no longer scheduled for delivery and no driver is assigned.
          </p>
          <p>Collect from: <strong>{current.address}</strong></p>
          <p>Please keep all collection arrangements in your secure thread with our team.</p>
          {current.conversationId ? (
            <p><Link to={`/apps/portal/chat/${current.conversationId}`}>Open pickup arrangement thread</Link></p>
          ) : null}
        </>
      ) : (
        <>
          <p>This order qualifies for pickup because it weighs 5 kg or more.</p>
          <p style={{ background: "#fff6e5", color: "#7a4b06", borderRadius: 10, padding: "12px 14px" }}>
            Choosing pickup <strong>replaces delivery for this order</strong>. It will not be delivered, any assigned driver is
            released, and the delivery chat closes. We will share the collection address once you confirm.
          </p>
          <Form method="post">
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <button type="submit" style={{ background: "#a3346a", color: "white", border: "none", borderRadius: 999, padding: "13px 26px", font: "inherit", fontWeight: 600, cursor: "pointer" }}>
              Confirm pickup instead of delivery
            </button>
          </Form>
        </>
      )}

      <p style={{ marginTop: 24 }}><Link to="/apps/portal/orders">Back to orders</Link></p>
    </>
  );
}
