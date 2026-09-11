import type { LoaderFunctionArgs } from "react-router";
import { Link, redirect, useLoaderData } from "react-router";
import { requireDriver } from "../auth/driver.server";
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
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 20px" }}>
      <p><Link to="/driver">← Driver portal</Link></p>
      <h1>Upcoming deliveries</h1>
      {assignments.length === 0 ? (
        <p>No assigned deliveries.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
          {assignments.map((order) => (
            <li key={order.id} style={{ background: "white", borderRadius: 12, padding: 16 }}>
              <Link to={`/driver/upcoming/${order.id}`}><strong>{order.shopifyOrderNumber}</strong></Link>
              <div style={{ fontSize: 13, color: "#6b5a64", marginTop: 4 }}>
                {order.status}
                {" · "}
                {order.scheduledFor ? new Date(order.scheduledFor).toLocaleString("en-AU", { timeZone: "Australia/Perth" }) : "not scheduled"}
              </div>
              <div style={{ fontSize: 13, color: "#6b5a64" }}>
                {[order.destinationCity, order.destinationPostcode].filter(Boolean).join(" ") || "Destination pending"}
                {" · "}
                {order.items} {order.items === 1 ? "item" : "items"}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
