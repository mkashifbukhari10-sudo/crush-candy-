import type { LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData } from "react-router";

import { requireDriver } from "../auth/driver.server";
import { createDriverCsrfToken } from "../lib/driver-security.server";
import { listAssignmentsForDriver } from "../services/dispatch.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const auth = await requireDriver(request);
    return { ...auth.context, csrfToken: createDriverCsrfToken(auth.context.sessionId), assignments: await listAssignmentsForDriver(auth.context.driverId) };
  } catch {
    throw redirect("/driver/login");
  }
}

export default function DriverHome() {
  const driver = useLoaderData<typeof loader>();
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 20px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
        <div><p style={{ textTransform: "uppercase", letterSpacing: ".12em", fontSize: 12 }}>Crush Candy Supplies</p><h1>Welcome, {driver.displayName}</h1><p>{driver.email}</p></div>
        <Form method="post" action="/driver/logout"><input type="hidden" name="csrfToken" value={driver.csrfToken} /><button type="submit">Log out</button></Form>
      </header>
      <section style={{ background: "white", padding: 24, borderRadius: 12, marginTop: 24 }}>
        <h2>Driver portal</h2><p><a href="/driver/notice">Open driver notices</a></p>
        <p><a href="/driver/chat">Open delivery chats</a></p>
        <p>Your authenticated driver account is active.</p>
        <nav aria-label="Driver portal areas"><ul><li>Upcoming — coming in M3</li><li>Chat — coming in M3</li><li>Notice — coming in M3</li></ul></nav>
      </section>
      <p style={{ marginTop: 24 }}><a href="/driver/logout-all">Log out everywhere</a></p>
    </main>
  );
}
