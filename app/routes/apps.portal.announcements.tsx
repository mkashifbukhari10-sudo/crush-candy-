import type { LoaderFunctionArgs } from "react-router";
import { authenticateCustomerProxy } from "../auth/customer.server";
import { getCustomerApprovalState } from "../services/customer/approval.server";
import { listAnnouncements } from "../services/content-support.server";
export async function loader({ request }: LoaderFunctionArgs) { const c = await authenticateCustomerProxy(request); if (!c.shopifyCustomerId) throw new Response("Login required", { status: 401 }); const a = await getCustomerApprovalState(c.admin, c.shopifyCustomerId); if (!a.approved) throw new Response("Approval required", { status: 403 }); return Response.json({ announcements: await listAnnouncements("CUSTOMER") }, { headers: { "cache-control": "no-store, private" } }); }
export default function CustomerAnnouncements() { return <section><h1>Announcements</h1><p>Customer updates from Crush Candy Supplies.</p></section>; }
