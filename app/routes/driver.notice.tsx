import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { requireDriver } from "../auth/driver.server";
import { listAnnouncements } from "../services/content-support.server";
export async function loader({ request }: LoaderFunctionArgs) { try { await requireDriver(request); return { announcements: await listAnnouncements("DRIVER") }; } catch { throw redirect("/driver/login"); } }
export default function DriverNotice() { const { announcements } = useLoaderData<typeof loader>(); return <main style={{ maxWidth: 760, margin: "0 auto", padding: 48 }}><h1>Driver notices</h1>{announcements.length === 0 ? <p>No current notices.</p> : announcements.map((a) => <article key={a.id}><h2>{a.title}</h2><p>{a.body}</p></article>)}</main>; }
