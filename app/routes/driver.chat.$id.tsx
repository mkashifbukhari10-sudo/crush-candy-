import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, redirect, useFetcher, useLoaderData } from "react-router";
import { requireDriver } from "../auth/driver.server";
import { createDriverCsrfToken } from "../lib/driver-security.server";
import { requireDriverCsrf } from "../services/driver/auth.server";
import { getDriverConversation, markConversationRead, sendMessage } from "../services/chat.server";

/** The stream carries no sender id: only what the recipient may see. */
type StreamMessage = { id: string; senderType: string; senderLabel: string; body: string; createdAt: string };

export async function loader({ request, params }: LoaderFunctionArgs) { try { const auth = await requireDriver(request); const conversation = await getDriverConversation(params.id ?? "", auth.context.driverId); if (!conversation) throw new Response("Not found", { status: 404 }); await markConversationRead(conversation.id, "DRIVER", auth.context.driverId, conversation.messages.at(-1)?.id); return { conversation, csrfToken: createDriverCsrfToken(auth.context.sessionId) }; } catch (error) { if (error instanceof Response && error.status === 404) throw error; throw redirect("/driver/login"); } }

export async function action({ request, params }: ActionFunctionArgs) { const auth = await requireDriver(request); const form = await request.formData(); requireDriverCsrf(request, auth, String(form.get("csrfToken") ?? "")); const conversation = await getDriverConversation(params.id ?? "", auth.context.driverId); if (!conversation) throw new Response("Not found", { status: 404 }); const intent = String(form.get("intent")); if (intent === "read") { await markConversationRead(conversation.id, "DRIVER", auth.context.driverId, String(form.get("messageId") || "")); return { ok: true }; } await sendMessage({ conversationId: conversation.id, senderType: "DRIVER", senderId: auth.context.driverId, senderLabel: auth.context.displayName, body: String(form.get("body") ?? "") }); return { ok: true }; }

const timeLabel = (value: string | Date) => new Date(value).toLocaleString("en-AU", { timeZone: "Australia/Perth" });

export default function DriverChat() {
  const { conversation, csrfToken } = useLoaderData<typeof loader>();
  const readFetcher = useFetcher();

  const initial = useMemo<StreamMessage[]>(
    () => conversation.messages.map((m) => ({ id: m.id, senderType: m.senderType, senderLabel: m.senderLabel, body: m.body, createdAt: String(m.createdAt) })),
    [conversation.messages],
  );
  const [messages, setMessages] = useState<StreamMessage[]>(initial);
  const [closed, setClosed] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);
  const seenRef = useRef<Set<string>>(new Set(initial.map((m) => m.id)));

  // Reset when navigating between threads so no message can cross conversations.
  useEffect(() => {
    setMessages(initial);
    setClosed(false);
    seenRef.current = new Set(initial.map((m) => m.id));
  }, [conversation.id, initial]);

  const trackScroll = useCallback(() => {
    const node = listRef.current;
    if (!node) return;
    nearBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120;
  }, []);

  useEffect(() => {
    // Authorisation already happened in the loader; the stream re-checks it server-side too.
    const source = new EventSource(`/api/chat/stream?conversationId=${encodeURIComponent(conversation.id)}`);

    source.addEventListener("message", (event) => {
      let incoming: StreamMessage;
      try { incoming = JSON.parse((event as MessageEvent).data) as StreamMessage; } catch { return; }
      if (!incoming?.id || seenRef.current.has(incoming.id)) return;
      seenRef.current.add(incoming.id);
      setMessages((current) =>
        [...current, incoming].sort((a, b) => (a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt < b.createdAt ? -1 : 1)),
      );
    });

    // The server signals a finished thread so EventSource does not reconnect into a 404 loop.
    source.addEventListener("closed", () => { setClosed(true); source.close(); });

    return () => source.close();
  }, [conversation.id]);

  useEffect(() => {
    if (nearBottomRef.current) listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const latest = messages.at(-1);
  useEffect(() => {
    // Only mark read while the driver is actually looking. A hidden tab must not clear the badge.
    if (!latest || document.visibilityState !== "visible") return;
    if (latest.senderType === "DRIVER") return;
    readFetcher.submit({ intent: "read", csrfToken, messageId: latest.id }, { method: "post" });
    // Submitting on the newest id only, so re-renders cannot produce duplicate writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest?.id, csrfToken]);

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 20px" }}>
      <p><Link to="/driver/chat">← Delivery chats</Link></p>
      <h1>Delivery chat · {conversation.assignment.shopifyOrderNumber}</h1>
      <p>Use this chat for ETA, arrival, and drop-off communication. Keep contact details inside the platform.</p>

      <div ref={listRef} onScroll={trackScroll} style={{ maxHeight: "55vh", overflowY: "auto", background: "white", borderRadius: 12, padding: 16 }}>
        {messages.length === 0 ? <p>No messages yet.</p> : messages.map((m) => (
          <p key={m.id}><strong>{m.senderLabel}</strong> · {timeLabel(m.createdAt)}<br />{m.body}</p>
        ))}
      </div>

      {closed ? (
        <p role="status" style={{ background: "#eef1f4", borderRadius: 10, padding: "12px 14px", marginTop: 16 }}>
          This delivery is complete. The chat is closed and no longer receives messages.
        </p>
      ) : (
        <Form method="post" style={{ marginTop: 16 }}>
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <textarea name="body" maxLength={2000} required rows={3} style={{ width: "100%", font: "inherit", padding: 10, borderRadius: 8, border: "1px solid #ddd3da" }} />
          <button type="submit" style={{ minHeight: 44, padding: "12px 22px", borderRadius: 8, border: "none", background: "#2e2028", color: "white", font: "inherit", fontWeight: 600, cursor: "pointer" }}>Send</button>
        </Form>
      )}
    </main>
  );
}
