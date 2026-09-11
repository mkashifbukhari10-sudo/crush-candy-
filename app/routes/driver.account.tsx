/* eslint-disable jsx-a11y/label-has-associated-control */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation } from "react-router";

import { requireDriver } from "../auth/driver.server";
import { DRIVER_MIN_PASSWORD_LENGTH } from "../config/constants";
import { createDriverCsrfToken } from "../lib/driver-security.server";
import { DriverRateLimitError } from "../lib/errors.server";
import { DriverPasswordChangeError, changeDriverPassword, requireDriverCsrf } from "../services/driver/auth.server";

type ActionResult = { ok: boolean; message: string };

/** Deliberately generic for a wrong current password: it reveals nothing about the account. */
const MESSAGE: Record<DriverPasswordChangeError["reason"], string> = {
  INVALID_CURRENT: "That password change could not be completed. Check your current password and try again.",
  SAME_PASSWORD: "Your new password must be different from your current one.",
  WEAK_PASSWORD: `Your new password must be at least ${DRIVER_MIN_PASSWORD_LENGTH} characters.`,
};

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const auth = await requireDriver(request);
    return {
      email: auth.context.email,
      displayName: auth.context.displayName,
      csrfToken: createDriverCsrfToken(auth.context.sessionId),
      minLength: DRIVER_MIN_PASSWORD_LENGTH,
    };
  } catch {
    throw redirect("/driver/login");
  }
}

export async function action({ request }: ActionFunctionArgs) {
  let auth;
  try {
    auth = await requireDriver(request);
  } catch {
    throw redirect("/driver/login");
  }

  const form = await request.formData();
  requireDriverCsrf(request, auth, String(form.get("csrfToken") ?? ""));

  const currentPassword = String(form.get("currentPassword") ?? "");
  const newPassword = String(form.get("newPassword") ?? "");
  const confirmPassword = String(form.get("confirmPassword") ?? "");

  if (newPassword !== confirmPassword) {
    return Response.json({ ok: false, message: "The new passwords do not match." } satisfies ActionResult, { status: 400, headers: { "cache-control": "no-store" } });
  }

  try {
    const headers = await changeDriverPassword({ auth, currentPassword, newPassword, request });
    // Fresh session cookie for this device; every other session was revoked.
    headers.set("cache-control", "no-store");
    return Response.json({ ok: true, message: "Password changed. You are still signed in here, and every other device has been signed out." } satisfies ActionResult, { headers });
  } catch (error) {
    if (error instanceof DriverRateLimitError) {
      return Response.json({ ok: false, message: "Too many attempts. Please wait and try again." } satisfies ActionResult, {
        status: 429,
        headers: { "retry-after": String(error.retryAfterSeconds), "cache-control": "no-store" },
      });
    }
    if (error instanceof DriverPasswordChangeError) {
      return Response.json({ ok: false, message: MESSAGE[error.reason] } satisfies ActionResult, { status: 400, headers: { "cache-control": "no-store" } });
    }
    throw redirect("/driver/login");
  }
}

const field = { display: "grid", gap: 4, fontSize: 13, color: "#6b5a64", marginTop: 12 } as const;
const input = { padding: "12px", border: "1px solid #ddd3da", borderRadius: 8, font: "inherit", color: "#2e2028", minHeight: 44 } as const;

export default function DriverAccount() {
  const { email, displayName, csrfToken, minLength } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as ActionResult | undefined;
  const busy = useNavigation().state !== "idle";

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "48px 20px" }}>
      <p><Link to="/driver">← Driver portal</Link></p>
      <h1>Account and security</h1>
      <p>{displayName} · {email}</p>

      {result ? (
        <p
          role={result.ok ? "status" : "alert"}
          style={{ background: result.ok ? "#eaf7ee" : "#fdeceb", color: result.ok ? "#1d6b34" : "#8a1c13", borderRadius: 10, padding: "12px 14px" }}
        >
          {result.message}
        </p>
      ) : null}

      <section style={{ background: "white", borderRadius: 12, padding: 20, marginTop: 16 }}>
        <h2 style={{ fontSize: 18, marginTop: 0 }}>Change password</h2>
        <p style={{ fontSize: 13, color: "#6b5a64" }}>
          At least {minLength} characters. Changing it signs out every other device.
        </p>
        <Form method="post" autoComplete="off">
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <label style={field}>
            Current password
            <input style={input} name="currentPassword" type="password" autoComplete="current-password" required />
          </label>
          <label style={field}>
            New password
            <input style={input} name="newPassword" type="password" autoComplete="new-password" minLength={minLength} required />
          </label>
          <label style={field}>
            Confirm new password
            <input style={input} name="confirmPassword" type="password" autoComplete="new-password" minLength={minLength} required />
          </label>
          <div style={{ marginTop: 18 }}>
            <button
              type="submit"
              disabled={busy}
              style={{ minHeight: 44, padding: "12px 22px", borderRadius: 8, border: "none", background: "#2e2028", color: "white", font: "inherit", fontWeight: 600, cursor: "pointer" }}
            >
              {busy ? "Saving…" : "Change password"}
            </button>
          </div>
        </Form>
      </section>

      <p style={{ marginTop: 24 }}><Link to="/driver/logout-all">Log out everywhere</Link></p>
    </main>
  );
}
