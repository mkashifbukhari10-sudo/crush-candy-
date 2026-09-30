import type { LoaderFunctionArgs } from "react-router";
import { Form, Link, redirect, useLoaderData, useNavigation } from "react-router";

import { requireDriver } from "../auth/driver.server";
import { PageHeader, RowLink, UnreadCount } from "../components/driver/ui";
import { createDriverCsrfToken } from "../lib/driver-security.server";
import { driverUnreadTotal } from "../services/chat.server";
import { countDriverWork } from "../services/driver/delivery.server";

/** Greeting by Perth local hour, rendered on the server so it never depends on client JavaScript. */
function perthGreeting(now = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Perth", hour: "numeric", hourCycle: "h23" }).format(now));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const auth = await requireDriver(request);
    const [unread, work] = await Promise.all([driverUnreadTotal(auth.context.driverId), countDriverWork(auth.context.driverId)]);
    return {
      displayName: auth.context.displayName,
      csrfToken: createDriverCsrfToken(auth.context.sessionId),
      greeting: perthGreeting(),
      unread,
      upcoming: work.upcoming,
      scheduled: work.scheduled,
    };
  } catch {
    throw redirect("/driver/login");
  }
}

const AREAS = [
  ["/driver/chat", "Delivery chats", "Arrival and drop-off messages."],
  ["/driver/notice", "Driver notices", "Announcements for drivers."],
  ["/driver/account", "Account and security", "Change your password, sign out."],
] as const;

function Tile({ to, count, label }: { to: string; count: number; label: string }) {
  return (
    <Link className="drv-card drv-tile" to={to} aria-label={`${label}: ${count}`}>
      <span className="drv-tile__count">{count}</span>
      <span className="drv-tile__label">{label}</span>
    </Link>
  );
}

export default function DriverHome() {
  const driver = useLoaderData<typeof loader>();
  const busy = useNavigation().state !== "idle";

  return (
    <>
      <PageHeader eyebrow={driver.greeting} title={driver.displayName} />

      <div className="drv-tiles">
        <Tile to="/driver/upcoming" count={driver.upcoming} label="Upcoming" />
        <Tile to="/driver/scheduled" count={driver.scheduled} label="Scheduled" />
      </div>

      <nav aria-label="Driver portal areas" className="drv-section">
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
        <button type="submit" className="drv-btn drv-btn--secondary drv-btn--block" disabled={busy}>
          {busy ? "Signing out…" : "Log out"}
        </button>
      </Form>
    </>
  );
}
