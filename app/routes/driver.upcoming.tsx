import type { LoaderFunctionArgs } from "react-router";
import { Link, redirect, useLoaderData } from "react-router";
import { requireDriver } from "../auth/driver.server";
import { listAssignmentsForDriver } from "../services/dispatch.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try { const auth = await requireDriver(request); return { assignments: await listAssignmentsForDriver(auth.context.driverId) }; }
  catch { throw redirect("/driver/login"); }
}
export default function DriverUpcoming() {
  const { assignments } = useLoaderData<typeof loader>();
  return <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 20px" }}><p><Link to="/driver">← Driver portal</Link></p><h1>Upcoming deliveries</h1>{assignments.length === 0 ? <p>No assigned deliveries.</p> : <ul>{assignments.map((order) => <li key={order.id}><strong>{order.shopifyOrderNumber}</strong> — {order.status}{order.scheduledFor ? ` · ${new Date(order.scheduledFor).toLocaleString("en-AU", { timeZone: "Australia/Perth" })}` : " · not scheduled"}</li>)}</ul>}</main>;
}
