import type { LoaderFunctionArgs } from "react-router";
import { Form, Link, redirect, useLoaderData } from "react-router";

import { requireDriver } from "../auth/driver.server";
import { createDriverCsrfToken } from "../lib/driver-security.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const auth = await requireDriver(request);
    return { ...auth.context, csrfToken: createDriverCsrfToken(auth.context.sessionId) };
  } catch {
    throw redirect("/driver/login");
  }
}

const AREAS = [
  ["/driver/upcoming", "Upcoming deliveries", "Deliveries assigned to you."],
  ["/driver/chat", "Delivery chats", "Arrival and drop-off messages."],
  ["/driver/notice", "Driver notices", "Announcements for drivers."],
] as const;

export default function DriverHome() {
  const driver = useLoaderData<typeof loader>();
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 20px" }}>
      <header style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
        <div><p style={{ textTransform: "uppercase", letterSpacing: ".12em", fontSize: 12 }}>Crush Candy Supplies</p><h1>Welcome, {driver.displayName}</h1><p>{driver.email}</p></div>
        <Form method="post" action="/driver/logout"><input type="hidden" name="csrfToken" value={driver.csrfToken} /><button type="submit">Log out</button></Form>
      </header>
      <section style={{ background: "white", padding: 24, borderRadius: 12, marginTop: 24 }}>
        <h2>Driver portal</h2>
        <nav aria-label="Driver portal areas">
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
            {AREAS.map(([href, label, description]) => (
              <li key={href}>
                <Link to={href}>{label}</Link>
                <div style={{ fontSize: 13, color: "#6b5a64" }}>{description}</div>
              </li>
            ))}
          </ul>
        </nav>
      </section>
      <p style={{ marginTop: 24 }}><Link to="/driver/logout-all">Log out everywhere</Link></p>
    </main>
  );
}
