import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
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
  const { assignments, drivers, settings } = useLoaderData<typeof loader>(); const result = useActionData<typeof action>();
  return <s-page heading="Dispatch" inlineSize="large"><s-stack direction="block" gap="base">{result?.message ? <s-text>{result.message}</s-text> : null}<s-section heading="Automatic assignment"><Form method="post"><input type="hidden" name="intent" value="default" /><label>Default active driver <select name="driverId" defaultValue={settings?.autoAssignDriverId ?? ""}><option value="">None</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}</select></label><input type="hidden" name="enabled" value="false" /><label><input type="checkbox" name="enabled" value="true" defaultChecked={settings?.autoAssignEnabled} /> Enable for incoming orders</label><s-button type="submit" variant="primary">Save</s-button></Form></s-section><s-section heading="Operational orders">{assignments.length === 0 ? <s-text>No orders synchronized yet.</s-text> : <table style={{ width: "100%" }}><thead><tr><th>Order</th><th>Status</th><th>Driver</th><th>Schedule</th><th>Actions</th></tr></thead><tbody>{assignments.map((order) => <tr key={order.id}><td>{order.shopifyOrderNumber}</td><td>{order.status}</td><td>{order.driver?.displayName ?? "Unassigned"}</td><td>{order.scheduledFor ? new Date(order.scheduledFor).toLocaleString("en-AU", { timeZone: "Australia/Perth" }) : "—"}</td><td><Form method="post"><input type="hidden" name="intent" value="assign" /><input type="hidden" name="assignmentId" value={order.id} /><select name="driverId" required><option value="">Assign…</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}</select><s-button type="submit">Assign</s-button></Form><Form method="post"><input type="hidden" name="intent" value="unassign" /><input type="hidden" name="assignmentId" value={order.id} /><s-button type="submit">Unassign</s-button></Form><Form method="post"><input type="hidden" name="intent" value="schedule" /><input type="hidden" name="assignmentId" value={order.id} /><input name="scheduledFor" type="datetime-local" required /><s-button type="submit">Schedule</s-button></Form></td></tr>)}</tbody></table>}</s-section></s-stack></s-page>;
}
