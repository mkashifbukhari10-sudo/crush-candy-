import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData, useSearchParams } from "react-router";
import { z } from "zod";

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
  return <main style={{ maxWidth: 460, margin: "0 auto", padding: "72px 20px" }}><section style={{ background: "white", padding: 28, borderRadius: 12 }}><p style={{ textTransform: "uppercase", letterSpacing: ".12em", fontSize: 12 }}>Crush Candy Supplies</p><h1>Driver sign in</h1>{actionData?.message ? <p role="alert">{actionData.message}</p> : null}<Form method="post"><input type="hidden" name="csrfToken" value={loaderData.csrfToken} /><input type="hidden" name="returnTo" value={returnTo} /><label>Email<input name="email" type="email" autoComplete="username" required /></label><label>Password<input name="password" type="password" autoComplete="current-password" required /></label><button type="submit">Sign in</button></Form><p><a href="/driver/forgot-password">Forgot password?</a></p></section></main>;
}
