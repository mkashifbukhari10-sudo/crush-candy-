import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { z } from "zod";

import { requireAdmin } from "../auth/admin.server";
import {
  createAccessCode,
  listAccessCodes,
  revokeAccessCode,
} from "../services/admin/access-codes.server";

const actionInput = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("generate") }),
  z.object({ intent: z.literal("revoke"), id: z.string().min(1) }),
]);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdmin(request);
  return { codes: await listAccessCodes() };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await requireAdmin(request);
  const formData = await request.formData();
  const parsed = actionInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return Response.json(
      { created: null, message: "Invalid access-code action." },
      { status: 400 },
    );
  }
  const input = parsed.data;
  const adminId =
    session.onlineAccessInfo?.associated_user.id.toString() ?? session.id;

  if (input.intent === "generate") {
    const created = await createAccessCode(adminId);
    return {
      created,
      message: "Access code generated. Copy it now; it will not be shown again.",
    };
  }

  const revoked = await revokeAccessCode(input.id, adminId);
  return {
    created: null,
    message: revoked
      ? "Access code revoked."
      : "Only an unused active code can be revoked.",
  };
};

export default function AccessCodesPage() {
  const { codes } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <s-page heading="Private-store access codes" inlineSize="large">
      <s-stack direction="block" gap="base">
        <s-section heading="Generate one-time code">
          <s-stack direction="block" gap="base">
            <s-text>
              Codes expire after 24 hours and can approve exactly one Shopify
              customer. Only a keyed hash is stored.
            </s-text>
            <Form method="post">
              <input type="hidden" name="intent" value="generate" />
              <s-button type="submit" variant="primary">
                Generate access code
              </s-button>
            </Form>
            {actionData?.message ? <s-text>{actionData.message}</s-text> : null}
            {actionData?.created ? (
              <div
                role="status"
                style={{
                  border: "1px solid #8a6116",
                  borderRadius: 8,
                  padding: 16,
                  background: "#fff5d6",
                }}
              >
                <p style={{ marginTop: 0 }}>
                  <strong>One-time display:</strong>
                </p>
                <code style={{ fontSize: 18, overflowWrap: "anywhere" }}>
                  {actionData.created.plaintext}
                </code>
                <p style={{ marginBottom: 0 }}>
                  Expires {new Date(actionData.created.expiresAt).toLocaleString()}.
                </p>
              </div>
            ) : null}
          </s-stack>
        </s-section>

        <s-section heading="Recent codes">
          {codes.length === 0 ? (
            <s-text>No access codes have been generated.</s-text>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: 8 }}>Code</th>
                    <th style={{ textAlign: "left", padding: 8 }}>Status</th>
                    <th style={{ textAlign: "left", padding: 8 }}>Expires</th>
                    <th style={{ textAlign: "left", padding: 8 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {codes.map((code) => (
                    <tr key={code.id}>
                      <td style={{ padding: 8 }}>•••• {code.last4}</td>
                      <td style={{ padding: 8 }}>{code.status}</td>
                      <td style={{ padding: 8 }}>
                        {new Date(code.expiresAt).toLocaleString()}
                      </td>
                      <td style={{ padding: 8 }}>
                        {code.status === "ACTIVE" ? (
                          <Form method="post">
                            <input type="hidden" name="intent" value="revoke" />
                            <input type="hidden" name="id" value={code.id} />
                            <s-button type="submit" tone="critical">
                              Revoke
                            </s-button>
                          </Form>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </s-section>
      </s-stack>
    </s-page>
  );
}
