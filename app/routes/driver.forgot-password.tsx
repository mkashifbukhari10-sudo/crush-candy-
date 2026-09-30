import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { z } from "zod";

import { Alert, AuthCard, Field } from "../components/driver/ui";
import { createDriverCsrfToken, verifyDriverCsrfToken } from "../lib/driver-security.server";
import { DriverRateLimitError } from "../lib/errors.server";
import { requestPasswordReset } from "../services/driver/auth.server";

const schema = z.object({ email: z.string().trim().email(), csrfToken: z.string().min(1) });
export function loader(_args: LoaderFunctionArgs) { void _args; return { csrfToken: createDriverCsrfToken("reset-request") }; }
export async function action({ request }: ActionFunctionArgs) { const parsed = schema.safeParse(Object.fromEntries(await request.formData())); if (!parsed.success || !verifyDriverCsrfToken(parsed.data.csrfToken, "reset-request")) return { ok: false, message: "This form expired. Refresh and try again." }; try { await requestPasswordReset({ email: parsed.data.email, request }); return { ok: true, message: "If that account exists, reset instructions will be sent by an administrator." }; } catch (error) { if (error instanceof DriverRateLimitError) return { ok: false, message: "Too many requests. Try again later." }; throw error; } }

export default function ForgotPassword() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();

  return (
    <AuthCard title="Reset your password" lead="Enter your email. If the account exists, an administrator will send you reset instructions.">
      {result?.message ? <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert> : null}
      {result?.ok ? null : (
        <Form method="post" className="drv-auth__form">
          <input type="hidden" name="csrfToken" value={data.csrfToken} />
          <Field label="Email">
            <input className="drv-input" name="email" type="email" autoComplete="username" inputMode="email" spellCheck={false} required />
          </Field>
          <div className="drv-actions">
            <button type="submit" className="drv-btn drv-btn--primary drv-btn--block">Request reset</button>
          </div>
        </Form>
      )}
      <p className="drv-auth__links"><a className="drv-link" href="/driver/login">Back to sign in</a></p>
    </AuthCard>
  );
}
