import type { LoaderFunctionArgs } from "react-router";
import { requireDriver } from "../auth/driver.server";
import { authenticateCustomerProxy } from "../auth/customer.server";
import { conversationEvents } from "../services/chat.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const id = new URL(request.url).searchParams.get("conversationId") ?? "";
  let authorize: (after: Date) => Promise<unknown[]>;
  try { const auth = await requireDriver(request); authorize = (after) => conversationEvents(id, after, "DRIVER", auth.context.driverId); }
  catch { const auth = await authenticateCustomerProxy(request); if (!auth.shopifyCustomerId) throw new Response("Unauthorized", { status: 401 }); authorize = (after) => conversationEvents(id, after, "CUSTOMER", auth.shopifyCustomerId!); }
  await authorize(new Date());
  const encoder = new TextEncoder(); let timer: ReturnType<typeof setInterval> | undefined; let cursor = new Date(); let running = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(`event: ready\ndata: {}\n\n`)); timer = setInterval(async () => { if (running) return; running = true; try { const messages = await authorize(cursor); for (const message of messages) { const createdAt = (message as { createdAt?: Date }).createdAt; if (createdAt) cursor = createdAt; controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(message)}\n\n`)); } controller.enqueue(encoder.encode(`event: heartbeat\ndata: {}\n\n`)); } catch { if (timer) clearInterval(timer); controller.close(); } finally { running = false; } }, 5000); }, cancel() { if (timer) clearInterval(timer); } });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-content-type-options": "nosniff" } });
}
