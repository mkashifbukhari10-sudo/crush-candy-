import type { LoaderFunctionArgs } from "react-router";
import { Link, redirect, useLoaderData } from "react-router";

import { requireDriver } from "../auth/driver.server";
import { EmptyState, PageHeader, RowLink, formatDay, formatTime } from "../components/driver/ui";
import { listScheduledForDriver } from "../services/driver/delivery.server";

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
  const total = groups.reduce((sum, group) => sum + group.deliveries.length, 0);

  return (
    <>
      <PageHeader title="Scheduled deliveries" subtitle={total === 0 ? undefined : `${total} upcoming across ${groups.length} ${groups.length === 1 ? "day" : "days"}`} />

      {groups.length === 0 ? (
        <EmptyState title="Nothing scheduled">
          Deliveries assigned to you but not yet scheduled stay in <Link to="/driver/upcoming">Upcoming</Link>.
        </EmptyState>
      ) : (
        groups.map((group) => (
          <section className="drv-section" key={group.date}>
            <h2 className="drv-section__title">{formatDay(group.date)}</h2>
            <ul className="drv-list">
              {group.deliveries.map((delivery) => (
                <li key={delivery.id}>
                  <RowLink
                    to={`/driver/upcoming/${delivery.id}`}
                    title={delivery.shopifyOrderNumber}
                    meta={
                      <>
                        {formatTime(delivery.scheduledFor)}
                        {" · "}
                        {[delivery.destinationCity, delivery.destinationPostcode].filter(Boolean).join(" ") || "Destination pending"}
                        {" · "}
                        {delivery.items} {delivery.items === 1 ? "item" : "items"}
                      </>
                    }
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
