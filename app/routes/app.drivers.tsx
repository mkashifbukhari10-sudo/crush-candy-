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
  const { drivers } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const counts = {
    total: drivers.length,
    active: drivers.filter((driver) => driver.status === "ACTIVE").length,
    invited: drivers.filter((driver) => driver.status === "INVITED").length,
    inactive: drivers.filter((driver) => driver.status === "SUSPENDED" || driver.status === "DEACTIVATED").length,
  };
  const statusTone = (status: string) => status === "ACTIVE" ? "success" : status === "INVITED" ? "info" : "critical";
  const statusLabel = (status: string) => status === "INVITED" ? "Invited" : status === "ACTIVE" ? "Active" : status === "SUSPENDED" ? "Suspended" : "Deactivated";

  return <s-page heading="Drivers" inlineSize="large">
    <s-stack direction="block" gap="base">
      <s-section>
        <s-stack direction="block" gap="small">
          <s-heading>Driver operations</s-heading>
          <s-text>Invite and manage the people who deliver customer orders. Driver access is managed separately from Shopify customer accounts.</s-text>
        </s-stack>
      </s-section>

      {result?.message ? <s-section><s-banner tone={result.ok ? "success" : "critical"}>{result.message}</s-banner></s-section> : null}
      {result?.activationToken ? <s-section heading="Activation link — copy once"><s-stack direction="block" gap="small"><p><code style={{ overflowWrap: "anywhere" }}>{`https://crush-candy-production.up.railway.app/driver/activate?token=${result.activationToken}`}</code></p><s-text>Expires {new Date(result.expiresAt).toLocaleString()}. This link will not be shown again.</s-text></s-stack></s-section> : null}
      {result?.resetToken ? <s-section heading="Password reset link — copy once"><s-stack direction="block" gap="small"><p><code style={{ overflowWrap: "anywhere" }}>{`https://crush-candy-production.up.railway.app/driver/reset-password?token=${result.resetToken}`}</code></p><s-text>Expires {new Date(result.expiresAt).toLocaleString()}. This link will not be shown again.</s-text></s-stack></s-section> : null}

      <s-section heading="Overview">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
          {[["Total drivers", counts.total], ["Active", counts.active], ["Invited", counts.invited], ["Suspended / deactivated", counts.inactive]].map(([label, value]) => <div key={label} style={{ border: "1px solid #e1e3e5", borderRadius: 8, padding: 16, background: "#fff" }}><s-text>{label}</s-text><div style={{ fontSize: 28, fontWeight: 650, marginTop: 8 }}>{value}</div></div>)}
        </div>
      </s-section>

      <s-section heading="Invite a driver">
        <s-text>Send a secure one-time activation link. The driver will set their own password.</s-text>
        <Form method="post" className="admin-form" style={{ marginTop: 16, maxWidth: 640 }}>
          <input type="hidden" name="intent" value="create" />
          <label>Email address<input name="email" type="email" autoComplete="email" required /></label>
          <label>Display name<input name="displayName" required /></label>
          <label>Phone <span style={{ color: "#616161" }}>(admin-only operational note)</span><input name="phone" /></label>
          <label>Vehicle note <span style={{ color: "#616161" }}>(admin-only operational note)</span><input name="vehicleNote" /></label>
          <div><s-button type="submit" variant="primary">Create invitation</s-button></div>
        </Form>
      </s-section>

      <s-section heading="Driver accounts">
        {drivers.length === 0 ? <div style={{ padding: "28px 8px", textAlign: "center" }}><s-heading>No drivers yet</s-heading><s-text>Create an invitation above to add the first driver.</s-text></div> : <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}><thead><tr><th style={{ textAlign: "left", padding: 10 }}>Driver</th><th style={{ textAlign: "left", padding: 10 }}>Login</th><th style={{ textAlign: "left", padding: 10 }}>Status</th><th style={{ textAlign: "left", padding: 10 }}>Account actions</th></tr></thead><tbody>{drivers.map((driver) => <tr key={driver.id} style={{ borderTop: "1px solid #e1e3e5" }}><td style={{ padding: 10 }}><strong>{driver.driver?.displayName ?? "Pending driver"}</strong></td><td style={{ padding: 10 }}>{driver.email}</td><td style={{ padding: 10 }}><s-badge tone={statusTone(driver.status)}>{statusLabel(driver.status)}</s-badge></td><td style={{ padding: 10 }}><div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>{driver.status === "INVITED" ? <Form method="post"><input type="hidden" name="intent" value="reissue" /><input type="hidden" name="accountId" value={driver.id} /><s-button type="submit">Reissue invite</s-button></Form> : null}{driver.status === "ACTIVE" ? <Form method="post"><input type="hidden" name="intent" value="status" /><input type="hidden" name="accountId" value={driver.id} /><input type="hidden" name="status" value="SUSPENDED" /><s-button type="submit" tone="critical">Suspend</s-button></Form> : null}{driver.status === "SUSPENDED" ? <Form method="post"><input type="hidden" name="intent" value="status" /><input type="hidden" name="accountId" value={driver.id} /><input type="hidden" name="status" value="ACTIVE" /><s-button type="submit">Reactivate</s-button></Form> : null}<Form method="post"><input type="hidden" name="intent" value="revoke" /><input type="hidden" name="accountId" value={driver.id} /><s-button type="submit">Revoke sessions</s-button></Form><Form method="post"><input type="hidden" name="intent" value="reset" /><input type="hidden" name="accountId" value={driver.id} /><input type="hidden" name="email" value={driver.email} /><s-button type="submit">Reset password</s-button></Form></div></td></tr>)}</tbody></table></div>}
      </s-section>
    </s-stack>
  </s-page>;
}
