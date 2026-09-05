import type { ActionFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData } from "react-router";

import { createDriverCsrfToken } from "../lib/driver-security.server";
import { requireDriver } from "../auth/driver.server";
import { logoutDriver, requireDriverCsrf } from "../services/driver/auth.server";

export async function loader({ request }: ActionFunctionArgs) { try { const auth = await requireDriver(request); return { csrfToken: createDriverCsrfToken(auth.context.sessionId) }; } catch { throw redirect("/driver/login"); } }
export async function action({ request }: ActionFunctionArgs) { const auth = await requireDriver(request); const data = await request.formData(); requireDriverCsrf(request, auth, String(data.get("csrfToken") ?? "")); throw redirect("/driver/login", { headers: await logoutDriver(request, true) }); }
export default function LogoutAll() { const data = useLoaderData<typeof loader>(); return <main style={{ maxWidth: 460, margin: "0 auto", padding: "72px 20px" }}><h1>Log out everywhere?</h1><p>This revokes every active driver session.</p><Form method="post"><input type="hidden" name="csrfToken" value={data.csrfToken} /><button type="submit">Log out everywhere</button></Form></main>; }
