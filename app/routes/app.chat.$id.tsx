import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { requireAdmin } from "../auth/admin.server";
import { adminReadConversation } from "../services/chat.server";

export async function loader({ request, params }: LoaderFunctionArgs) { const { session } = await requireAdmin(request); const conversation = await adminReadConversation(params.id ?? "", session.id); if (!conversation) throw new Response("Not found", { status: 404 }); return { conversation }; }
export default function AdminChatDetail() { const { conversation } = useLoaderData<typeof loader>(); return <s-page heading={`Chat · ${conversation.assignment.shopifyOrderNumber}`} inlineSize="large"><p><Link to="/app/chat">Back to conversations</Link></p><p>Customer: {conversation.shopifyCustomerId} · Driver: {conversation.assignment.driver?.displayName ?? "Unassigned"}</p>{conversation.messages.map((m) => <p key={m.id}><strong>{m.senderLabel}</strong> · {new Date(m.createdAt).toLocaleString("en-AU", { timeZone: "Australia/Perth" })}<br />{m.body}</p>)}</s-page>; }
