import type { ActionFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData, useNavigation } from "react-router";

import { Alert, Card, PageHeader } from "../components/driver/ui";
import { createDriverCsrfToken } from "../lib/driver-security.server";
import { requireDriver } from "../auth/driver.server";
import { logoutDriver, requireDriverCsrf } from "../services/driver/auth.server";

export async function loader({ request }: ActionFunctionArgs) {
  try {
    const auth = await requireDriver(request);
    return { csrfToken: createDriverCsrfToken(auth.context.sessionId) };
  } catch {
    throw redirect("/driver/login");
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const auth = await requireDriver(request);
  const data = await request.formData();
  requireDriverCsrf(request, auth, String(data.get("csrfToken") ?? ""));
  throw redirect("/driver/login", { headers: await logoutDriver(request, true) });
}

export default function LogoutAll() {
  const data = useLoaderData<typeof loader>();
  const busy = useNavigation().state !== "idle";

  return (
    <>
      <PageHeader back={{ to: "/driver/account", label: "Account" }} title="Log out everywhere?" />
      <Alert tone="info">This signs you out on every device, including this one. You will need your password to sign back in.</Alert>
      <Card>
        <Form method="post">
          <input type="hidden" name="csrfToken" value={data.csrfToken} />
          <button type="submit" className="drv-btn drv-btn--primary drv-btn--block" disabled={busy}>
            {busy ? "Signing out…" : "Log out everywhere"}
          </button>
        </Form>
      </Card>
    </>
  );
}
