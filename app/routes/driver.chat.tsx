import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { requireDriver } from "../auth/driver.server";
import { EmptyState, PageHeader, RowLink, UnreadCount, formatDateTime } from "../components/driver/ui";
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

export default function DriverChats() {
  const { conversations } = useLoaderData<typeof loader>();
  const unreadTotal = conversations.reduce((sum, conversation) => sum + conversation.unread, 0);

  return (
    <>
      <PageHeader
        title="Delivery chats"
        subtitle={unreadTotal > 0 ? `${unreadTotal} unread ${unreadTotal === 1 ? "message" : "messages"}` : "Arrival and drop-off messages."}
      />

      {conversations.length === 0 ? (
        <EmptyState title="No active chats">A chat opens for each delivery assigned to you, and closes once it is delivered.</EmptyState>
      ) : (
        <ul className="drv-list">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <RowLink
                to={`/driver/chat/${conversation.id}`}
                title={conversation.orderNumber}
                badge={conversation.unread > 0 ? <UnreadCount count={conversation.unread} /> : undefined}
                meta={conversation.latestAt ? `Latest ${formatDateTime(conversation.latestAt)}` : "No messages yet"}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
