import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticateCustomerProxy } from "../auth/customer.server";
import { getCustomerApprovalState } from "../services/customer/approval.server";
import { listAnnouncements } from "../services/content-support.server";
export async function loader({ request }: LoaderFunctionArgs) { const c = await authenticateCustomerProxy(request); if (!c.shopifyCustomerId) throw new Response("Login required", { status: 401 }); const a = await getCustomerApprovalState(c.admin, c.shopifyCustomerId); if (!a.approved) throw new Response("Approval required", { status: 403 }); return { announcements: await listAnnouncements("CUSTOMER") }; }
export default function CustomerAnnouncements() { const { announcements } = useLoaderData<typeof loader>(); return <section><h1>Announcements</h1><p>Customer updates from Crush Candy Supplies.</p>{announcements.length === 0 ? <p>No current announcements.</p> : announcements.map((a) => <article key={a.id}><h2>{a.title}</h2><p>{a.body}</p></article>)}</section>; }
