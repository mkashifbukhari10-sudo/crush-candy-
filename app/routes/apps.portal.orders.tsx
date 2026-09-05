import type { LoaderFunctionArgs } from "react-router";
import { Link, redirect, useLoaderData } from "react-router";
import { authenticateCustomerProxy } from "../auth/customer.server";
import { getCustomerApprovalState } from "../services/customer/approval.server";
import { listAssignmentsForCustomer } from "../services/dispatch.server";
import { ensureOrderConversation } from "../services/chat.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const context = await authenticateCustomerProxy(request);
  if (!context.shopifyCustomerId) throw redirect("/apps/portal");
  const approval = await getCustomerApprovalState(context.admin, context.shopifyCustomerId);
  if (!approval.approved) throw redirect("/apps/portal/onboarding");
  const orders = await listAssignmentsForCustomer(context.shopifyCustomerId);
  const withChats = await Promise.all(orders.map(async (order) => { try { const chat = await ensureOrderConversation(order.id); return { ...order, conversationId: chat.id }; } catch { return { ...order, conversationId: null }; } }));
  return { orders: withChats };
}
export default function CustomerOrders() { const { orders } = useLoaderData<typeof loader>(); return <><h1>Delivery status</h1>{orders.length === 0 ? <p>No operational orders yet.</p> : <ul>{orders.map((order) => <li key={order.id}><strong>{order.shopifyOrderNumber}</strong> — {order.status}{order.scheduledFor ? ` · scheduled ${new Date(order.scheduledFor).toLocaleString("en-AU", { timeZone: "Australia/Perth" })}` : " · processing"}{order.conversationId ? <> · <Link to={`/apps/portal/chat/${order.conversationId}`}>Open delivery chat</Link></> : null}</li>)}</ul>}<p><Link to="/apps/portal">Back to portal</Link></p></>; }
