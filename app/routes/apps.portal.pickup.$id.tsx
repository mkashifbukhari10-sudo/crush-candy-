import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, redirect, useLoaderData } from "react-router";
import { authenticateCustomerProxy } from "../auth/customer.server";
import { getCustomerApprovalState } from "../services/customer/approval.server";
import { getPickupForCustomer } from "../services/pickup.server";

async function authorized(request: Request, id: string) {
  const context = await authenticateCustomerProxy(request);
  if (!context.shopifyCustomerId) throw redirect("/apps/portal");
  if (!(await getCustomerApprovalState(context.admin, context.shopifyCustomerId)).approved) throw redirect("/apps/portal/onboarding");
  const pickup = await getPickupForCustomer(id, context.shopifyCustomerId);
  if (!pickup) throw new Response("Not found", { status: 404 });
  return pickup;
}
export async function loader({ request, params }: LoaderFunctionArgs) { return authorized(request, params.id ?? ""); }
export async function action({ request, params }: ActionFunctionArgs) { await authorized(request, params.id ?? ""); return { ok: true }; }
export default function Pickup() { const { assignment, conversation, address } = useLoaderData<typeof loader>(); return <><h1>Arrange pickup for {assignment.shopifyOrderNumber}</h1><p>Your order qualifies for pickup (5 kg or more).</p><p>Pickup address: <strong>{address}</strong></p><p>Keep all arrangements in this secure support thread.</p><p><Link to={`/apps/portal/chat/${conversation.id}`}>Open pickup arrangement thread</Link></p><Form method="post"><button type="submit">Confirm pickup flow</button></Form><p><Link to="/apps/portal/orders">Back to orders</Link></p></>; }
