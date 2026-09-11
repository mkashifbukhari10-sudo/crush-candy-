import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation } from "react-router";

import { requireDriver } from "../auth/driver.server";
import { Alert, Card, DetailGroup, Field, PageHeader } from "../components/driver/ui";
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

export default function DriverAccount() {
  const { email, displayName, csrfToken, minLength } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as ActionResult | undefined;
  const busy = useNavigation().state !== "idle";

  return (
    <>
      <PageHeader eyebrow="Account and security" title={displayName} subtitle={email} />

      {result ? <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert> : null}

      <Card>
        <h2 className="drv-card__title">Change password</h2>
        <p className="drv-card__meta">At least {minLength} characters. Changing it signs out every other device.</p>

        <Form method="post" autoComplete="off">
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <Field label="Current password">
            <input className="drv-input" name="currentPassword" type="password" autoComplete="current-password" required />
          </Field>
          <Field label="New password" hint={`Minimum ${minLength} characters.`}>
            <input className="drv-input" name="newPassword" type="password" autoComplete="new-password" minLength={minLength} required />
          </Field>
          <Field label="Confirm new password">
            <input className="drv-input" name="confirmPassword" type="password" autoComplete="new-password" minLength={minLength} required />
          </Field>
          <div className="drv-actions">
            <button type="submit" className="drv-btn drv-btn--primary drv-btn--block" disabled={busy}>
              {busy ? "Saving…" : "Change password"}
            </button>
          </div>
        </Form>
      </Card>

      <section className="drv-section">
        <h2 className="drv-section__title">Sessions</h2>
        <Card>
          <DetailGroup label="This device">
            <p className="drv-detail__value">Signed in as {email}.</p>
          </DetailGroup>
          <div className="drv-actions">
            <Form method="post" action="/driver/logout">
              <input type="hidden" name="csrfToken" value={csrfToken} />
              <button type="submit" className="drv-btn drv-btn--secondary drv-btn--block" disabled={busy}>Log out</button>
            </Form>
            <Link className="drv-btn drv-btn--secondary drv-btn--block" to="/driver/logout-all">Log out everywhere</Link>
          </div>
        </Card>
      </section>
    </>
  );
}
