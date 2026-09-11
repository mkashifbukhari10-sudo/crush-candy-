import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";

import { requireDriver } from "../auth/driver.server";
import { Card, EmptyState, PageHeader } from "../components/driver/ui";
import { listAnnouncements } from "../services/content-support.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    await requireDriver(request);
    return { announcements: await listAnnouncements("DRIVER") };
  } catch {
    throw redirect("/driver/login");
  }
}

export default function DriverNotice() {
  const { announcements } = useLoaderData<typeof loader>();

  return (
    <>
      <PageHeader title="Driver notices" subtitle="Announcements for drivers only." />

      {announcements.length === 0 ? (
        <EmptyState title="No current notices">Anything the team publishes for drivers will appear here.</EmptyState>
      ) : (
        <div>
          {announcements.map((announcement) => (
            <Card key={announcement.id}>
              <h2 className="drv-card__title">{announcement.title}</h2>
              <p className="drv-detail__notes drv-card__meta">{announcement.body}</p>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
