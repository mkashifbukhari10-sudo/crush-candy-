import type { LoaderFunctionArgs } from "react-router";
import { Link, redirect, useLoaderData } from "react-router";
import { requireDriver } from "../auth/driver.server";
import { driverUnreadCounts, listDriverConversations } from "../services/chat.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const auth = await requireDriver(request);
    const [conversations, unread] = await Promise.all([
      listDriverConversations(auth.context.driverId),
      driverUnreadCounts(auth.context.driverId),
    ]);
    return {
      conversations: conversations.map((conversation) => ({
        id: conversation.id,
        orderNumber: conversation.assignment.shopifyOrderNumber,
        latestAt: conversation.messages[0]?.createdAt ?? null,
        unread: unread[conversation.id] ?? 0,
      })),
    };
  } catch {
    throw redirect("/driver/login");
  }
}

const badge = { background: "#a3346a", color: "white", borderRadius: 999, padding: "1px 9px", fontSize: 12, fontWeight: 700, marginLeft: 8 } as const;

export default function DriverChats() {
  const { conversations } = useLoaderData<typeof loader>();
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 20px" }}>
      <p><Link to="/driver">← Driver portal</Link></p>
      <h1>Delivery chats</h1>
      {conversations.length === 0 ? (
        <p>No active chats.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
          {conversations.map((conversation) => (
            <li key={conversation.id} style={{ background: "white", borderRadius: 12, padding: 16 }}>
              <Link to={`/driver/chat/${conversation.id}`}><strong>{conversation.orderNumber}</strong></Link>
              {conversation.unread > 0 ? (
                <span style={badge} aria-label={`${conversation.unread} unread messages`}>{conversation.unread}</span>
              ) : null}
              {conversation.latestAt ? (
                <div style={{ fontSize: 13, color: "#6b5a64", marginTop: 4 }}>
                  latest {new Date(conversation.latestAt).toLocaleString("en-AU", { timeZone: "Australia/Perth" })}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
