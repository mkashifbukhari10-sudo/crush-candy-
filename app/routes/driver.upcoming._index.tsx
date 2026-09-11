import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";

import { requireDriver } from "../auth/driver.server";
import { EmptyState, PageHeader, RowLink, StatusBadge, formatDateTime } from "../components/driver/ui";
import { listAssignmentsForDriver } from "../services/dispatch.server";

function itemCount(lineItems: unknown): number {
  return Array.isArray(lineItems)
    ? lineItems.reduce((sum, raw) => sum + (Number((raw as { quantity?: unknown })?.quantity) || 0), 0)
    : 0;
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const auth = await requireDriver(request);
    const assignments = await listAssignmentsForDriver(auth.context.driverId);
    return {
      assignments: assignments.map((order) => ({
        id: order.id,
        shopifyOrderNumber: order.shopifyOrderNumber,
        status: order.status,
        scheduledFor: order.scheduledFor,
        destinationCity: order.destinationCity,
        destinationPostcode: order.destinationPostcode,
        items: itemCount(order.lineItems),
      })),
    };
  } catch {
    throw redirect("/driver/login");
  }
}

export default function DriverUpcoming() {
  const { assignments } = useLoaderData<typeof loader>();

  return (
    <>
      <PageHeader title="Upcoming deliveries" subtitle={assignments.length === 1 ? "1 delivery assigned to you" : `${assignments.length} deliveries assigned to you`} />

      {assignments.length === 0 ? (
        <EmptyState title="Nothing assigned yet">New deliveries appear here as soon as they are assigned to you.</EmptyState>
      ) : (
        <ul className="drv-list">
          {assignments.map((order) => (
            <li key={order.id}>
              <RowLink
                to={`/driver/upcoming/${order.id}`}
                title={order.shopifyOrderNumber}
                badge={<StatusBadge status={order.status} />}
                meta={
                  <>
                    {order.scheduledFor ? formatDateTime(order.scheduledFor) : "Not scheduled"}
                    {" · "}
                    {[order.destinationCity, order.destinationPostcode].filter(Boolean).join(" ") || "Destination pending"}
                    {" · "}
                    {order.items} {order.items === 1 ? "item" : "items"}
                  </>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
