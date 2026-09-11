import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { requireDriver } from "../auth/driver.server";
import { logoutDriver, requireDriverCsrf } from "../services/driver/auth.server";

export async function action({ request }: ActionFunctionArgs) {
  const auth = await requireDriver(request);
  const formData = await request.formData();
  requireDriverCsrf(request, auth, String(formData.get("csrfToken") ?? ""));
  const headers = await logoutDriver(request);
  throw redirect("/driver/login", { headers });
}

// GET is never a logout. It redirects to the portal, so this route renders nothing.
export async function loader() { throw redirect("/driver"); }
