import type { LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData, useNavigation } from "react-router";

import { requireDriver } from "../auth/driver.server";
import { PageHeader, RowLink, UnreadCount } from "../components/driver/ui";
import { createDriverCsrfToken } from "../lib/driver-security.server";
import { driverUnreadTotal } from "../services/chat.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const auth = await requireDriver(request);
    return {
      ...auth.context,
      csrfToken: createDriverCsrfToken(auth.context.sessionId),
      unread: await driverUnreadTotal(auth.context.driverId),
    };
  } catch {
    throw redirect("/driver/login");
  }
}

const AREAS = [
  ["/driver/upcoming", "Upcoming deliveries", "Deliveries assigned to you right now."],
  ["/driver/scheduled", "Scheduled deliveries", "Future deliveries grouped by date."],
  ["/driver/chat", "Delivery chats", "Arrival and drop-off messages."],
  ["/driver/notice", "Driver notices", "Announcements for drivers."],
  ["/driver/account", "Account and security", "Change your password, sign out."],
] as const;

export default function DriverHome() {
  const driver = useLoaderData<typeof loader>();
  const busy = useNavigation().state !== "idle";

  return (
    <>
      <PageHeader eyebrow="Driver portal" title={`Welcome, ${driver.displayName}`} subtitle={driver.email} />

      <nav aria-label="Driver portal areas">
        <ul className="drv-list">
          {AREAS.map(([href, label, description]) => (
            <li key={href}>
              <RowLink
                to={href}
                title={label}
                meta={description}
                badge={href === "/driver/chat" && driver.unread > 0 ? <UnreadCount count={driver.unread} /> : undefined}
              />
            </li>
          ))}
        </ul>
      </nav>

      <Form method="post" action="/driver/logout" className="drv-actions">
        <input type="hidden" name="csrfToken" value={driver.csrfToken} />
        <button type="submit" className="drv-btn drv-btn--secondary" disabled={busy}>
          {busy ? "Signing out…" : "Log out"}
        </button>
      </Form>
    </>
  );
}
