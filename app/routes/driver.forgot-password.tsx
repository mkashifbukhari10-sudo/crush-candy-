import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { z } from "zod";

import { createDriverCsrfToken, verifyDriverCsrfToken } from "../lib/driver-security.server";
import { DriverRateLimitError } from "../lib/errors.server";
import { requestPasswordReset } from "../services/driver/auth.server";

const schema = z.object({ email: z.string().trim().email(), csrfToken: z.string().min(1) });
export function loader(_args: LoaderFunctionArgs) { void _args; return { csrfToken: createDriverCsrfToken("reset-request") }; }
export async function action({ request }: ActionFunctionArgs) { const parsed = schema.safeParse(Object.fromEntries(await request.formData())); if (!parsed.success || !verifyDriverCsrfToken(parsed.data.csrfToken, "reset-request")) return { message: "This form expired. Refresh and try again." }; try { await requestPasswordReset({ email: parsed.data.email, request }); return { message: "If that account exists, reset instructions will be sent by an administrator." }; } catch (error) { if (error instanceof DriverRateLimitError) return { message: "Too many requests. Try again later." }; throw error; } }
export default function ForgotPassword() { const data = useLoaderData<typeof loader>(); const result = useActionData<typeof action>(); return <main style={{ maxWidth: 460, margin: "0 auto", padding: "72px 20px" }}><section style={{ background: "white", padding: 28, borderRadius: 12 }}><h1>Reset driver password</h1><p>Enter your email. If the account exists, an administrator will issue reset instructions.</p>{result?.message ? <p role="status">{result.message}</p> : null}<Form method="post"><input type="hidden" name="csrfToken" value={data.csrfToken} /><label>Email<input name="email" type="email" autoComplete="username" required /></label><button type="submit">Request reset</button></Form></section></main>; }
