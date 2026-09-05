import type { LoaderFunctionArgs } from "react-router";
import { Link, redirect, useLoaderData } from "react-router";
import { requireDriver } from "../auth/driver.server";
import { listDriverConversations } from "../services/chat.server";

export async function loader({ request }: LoaderFunctionArgs) { try { const auth = await requireDriver(request); return { conversations: await listDriverConversations(auth.context.driverId) }; } catch { throw redirect("/driver/login"); } }
export default function DriverChats() { const { conversations } = useLoaderData<typeof loader>(); return <main style={{ maxWidth: 760, margin: "0 auto", padding: 32 }}><p><Link to="/driver">← Driver portal</Link></p><h1>Delivery chats</h1>{conversations.length === 0 ? <p>No active chats.</p> : <ul>{conversations.map((c) => <li key={c.id}><Link to={`/driver/chat/${c.id}`}>{c.assignment.shopifyOrderNumber}</Link>{c.messages[0] ? ` · latest ${new Date(c.messages[0].createdAt).toLocaleString("en-AU", { timeZone: "Australia/Perth" })}` : ""}</li>)}</ul>}</main>; }
