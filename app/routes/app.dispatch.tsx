import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import { requireAdmin } from "../auth/admin.server";
import { assignOrder, getDispatchSettings, listActiveDrivers, listAssignments, scheduleOrder, setDefaultDriver } from "../services/dispatch.server";

const schema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("assign"), assignmentId: z.string().min(1), driverId: z.string().min(1) }),
  z.object({ intent: z.literal("unassign"), assignmentId: z.string().min(1) }),
  z.object({ intent: z.literal("schedule"), assignmentId: z.string().min(1), scheduledFor: z.string().datetime({ offset: true }) }),
  z.object({ intent: z.literal("default"), driverId: z.string().optional(), enabled: z.enum(["true", "false"]) }),
]);
function actorId(session: { id: string; onlineAccessInfo?: { associated_user: { id: number } } }) { return session.onlineAccessInfo?.associated_user.id.toString() ?? session.id; }
export async function loader({ request }: LoaderFunctionArgs) { await requireAdmin(request); return { assignments: await listAssignments(), drivers: await listActiveDrivers(), settings: await getDispatchSettings() }; }
export async function action({ request }: ActionFunctionArgs) {
  const { session } = await requireAdmin(request); const parsed = schema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return { ok: false, message: "Invalid dispatch action." };
  try { const actor = actorId(session);
    if (parsed.data.intent === "assign") await assignOrder({ assignmentId: parsed.data.assignmentId, driverId: parsed.data.driverId, actorId: actor, actorPlane: "ADMIN" });
    if (parsed.data.intent === "unassign") await assignOrder({ assignmentId: parsed.data.assignmentId, driverId: null, actorId: actor, actorPlane: "ADMIN" });
    if (parsed.data.intent === "schedule") await scheduleOrder({ assignmentId: parsed.data.assignmentId, scheduledFor: new Date(parsed.data.scheduledFor), actorId: actor });
    if (parsed.data.intent === "default") await setDefaultDriver(parsed.data.driverId || null, parsed.data.enabled === "true");
    return { ok: true, message: "Dispatch change saved." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Dispatch change failed." }; }
}

export default function DispatchPage() {
  const { assignments, drivers, settings } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const [view, setView] = useState("ALL");
  const metrics = {
    pending: assignments.filter((order) => order.status === "PENDING").length,
    assigned: assignments.filter((order) => order.status === "ASSIGNED").length,
    scheduled: assignments.filter((order) => order.status === "SCHEDULED").length,
    unassigned: assignments.filter((order) => !order.driverId).length,
  };
  const visible = useMemo(() => assignments.filter((order) => view === "ALL" || (view === "UNASSIGNED" && !order.driverId) || (view === "ASSIGNED" && order.driverId) || (view === "SCHEDULED" && order.status === "SCHEDULED")), [assignments, view]);
  const statusTone = (status: string) => status === "PENDING" ? "warning" : status === "CANCELLED" || status === "FAILED" ? "critical" : status === "DELIVERED" ? "success" : "info";
  return <s-page heading="Dispatch" inlineSize="large"><s-stack direction="block" gap="base">
    <s-section><s-stack direction="block" gap="small"><s-heading>Dispatch workspace</s-heading><s-text>Assign active drivers and schedule delivery work. Shopify remains the source of truth for order and payment information.</s-text></s-stack></s-section>
    {result?.message ? <s-section><s-banner tone={result.ok ? "success" : "critical"}>{result.message}</s-banner></s-section> : null}
    <s-section heading="Overview"><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>{[["Pending / processing", metrics.pending], ["Assigned", metrics.assigned], ["Scheduled", metrics.scheduled], ["Unassigned", metrics.unassigned]].map(([label, value]) => <div key={label} style={{ border: "1px solid #e1e3e5", borderRadius: 8, padding: 16, background: "#fff" }}><s-text>{label}</s-text><div style={{ fontSize: 28, fontWeight: 650, marginTop: 8 }}>{value}</div></div>)}</div></s-section>
    <s-section heading="Automatic assignment"><s-text>Choose one active driver for eligible incoming orders. Manual assignment remains available below.</s-text><Form method="post" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end", marginTop: 16 }}><input type="hidden" name="intent" value="default" /><label>Default active driver<select name="driverId" defaultValue={settings?.autoAssignDriverId ?? ""}><option value="">None</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}</select></label><input type="hidden" name="enabled" value="false" /><label><input type="checkbox" name="enabled" value="true" defaultChecked={settings?.autoAssignEnabled} /> Enable automatic assignment</label><s-button type="submit" variant="primary">Save setting</s-button></Form></s-section>
    <s-section heading="Operational orders"><s-stack direction="block" gap="base"><div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><s-button type="button" variant={view === "ALL" ? "primary" : "secondary"} onClick={() => setView("ALL")}>All ({assignments.length})</s-button><s-button type="button" variant={view === "UNASSIGNED" ? "primary" : "secondary"} onClick={() => setView("UNASSIGNED")}>Unassigned ({metrics.unassigned})</s-button><s-button type="button" variant={view === "ASSIGNED" ? "primary" : "secondary"} onClick={() => setView("ASSIGNED")}>Assigned ({metrics.assigned})</s-button><s-button type="button" variant={view === "SCHEDULED" ? "primary" : "secondary"} onClick={() => setView("SCHEDULED")}>Scheduled ({metrics.scheduled})</s-button></div>{assignments.length === 0 ? <div style={{ padding: "28px 8px", textAlign: "center" }}><s-heading>No operational orders yet</s-heading><s-text>New eligible Shopify orders will appear here after synchronization.</s-text></div> : visible.length === 0 ? <div style={{ padding: "24px 8px", textAlign: "center" }}><s-text>No orders match this view.</s-text></div> : <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}><thead><tr><th style={{ textAlign: "left", padding: 10 }}>Order</th><th style={{ textAlign: "left", padding: 10 }}>Dispatch status</th><th style={{ textAlign: "left", padding: 10 }}>Driver</th><th style={{ textAlign: "left", padding: 10 }}>Schedule</th><th style={{ textAlign: "left", padding: 10 }}>Actions</th></tr></thead><tbody>{visible.map((order) => <tr key={order.id} style={{ borderTop: "1px solid #e1e3e5" }}><td style={{ padding: 10 }}><strong>{order.shopifyOrderNumber}</strong><div style={{ color: "#616161", fontSize: 13 }}>{order.destinationCity ?? "Destination pending"}{order.destinationPostcode ? ` · ${order.destinationPostcode}` : ""}</div></td><td style={{ padding: 10 }}><s-badge tone={statusTone(order.status)}>{order.status}</s-badge></td><td style={{ padding: 10 }}>{order.driver?.displayName ?? <span style={{ color: "#616161" }}>Unassigned</span>}</td><td style={{ padding: 10 }}>{order.scheduledFor ? new Date(order.scheduledFor).toLocaleString("en-AU", { timeZone: "Australia/Perth" }) : <span style={{ color: "#616161" }}>Not scheduled</span>}</td><td style={{ padding: 10 }}><div style={{ display: "grid", gap: 8, minWidth: 260 }}><Form method="post" style={{ display: "flex", gap: 8 }}><input type="hidden" name="intent" value="assign" /><input type="hidden" name="assignmentId" value={order.id} /><select name="driverId" required defaultValue={order.driverId ?? ""}><option value="">Select active driver</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}</select><s-button type="submit">{order.driver ? "Reassign" : "Assign"}</s-button></Form><div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><Form method="post"><input type="hidden" name="intent" value="unassign" /><input type="hidden" name="assignmentId" value={order.id} /><s-button type="submit">Unassign</s-button></Form><Form method="post" style={{ display: "flex", gap: 8 }}><input type="hidden" name="intent" value="schedule" /><input type="hidden" name="assignmentId" value={order.id} /><input name="scheduledFor" type="datetime-local" required aria-label={`Schedule ${order.shopifyOrderNumber}`} /><s-button type="submit">{order.scheduledFor ? "Reschedule" : "Schedule"}</s-button></Form></div></div></td></tr>)}</tbody></table></div>}</s-stack></s-section>
  </s-stack></s-page>;
}
