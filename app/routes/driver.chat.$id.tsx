import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useFetcher, useLoaderData, useNavigation } from "react-router";
import { requireDriver } from "../auth/driver.server";
import { Alert, PageHeader, formatDateTime } from "../components/driver/ui";
import { createDriverCsrfToken } from "../lib/driver-security.server";
import { requireDriverCsrf } from "../services/driver/auth.server";
import { getDriverConversation, markConversationRead, sendMessage } from "../services/chat.server";

/** The stream carries no sender id: only what the recipient may see. */
type StreamMessage = { id: string; senderType: string; senderLabel: string; body: string; createdAt: string };

export async function loader({ request, params }: LoaderFunctionArgs) { try { const auth = await requireDriver(request); const conversation = await getDriverConversation(params.id ?? "", auth.context.driverId); if (!conversation) throw new Response("Not found", { status: 404 }); await markConversationRead(conversation.id, "DRIVER", auth.context.driverId, conversation.messages.at(-1)?.id); return { conversation, csrfToken: createDriverCsrfToken(auth.context.sessionId) }; } catch (error) { if (error instanceof Response && error.status === 404) throw error; throw redirect("/driver/login"); } }

export async function action({ request, params }: ActionFunctionArgs) { const auth = await requireDriver(request); const form = await request.formData(); requireDriverCsrf(request, auth, String(form.get("csrfToken") ?? "")); const conversation = await getDriverConversation(params.id ?? "", auth.context.driverId); if (!conversation) throw new Response("Not found", { status: 404 }); const intent = String(form.get("intent")); if (intent === "read") { await markConversationRead(conversation.id, "DRIVER", auth.context.driverId, String(form.get("messageId") || "")); return { ok: true }; } await sendMessage({ conversationId: conversation.id, senderType: "DRIVER", senderId: auth.context.driverId, senderLabel: auth.context.displayName, body: String(form.get("body") ?? "") }); return { ok: true }; }

export default function DriverChat() {
  const { conversation, csrfToken } = useLoaderData<typeof loader>();
  const readFetcher = useFetcher();
  const sending = useNavigation().state !== "idle";

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
    <>
      <PageHeader
        back={{ to: "/driver/chat", label: "Delivery chats" }}
        title={conversation.assignment.shopifyOrderNumber}
        subtitle="Arrival and drop-off only. Keep contact details inside the platform."
      />

      <div className="drv-thread" ref={listRef} onScroll={trackScroll} role="log" aria-live="polite" aria-label="Delivery conversation">
        {messages.length === 0 ? (
          <p className="drv-card__meta">No messages yet. Send the first update.</p>
        ) : (
          messages.map((message) => {
            const mine = message.senderType === "DRIVER";
            return (
              <div key={message.id} className={`drv-msg ${mine ? "drv-msg--me" : "drv-msg--them"}`}>
                <span className="drv-msg__who">{mine ? "You" : message.senderLabel}</span>
                <p className="drv-msg__body">{message.body}</p>
                <time className="drv-msg__at" dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time>
              </div>
            );
          })
        )}
      </div>

      {closed ? (
        <Alert tone="info">This delivery is complete. The chat is closed and no longer receives messages.</Alert>
      ) : (
        <Form method="post" className="drv-section">
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <label className="drv-field">
            <span className="drv-field__label">Message</span>
            <textarea className="drv-textarea" name="body" maxLength={2000} required rows={3} placeholder="Share an ETA or arrival update…" />
          </label>
          <div className="drv-actions">
            <button type="submit" className="drv-btn drv-btn--primary drv-btn--block" disabled={sending}>
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
        </Form>
      )}
    </>
  );
}
