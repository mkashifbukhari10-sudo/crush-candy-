import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { requireAdmin } from "../auth/admin.server";
import { adminReadConversation } from "../services/chat.server";

export async function loader({ request, params }: LoaderFunctionArgs) { const { session } = await requireAdmin(request); const conversation = await adminReadConversation(params.id ?? "", session.id); if (!conversation) throw new Response("Not found", { status: 404 }); return { conversation }; }

export default function AdminChatDetail() {
  const { conversation } = useLoaderData<typeof loader>();
  return <s-page heading={`Chat · ${conversation.assignment.shopifyOrderNumber}`} inlineSize="large"><s-stack direction="block" gap="base">
    <Link to="/app/chat">← Back to conversations</Link>
    <s-section heading="Conversation context"><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}><div><s-text>Order</s-text><p><strong>{conversation.assignment.shopifyOrderNumber}</strong></p></div><div><s-text>Customer</s-text><p>{conversation.shopifyCustomerId}</p></div><div><s-text>Current driver</s-text><p>{conversation.assignment.driver?.displayName ?? "Unassigned"}</p></div><div><s-text>Status</s-text><p><s-badge tone={conversation.status === "OPEN" ? "success" : "neutral"}>{conversation.status === "OPEN" ? "Active" : "Closed / completed"}</s-badge></p></div></div><s-text>Admin oversight is read-only. This view has been recorded in the audit log.</s-text></s-section>
    <s-section heading={`Message history (${conversation.messages.length})`}>{conversation.messages.length === 0 ? <div style={{ padding: 28, textAlign: "center" }}><s-text>No messages in this conversation.</s-text></div> : <div style={{ display: "grid", gap: 12 }}>{conversation.messages.map((message) => <div key={message.id} style={{ border: "1px solid #e1e3e5", borderRadius: 8, padding: 14, background: message.senderType === "CUSTOMER" ? "#f6f6f7" : "#eef6ff" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><strong>{message.senderType === "CUSTOMER" ? "Customer" : "Driver"} · {message.senderLabel}</strong><small>{new Date(message.createdAt).toLocaleString("en-AU", { timeZone: "Australia/Perth" })}</small></div><p style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{message.body}</p></div>)}</div>}</s-section>
  </s-stack></s-page>;
}
