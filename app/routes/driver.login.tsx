import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData, useSearchParams } from "react-router";
import { z } from "zod";

import { Alert, AuthCard, Field } from "../components/driver/ui";
import { createDriverCsrfToken, verifyDriverCsrfToken } from "../lib/driver-security.server";
import { DriverAuthenticationError, DriverRateLimitError } from "../lib/errors.server";
import { loginDriver } from "../services/driver/auth.server";

const inputSchema = z.object({ email: z.string().trim().email(), password: z.string().min(1), csrfToken: z.string().min(1), returnTo: z.string().optional() });

export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  return { csrfToken: createDriverCsrfToken("login"), returnTo: safeReturnTo(url.searchParams.get("returnTo")) };
}

function safeReturnTo(value: string | null | undefined): string {
  return value && value.startsWith("/driver/") && !value.startsWith("//") ? value : "/driver";
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const parsed = inputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success || !verifyDriverCsrfToken(parsed.data.csrfToken, "login")) return { ok: false, message: "This login form expired. Refresh and try again." };
  try {
    const result = await loginDriver({ email: parsed.data.email, password: parsed.data.password, request });
    throw redirect(safeReturnTo(parsed.data.returnTo), { headers: result.responseHeaders });
  } catch (error) {
    if (error instanceof DriverRateLimitError) return Response.json({ ok: false, message: "Too many attempts. Try again later." }, { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } });
    if (error instanceof DriverAuthenticationError) return { ok: false, message: "Invalid email or password." };
    throw error;
  }
}

export default function DriverLogin() {
  const [params] = useSearchParams();
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const returnTo = params.get("returnTo") ?? "/driver";
  return (
    <AuthCard title="Sign in">
      {actionData?.message ? <Alert tone="error">{actionData.message}</Alert> : null}
      <Form method="post" className="drv-auth__form">
        <input type="hidden" name="csrfToken" value={loaderData.csrfToken} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <Field label="Email">
          <input className="drv-input" name="email" type="email" autoComplete="username" inputMode="email" spellCheck={false} required />
        </Field>
        <Field label="Password">
          <input className="drv-input" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <div className="drv-actions">
          <button type="submit" className="drv-btn drv-btn--primary drv-btn--block">Sign in</button>
        </div>
      </Form>
      <p className="drv-auth__links"><a className="drv-link" href="/driver/forgot-password">Forgot password?</a></p>
    </AuthCard>
  );
}
