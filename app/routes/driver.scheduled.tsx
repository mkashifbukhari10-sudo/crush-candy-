import type { LoaderFunctionArgs } from "react-router";
import { Link, redirect, useLoaderData } from "react-router";

import { requireDriver } from "../auth/driver.server";
import { listScheduledForDriver } from "../services/driver/delivery.server";

const dayLabel = (key: string) =>
  new Date(`${key}T00:00:00+08:00`).toLocaleDateString("en-AU", { timeZone: "Australia/Perth", weekday: "long", day: "numeric", month: "long" });
const timeLabel = (value: string | Date) =>
  new Date(value).toLocaleTimeString("en-AU", { timeZone: "Australia/Perth", hour: "numeric", minute: "2-digit" });

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const auth = await requireDriver(request);
    return { groups: await listScheduledForDriver(auth.context.driverId) };
  } catch {
    throw redirect("/driver/login");
  }
}

export default function DriverScheduled() {
  const { groups } = useLoaderData<typeof loader>();
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 20px" }}>
      <p><Link to="/driver">← Driver portal</Link></p>
      <h1>Scheduled deliveries</h1>
      {groups.length === 0 ? (
        <p>No scheduled deliveries. Anything assigned but not yet scheduled stays in <Link to="/driver/upcoming">Upcoming</Link>.</p>
      ) : (
        groups.map((group) => (
          <section key={group.date} style={{ marginTop: 24 }}>
            <h2 style={{ fontSize: 17 }}>{dayLabel(group.date)}</h2>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
              {group.deliveries.map((delivery) => (
                <li key={delivery.id} style={{ background: "white", borderRadius: 12, padding: 16 }}>
                  <Link to={`/driver/upcoming/${delivery.id}`}><strong>{delivery.shopifyOrderNumber}</strong></Link>
                  <div style={{ fontSize: 13, color: "#6b5a64", marginTop: 4 }}>
                    {timeLabel(delivery.scheduledFor)}
                    {" · "}
                    {[delivery.destinationCity, delivery.destinationPostcode].filter(Boolean).join(" ") || "Destination pending"}
                    {" · "}
                    {delivery.items} {delivery.items === 1 ? "item" : "items"}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
