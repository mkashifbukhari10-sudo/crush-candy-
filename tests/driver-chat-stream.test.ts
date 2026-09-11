import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (file: string) => readFileSync(new URL(`../app/${file}`, import.meta.url), "utf8");
const stream = source("routes/api.chat.stream.tsx");
const chat = source("services/chat.server.ts");
const thread = source("routes/driver.chat.$id.tsx");

describe("stream authorization is preserved", () => {
  it("authorizes as driver first, then customer, before opening the stream", () => {
    expect(stream).toContain("requireDriver");
    expect(stream).toContain("authenticateCustomerProxy");
    expect(stream).toContain("await authorize(new Date())");
  });

  it("re-authorizes on every poll rather than trusting the first check", () => {
    // `authorize` is the scoped conversationEvents closure and is called inside the interval.
    expect(stream).toContain("const messages = await authorize(cursor);");
  });

  it("routes driver reads through the driver-scoped query", () => {
    expect(stream).toContain('conversationEvents(id, after, "DRIVER", auth.context.driverId)');
    expect(chat).toContain('role === "CUSTOMER" ? await getCustomerConversation(id, subjectId) : await getDriverConversation(id, subjectId)');
  });

  it("inherits the driver conversation scoping, so another driver, a pickup order and a delivered order all fail", () => {
    expect(chat).toContain('export async function getDriverConversation(id: string, driverId: string)');
    expect(chat).toContain('kind: "ORDER_DELIVERY", status: "OPEN", assignment: { driverId, fulfillmentMode: "DELIVERY", status: { in: [...OPEN_STATUSES] } }');
    expect(chat).not.toMatch(/OPEN_STATUSES[^;]*DELIVERED/);
  });

  it("throws 404 rather than streaming when the conversation is not accessible", () => {
    expect(chat).toContain('if (!c) throw new Response("Not found", { status: 404 });');
  });
});

describe("stream payload carries only permitted fields", () => {
  it("selects an explicit projection with no sender id", () => {
    const line = chat.split("\n").find((l) => l.includes("export async function conversationEvents")) ?? "";
    expect(line).toContain("select: { id: true, senderType: true, senderLabel: true, body: true, createdAt: true }");
    expect(line).not.toContain("senderId: true");
  });

  it("emits no credential, cookie or session material", () => {
    expect(stream).not.toMatch(/accessToken|apiSecret|SHOPIFY_API_SECRET|cookie|sessionId|csrf/i);
  });

  it("takes the conversation id from the query string and nothing else", () => {
    expect(stream).toContain('searchParams.get("conversationId")');
    expect(stream).not.toMatch(/searchParams\.get\("(token|driverId|session|auth)"\)/);
  });

  it("sets non-cacheable event-stream headers", () => {
    expect(stream).toContain('"content-type": "text/event-stream"');
    expect(stream).toContain('"cache-control": "no-store"');
    expect(stream).toContain('"x-content-type-options": "nosniff"');
  });
});

describe("stream signals a finished thread", () => {
  it("emits a closed event before tearing the stream down", () => {
    expect(stream).toContain("event: closed");
    expect(stream).toContain("controller.close();");
  });
});

describe("driver chat client", () => {
  it("subscribes to the scoped endpoint for this conversation only", () => {
    expect(thread).toContain("new EventSource(`/api/chat/stream?conversationId=${encodeURIComponent(conversation.id)}`)");
  });

  it("passes no token or session value in the URL", () => {
    expect(thread).not.toMatch(/stream\?[^`]*(token|csrf|session)/i);
  });

  it("drops duplicates by message id", () => {
    expect(thread).toContain("seenRef.current.has(incoming.id)");
    expect(thread).toContain("seenRef.current.add(incoming.id)");
  });

  it("keeps messages ordered by timestamp then id", () => {
    expect(thread).toContain("a.createdAt === b.createdAt ? a.id.localeCompare(b.id)");
  });

  it("resets state when moving between conversations", () => {
    expect(thread).toContain("seenRef.current = new Set(initial.map((m) => m.id));");
    expect(thread).toContain("}, [conversation.id, initial]);");
  });

  it("closes the stream on unmount and on the closed event", () => {
    expect(thread).toContain("return () => source.close();");
    expect(thread).toContain('source.addEventListener("closed", () => { setClosed(true); source.close(); });');
  });

  it("shows a closed state and hides the composer once the thread ends", () => {
    expect(thread).toContain("This delivery is complete. The chat is closed");
    expect(thread).toContain("{closed ? (");
  });

  it("auto-scrolls only when already near the bottom", () => {
    expect(thread).toContain("nearBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120;");
    expect(thread).toContain("if (nearBottomRef.current) listRef.current?.scrollTo");
  });
});

describe("read state stays safe", () => {
  it("marks read on open, as before", () => {
    expect(thread).toContain('await markConversationRead(conversation.id, "DRIVER", auth.context.driverId, conversation.messages.at(-1)?.id);');
  });

  it("does not mark read while the tab is hidden", () => {
    expect(thread).toContain('document.visibilityState !== "visible"');
  });

  it("does not mark read for the driver's own message", () => {
    expect(thread).toContain('if (latest.senderType === "DRIVER") return;');
  });

  it("submits on the newest message id only, so re-renders cannot duplicate writes", () => {
    expect(thread).toContain("}, [latest?.id, csrfToken]);");
  });

  it("sends the CSRF token with the read submission", () => {
    expect(thread).toContain('readFetcher.submit({ intent: "read", csrfToken, messageId: latest.id }, { method: "post" });');
    expect(thread).toContain("requireDriverCsrf(request, auth,");
  });

  it("advances read markers monotonically so a replay cannot resurrect unread messages", () => {
    expect(chat).toContain("OR: [{ lastReadAt: null }, { lastReadAt: { lt: readAt } }]");
  });
});
