import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData } from "react-router";
import { z } from "zod";

import { createDriverCsrfToken, verifyDriverCsrfToken } from "../lib/driver-security.server";
import { DriverAuthenticationError } from "../lib/errors.server";
import { activateDriver } from "../services/driver/auth.server";

const schema = z.object({ token: z.string().min(20), password: z.string().min(12), csrfToken: z.string().min(1) });

export function loader({ request }: LoaderFunctionArgs) { return { token: new URL(request.url).searchParams.get("token") ?? "", csrfToken: createDriverCsrfToken("activation") }; }
export async function action({ request }: ActionFunctionArgs) {
  const data = Object.fromEntries(await request.formData());
  const parsed = schema.safeParse(data);
  if (!parsed.success || !verifyDriverCsrfToken(parsed.data.csrfToken, "activation")) return { ok: false, message: "This activation form expired. Refresh and try again." };
  try { const session = await activateDriver({ token: parsed.data.token, password: parsed.data.password, request }); throw redirect("/driver", { headers: session.responseHeaders }); } catch (error) { if (error instanceof DriverAuthenticationError || error instanceof Error) return { ok: false, message: "This activation link is invalid, expired, or the password is not acceptable." }; throw error; }
}

export default function DriverActivate() { const data = useLoaderData<typeof loader>(); const result = useActionData<typeof action>(); return <main style={{ maxWidth: 460, margin: "0 auto", padding: "72px 20px" }}><section style={{ background: "white", padding: 28, borderRadius: 12 }}><h1>Activate driver account</h1><p>Choose a password of at least 12 characters.</p>{result?.message ? <p role="alert">{result.message}</p> : null}<Form method="post"><input type="hidden" name="token" value={data.token} /><input type="hidden" name="csrfToken" value={data.csrfToken} /><label>Password<input name="password" type="password" minLength={12} autoComplete="new-password" required /></label><button type="submit">Activate account</button></Form></section></main>; }
