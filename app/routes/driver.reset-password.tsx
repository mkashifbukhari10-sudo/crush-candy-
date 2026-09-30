import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData } from "react-router";
import { z } from "zod";

import { Alert, AuthCard, Field } from "../components/driver/ui";
import { DRIVER_MIN_PASSWORD_LENGTH } from "../config/constants";
import { createDriverCsrfToken, verifyDriverCsrfToken } from "../lib/driver-security.server";
import { DriverAuthenticationError } from "../lib/errors.server";
import { resetPassword } from "../services/driver/auth.server";

const schema = z.object({ token: z.string().min(20), password: z.string().min(12), confirmPassword: z.string().optional(), csrfToken: z.string().min(1) });
export function loader({ request }: LoaderFunctionArgs) { return { token: new URL(request.url).searchParams.get("token") ?? "", csrfToken: createDriverCsrfToken("reset") }; }
export async function action({ request }: ActionFunctionArgs) {
  const parsed = schema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success || !verifyDriverCsrfToken(parsed.data.csrfToken, "reset")) return { message: "This reset form expired. Refresh and try again." };
  // Checked server-side because the portal must work without client JavaScript.
  if (parsed.data.confirmPassword !== undefined && parsed.data.confirmPassword !== parsed.data.password) return { message: "The two passwords do not match." };
  try { await resetPassword({ token: parsed.data.token, password: parsed.data.password, request }); throw redirect("/driver/login"); } catch (error) { if (error instanceof DriverAuthenticationError || error instanceof Error) return { message: "This reset link is invalid, expired, or the password is not acceptable." }; throw error; }
}

export default function ResetPassword() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();

  if (!data.token) {
    return (
      <AuthCard title="Choose a new password">
        <Alert tone="error">This reset link is incomplete. Ask your Crush Candy contact for a new link.</Alert>
        <p className="drv-auth__links"><a className="drv-link" href="/driver/login">Back to sign in</a></p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password" lead={`At least ${DRIVER_MIN_PASSWORD_LENGTH} characters. Resetting signs you out on every device.`}>
      {result?.message ? <Alert tone="error">{result.message}</Alert> : null}
      <Form method="post" className="drv-auth__form">
        <input type="hidden" name="token" value={data.token} />
        <input type="hidden" name="csrfToken" value={data.csrfToken} />
        <Field label="New password" hint={`At least ${DRIVER_MIN_PASSWORD_LENGTH} characters.`}>
          <input className="drv-input" name="password" type="password" minLength={DRIVER_MIN_PASSWORD_LENGTH} autoComplete="new-password" required />
        </Field>
        <Field label="Confirm new password">
          <input className="drv-input" name="confirmPassword" type="password" minLength={DRIVER_MIN_PASSWORD_LENGTH} autoComplete="new-password" required />
        </Field>
        <div className="drv-actions">
          <button type="submit" className="drv-btn drv-btn--primary drv-btn--block">Reset password</button>
        </div>
      </Form>
      <p className="drv-auth__links"><a className="drv-link" href="/driver/login">Back to sign in</a></p>
    </AuthCard>
  );
}
