import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { z } from "zod";

import { requireAdmin } from "../auth/admin.server";
import { adminListDrivers, createDriverAccount, issueActivation, issuePasswordReset, revokeDriverSessions, setDriverStatus } from "../services/admin/driver-management.server";

const actionSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("create"), email: z.string().trim().email(), displayName: z.string().trim().min(1).max(120), phone: z.string().max(40).optional(), vehicleNote: z.string().max(200).optional() }),
  z.object({ intent: z.literal("reissue"), accountId: z.string().min(1) }),
  z.object({ intent: z.literal("reset"), accountId: z.string().min(1), email: z.string().email() }),
  z.object({ intent: z.literal("status"), accountId: z.string().min(1), status: z.enum(["ACTIVE", "SUSPENDED", "DEACTIVATED"]), reason: z.string().max(200).optional() }),
  z.object({ intent: z.literal("revoke"), accountId: z.string().min(1) }),
]);

function adminId(session: { onlineAccessInfo?: { associated_user: { id: number } }; id: string }) { return session.onlineAccessInfo?.associated_user.id.toString() ?? session.id; }
export async function loader({ request }: LoaderFunctionArgs) { await requireAdmin(request); return { drivers: await adminListDrivers() }; }

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await requireAdmin(request);
  const parsed = actionSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return { ok: false, message: "Invalid driver action." };
  const actor = adminId(session);
  if (parsed.data.intent === "create") { const created = await createDriverAccount({ ...parsed.data, request, createdByAdminId: actor }); return { ok: true, message: "Driver created. Deliver this activation link once.", activationToken: created.activationToken, expiresAt: created.expiresAt.toISOString() }; }
  if (parsed.data.intent === "reissue") { const issued = await issueActivation({ accountId: parsed.data.accountId, adminId: actor, request }); return issued ? { ok: true, message: "Activation link reissued once.", activationToken: issued.activationToken, expiresAt: issued.expiresAt.toISOString() } : { ok: false, message: "Only an invited driver can receive an activation link." }; }
  if (parsed.data.intent === "reset") { const issued = await issuePasswordReset({ accountId: parsed.data.accountId, email: parsed.data.email, adminId: actor, request }); return issued ? { ok: true, message: "Password reset link issued once.", resetToken: issued.resetToken, expiresAt: issued.expiresAt.toISOString() } : { ok: false, message: "Reset could not be issued." }; }
  if (parsed.data.intent === "revoke") { const count = await revokeDriverSessions(parsed.data.accountId, actor, request); return { ok: true, message: `${count} active session(s) revoked.` }; }
  await setDriverStatus({ accountId: parsed.data.accountId, status: parsed.data.status, adminId: actor, reason: parsed.data.reason, request });
  return { ok: true, message: `Driver status changed to ${parsed.data.status}.` };
}

export default function DriversPage() {
  const { drivers } = useLoaderData<typeof loader>(); const result = useActionData<typeof action>();
  return <s-page heading="Drivers" inlineSize="large"><s-stack direction="block" gap="base">{result?.message ? <s-text>{result.message}</s-text> : null}{result?.activationToken ? <s-section heading="One-time activation link"><p><code>{`https://crush-candy-production.up.railway.app/driver/activate?token=${result.activationToken}`}</code></p><p>Expires {new Date(result.expiresAt).toLocaleString()}. Copy it now; it will not be shown again.</p></s-section> : null}{result?.resetToken ? <s-section heading="One-time password reset link"><p><code>{`https://crush-candy-production.up.railway.app/driver/reset-password?token=${result.resetToken}`}</code></p><p>Expires {new Date(result.expiresAt).toLocaleString()}.</p></s-section> : null}<s-section heading="Create driver"><Form method="post"><input type="hidden" name="intent" value="create" /><label>Email <input name="email" type="email" required /></label><label>Display name <input name="displayName" required /></label><label>Phone (admin only) <input name="phone" /></label><label>Vehicle note (admin only) <input name="vehicleNote" /></label><s-button type="submit" variant="primary">Create invitation</s-button></Form></s-section><s-section heading="Driver accounts">{drivers.length === 0 ? <s-text>No drivers created.</s-text> : <div style={{ overflowX: "auto" }}><table style={{ width: "100%" }}><thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Actions</th></tr></thead><tbody>{drivers.map((driver) => <tr key={driver.id}><td>{driver.driver?.displayName}</td><td>{driver.email}</td><td>{driver.status}</td><td><Form method="post"><input type="hidden" name="intent" value={driver.status === "INVITED" ? "reissue" : "status"} /><input type="hidden" name="accountId" value={driver.id} />{driver.status === "INVITED" ? <s-button type="submit">Reissue activation</s-button> : null}{driver.status === "ACTIVE" ? <><input type="hidden" name="status" value="SUSPENDED" /><s-button type="submit" tone="critical">Suspend</s-button></> : null}{driver.status === "SUSPENDED" ? <><input type="hidden" name="status" value="ACTIVE" /><s-button type="submit">Reactivate</s-button></> : null}</Form><Form method="post"><input type="hidden" name="intent" value="revoke" /><input type="hidden" name="accountId" value={driver.id} /><s-button type="submit">Revoke sessions</s-button></Form><Form method="post"><input type="hidden" name="intent" value="reset" /><input type="hidden" name="accountId" value={driver.id} /><input type="hidden" name="email" value={driver.email} /><s-button type="submit">Reset password</s-button></Form></td></tr>)}</tbody></table></div>}</s-section></s-stack></s-page>;
}
