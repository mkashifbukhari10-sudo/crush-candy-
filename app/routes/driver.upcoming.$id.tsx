import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation } from "react-router";

import { requireDriver } from "../auth/driver.server";
import { Alert, Card, DetailGroup, PageHeader, StatusBadge, formatDateTime } from "../components/driver/ui";
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

export default function DriverDeliveryDetail() {
  const { delivery, chatId, csrfToken } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as { ok: boolean; message?: string; delivery?: DriverDelivery } | undefined;
  const busy = useNavigation().state !== "idle";
  const current = result?.delivery ?? delivery;

  const address = [current.destinationAddress1, current.destinationAddress2].filter(Boolean).join(", ");
  const suburb = [current.destinationCity, current.destinationPostcode].filter(Boolean).join(" ");
  const items = lines(current.lineItems);
  const canStart = current.status === "ASSIGNED" || current.status === "SCHEDULED";

  return (
    <>
      <PageHeader
        back={{ to: "/driver/upcoming", label: "Upcoming" }}
        title={current.shopifyOrderNumber}
        subtitle={<StatusBadge status={current.status} />}
      />

      {result && !result.ok ? <Alert tone="error">{result.message}</Alert> : null}

      {current.status === "DELIVERED" ? (
        <Alert tone="success">
          Delivered{current.deliveredAt ? ` at ${formatDateTime(current.deliveredAt)}` : ""}. This delivery and its chat are now closed.
        </Alert>
      ) : null}

      <Card>
        <DetailGroup label="Schedule">
          <p className="drv-detail__value">{current.scheduledFor ? formatDateTime(current.scheduledFor) : "Not scheduled"}</p>
        </DetailGroup>
        <DetailGroup label="Deliver to">
          <p className="drv-detail__value">{current.customerFirstName ?? "Customer"}</p>
          <p className="drv-detail__value">{address || "Address pending"}</p>
          {suburb ? <p className="drv-detail__value">{suburb}</p> : null}
        </DetailGroup>
        {current.deliveryNotes ? (
          <DetailGroup label="Drop notes">
            <p className="drv-detail__notes drv-detail__value">{current.deliveryNotes}</p>
          </DetailGroup>
        ) : null}
      </Card>

      <section className="drv-section">
        <h2 className="drv-section__title">Items</h2>
        <Card>
          {items.length === 0 ? (
            <p className="drv-card__meta">No items recorded.</p>
          ) : (
            <ul className="drv-items">
              {items.map((item, index) => (
                <li key={`${item.sku ?? item.title}-${index}`}>
                  <span>{item.title}</span>
                  <span>× {item.quantity}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <div className="drv-actions">
        {canStart ? (
          <Form method="post">
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <button type="submit" name="intent" value="start" className="drv-btn drv-btn--primary drv-btn--block" disabled={busy}>
              {busy ? "Saving…" : "Mark out for delivery"}
            </button>
          </Form>
        ) : null}
        {current.status === "OUT_FOR_DELIVERY" ? (
          <Form method="post">
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <button type="submit" name="intent" value="complete" className="drv-btn drv-btn--primary drv-btn--block" disabled={busy}>
              {busy ? "Saving…" : "Mark delivered"}
            </button>
          </Form>
        ) : null}
        {chatId ? <Link className="drv-btn drv-btn--secondary drv-btn--block" to={`/driver/chat/${chatId}`}>Open chat</Link> : null}
      </div>
    </>
  );
}
