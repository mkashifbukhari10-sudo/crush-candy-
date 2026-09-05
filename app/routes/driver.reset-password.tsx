import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData } from "react-router";
import { z } from "zod";

import { createDriverCsrfToken, verifyDriverCsrfToken } from "../lib/driver-security.server";
import { DriverAuthenticationError } from "../lib/errors.server";
import { resetPassword } from "../services/driver/auth.server";

const schema = z.object({ token: z.string().min(20), password: z.string().min(12), csrfToken: z.string().min(1) });
export function loader({ request }: LoaderFunctionArgs) { return { token: new URL(request.url).searchParams.get("token") ?? "", csrfToken: createDriverCsrfToken("reset") }; }
export async function action({ request }: ActionFunctionArgs) { const parsed = schema.safeParse(Object.fromEntries(await request.formData())); if (!parsed.success || !verifyDriverCsrfToken(parsed.data.csrfToken, "reset")) return { message: "This reset form expired. Refresh and try again." }; try { await resetPassword({ token: parsed.data.token, password: parsed.data.password, request }); throw redirect("/driver/login"); } catch (error) { if (error instanceof DriverAuthenticationError || error instanceof Error) return { message: "This reset link is invalid, expired, or the password is not acceptable." }; throw error; } }
export default function ResetPassword() { const data = useLoaderData<typeof loader>(); const result = useActionData<typeof action>(); return <main style={{ maxWidth: 460, margin: "0 auto", padding: "72px 20px" }}><section style={{ background: "white", padding: 28, borderRadius: 12 }}><h1>Choose a new password</h1>{result?.message ? <p role="alert">{result.message}</p> : null}<Form method="post"><input type="hidden" name="token" value={data.token} /><input type="hidden" name="csrfToken" value={data.csrfToken} /><label>New password<input name="password" type="password" minLength={12} autoComplete="new-password" required /></label><button type="submit">Reset password</button></Form></section></main>; }
