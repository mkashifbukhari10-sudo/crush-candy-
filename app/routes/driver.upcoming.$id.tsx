import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation } from "react-router";

import { requireDriver } from "../auth/driver.server";
import { createDriverCsrfToken } from "../lib/driver-security.server";
import { requireDriverCsrf } from "../services/driver/auth.server";
import type { DriverDelivery } from "../services/driver/delivery.server";
import { DeliveryWorkflowError, completeDelivery, getDeliveryForDriver, startDelivery } from "../services/driver/delivery.server";
import { getDriverConversation } from "../services/chat.server";

type Line = { title?: unknown; quantity?: unknown; sku?: unknown };

function lines(lineItems: unknown): Array<{ title: string; quantity: number; sku: string | null }> {
  if (!Array.isArray(lineItems)) return [];
  return lineItems.map((raw) => {
    const item = (raw ?? {}) as Line;
    return {
      title: typeof item.title === "string" ? item.title : "Item",
      quantity: Number(item.quantity) || 0,
      sku: typeof item.sku === "string" ? item.sku : null,
    };
  });
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  let auth;
  try {
    auth = await requireDriver(request);
  } catch {
    throw redirect("/driver/login");
  }

  const delivery = await getDeliveryForDriver(params.id ?? "", auth.context.driverId);
  // Another driver's order, a pickup order and a completed order are all indistinguishable here.
  if (!delivery) throw new Response("Not found", { status: 404 });

  const conversation = await getDriverConversation(params.id ?? "", auth.context.driverId).catch(() => null);
  return {
    delivery,
    chatId: conversation?.id ?? null,
    csrfToken: createDriverCsrfToken(auth.context.sessionId),
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const auth = await requireDriver(request);
  const form = await request.formData();
  requireDriverCsrf(request, auth, String(form.get("csrfToken") ?? ""));

  const intent = String(form.get("intent") ?? "");
  try {
    const delivery =
      intent === "start"
        ? await startDelivery(params.id ?? "", auth.context.driverId)
        : intent === "complete"
          ? await completeDelivery(params.id ?? "", auth.context.driverId)
          : null;
    if (!delivery) return Response.json({ ok: false, message: "Unknown action." }, { status: 400 });
    return Response.json({ ok: true, delivery }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof DeliveryWorkflowError) {
      if (error.reason === "NOT_FOUND") throw new Response("Not found", { status: 404 });
      return Response.json(
        { ok: false, message: "That delivery has already moved on. Refresh to see its current state." },
        { status: 409, headers: { "cache-control": "no-store" } },
      );
    }
    throw error;
  }
}

const button = {
  background: "#2e2028",
  color: "white",
  border: "none",
  borderRadius: 8,
  padding: "13px 22px",
  font: "inherit",
  fontWeight: 600,
  cursor: "pointer",
  minHeight: 44,
} as const;

export default function DriverDeliveryDetail() {
  const { delivery, chatId, csrfToken } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as { ok: boolean; message?: string; delivery?: DriverDelivery } | undefined;
  const busy = useNavigation().state !== "idle";
  const current = result?.delivery ?? delivery;

  const address = [current.destinationAddress1, current.destinationAddress2].filter(Boolean).join(", ");
  const suburb = [current.destinationCity, current.destinationPostcode].filter(Boolean).join(" ");
  const items = lines(current.lineItems);

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 20px" }}>
      <p><Link to="/driver/upcoming">← Upcoming deliveries</Link></p>
      <h1>{current.shopifyOrderNumber}</h1>
      <p>{current.status}{current.scheduledFor ? ` · scheduled ${new Date(current.scheduledFor).toLocaleString("en-AU", { timeZone: "Australia/Perth" })}` : ""}</p>

      {result && !result.ok ? (
        <p role="alert" style={{ background: "#fdeceb", color: "#8a1c13", borderRadius: 10, padding: "12px 14px" }}>{result.message}</p>
      ) : null}

      <section style={{ background: "white", borderRadius: 12, padding: 20, marginTop: 16 }}>
        <h2 style={{ fontSize: 18, marginTop: 0 }}>Deliver to</h2>
        <p style={{ margin: "4px 0" }}>{current.customerFirstName ?? "Customer"}</p>
        <p style={{ margin: "4px 0" }}>{address || "Address pending"}</p>
        <p style={{ margin: "4px 0" }}>{suburb || ""}</p>
        {current.deliveryNotes ? (
          <>
            <h3 style={{ fontSize: 15, marginBottom: 4 }}>Notes</h3>
            <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{current.deliveryNotes}</p>
          </>
        ) : null}
      </section>

      <section style={{ background: "white", borderRadius: 12, padding: 20, marginTop: 16 }}>
        <h2 style={{ fontSize: 18, marginTop: 0 }}>Items</h2>
        {items.length === 0 ? <p>No items recorded.</p> : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {items.map((item, index) => (
              <li key={`${item.sku ?? item.title}-${index}`}>{item.title} × {item.quantity}</li>
            ))}
          </ul>
        )}
      </section>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 20 }}>
        {chatId ? <Link to={`/driver/chat/${chatId}`} style={{ ...button, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>Open chat</Link> : null}
        {current.status === "ASSIGNED" || current.status === "SCHEDULED" ? (
          <Form method="post">
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <button type="submit" name="intent" value="start" disabled={busy} style={button}>
              {busy ? "Saving…" : "Mark out for delivery"}
            </button>
          </Form>
        ) : null}
        {current.status === "OUT_FOR_DELIVERY" ? (
          <Form method="post">
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <button type="submit" name="intent" value="complete" disabled={busy} style={button}>
              {busy ? "Saving…" : "Mark delivered"}
            </button>
          </Form>
        ) : null}
      </div>

      {current.status === "DELIVERED" ? (
        <p style={{ background: "#eaf7ee", color: "#1d6b34", borderRadius: 10, padding: "12px 14px", marginTop: 16 }}>
          Delivered{current.deliveredAt ? ` at ${new Date(current.deliveredAt).toLocaleString("en-AU", { timeZone: "Australia/Perth" })}` : ""}. This delivery and its chat are now closed.
        </p>
      ) : null}
    </main>
  );
}
