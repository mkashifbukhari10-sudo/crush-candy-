import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { requireAdmin } from "../auth/admin.server";
import { adminSearchConversations } from "../services/chat.server";

export async function loader({ request }: LoaderFunctionArgs) { await requireAdmin(request); const query = new URL(request.url).searchParams.get("q") ?? undefined; return { conversations: await adminSearchConversations(query) }; }
export default function AdminChats() { const { conversations } = useLoaderData<typeof loader>(); return <s-page heading="Chat oversight" inlineSize="large"><FormSearch /><s-section heading="All conversations">{conversations.length === 0 ? <s-text>No conversations found.</s-text> : <ul>{conversations.map((c) => <li key={c.id}><Link to={`/app/chat/${c.id}`}>{c.assignment.shopifyOrderNumber}</Link> · {c.status} · {c.assignment.driver?.displayName ?? "Unassigned"}</li>)}</ul>}</s-section></s-page>; }
function FormSearch() { return <form method="get"><label>Search order <input name="q" maxLength={100} /><button type="submit">Search</button></label></form>; }
