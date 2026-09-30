import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { z } from "zod";

import { authenticateCustomerProxy } from "../auth/customer.server";
import { CustomerAuthenticationError } from "../lib/errors.server";
import { RateLimitExceededError } from "../lib/rate-limit.server";
import {
  createCustomerCsrfToken,
  verifyCustomerCsrfToken,
} from "../lib/access-code-security.server";
import {
  AccessCodeRedemptionError,
  redeemAccessCode,
} from "../services/customer/access-code.server";
import { getCustomerApprovalState } from "../services/customer/approval.server";
import { getRequestIp } from "../services/customer/rate-limit.server";

const redemptionInput = z.object({
  accessCode: z.string().trim().min(8).max(64),
  csrfToken: z.string().min(1),
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await authenticateCustomerProxy(request);
  if (!context.shopifyCustomerId) {
    return {
      authenticated: false,
      approved: false,
      csrfToken: null,
      shop: context.shop,
    };
  }
  const state = await getCustomerApprovalState(
    context.admin,
    context.shopifyCustomerId,
  );
  return {
    authenticated: true,
    approved: state.approved,
    csrfToken: state.approved
      ? null
      : createCustomerCsrfToken(context.shop, context.shopifyCustomerId),
    shop: context.shop,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const context = await authenticateCustomerProxy(request);
  if (!context.shopifyCustomerId) {
    return Response.json(
      { ok: false, message: "Log in before redeeming an access code." },
      { status: 401 },
    );
  }

  const formData = await request.formData();
  const parsed = redemptionInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return Response.json(
      { ok: false, message: "Enter a valid access code and try again." },
      { status: 400 },
    );
  }
  const input = parsed.data;
  if (
    !verifyCustomerCsrfToken(
      input.csrfToken,
      context.shop,
      context.shopifyCustomerId,
    )
  ) {
    return Response.json(
      { ok: false, message: "This form expired. Refresh and try again." },
      { status: 403 },
    );
  }

  try {
    const result = await redeemAccessCode({
      admin: context.admin,
      code: input.accessCode,
      ipAddress: getRequestIp(request),
      shopifyCustomerId: context.shopifyCustomerId,
    });
    return {
      ok: true,
      message:
        result.status === "ALREADY_APPROVED"
          ? "Your customer account is already approved."
          : "Access approved. You can now enter the store.",
    };
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return Response.json(
        { ok: false, message: "Too many attempts. Please try again later." },
        {
          status: 429,
          headers: { "retry-after": String(error.retryAfterSeconds) },
        },
      );
    }
    if (error instanceof AccessCodeRedemptionError) {
      return Response.json(
        { ok: false, message: error.message },
        { status: 400 },
      );
    }
    if (error instanceof CustomerAuthenticationError) {
      return Response.json(
        { ok: false, message: "Customer authentication failed." },
        { status: 401 },
      );
    }
    throw error;
  }
};

export default function CustomerOnboarding() {
  const state = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const returnTo = encodeURIComponent("/apps/portal/onboarding");

  if (!state.authenticated) {
    return (
      <>
        <p className="ccs-eyebrow">Private store access</p>
        <h1 className="ccs-title">Log in first</h1>
        <p className="ccs-lead">An access code can only approve a signed-in Shopify customer.</p>
        <div className="ccs-actions">
          <a className="ccs-btn ccs-btn--primary" href={`https://${state.shop}/account/login?return_url=${returnTo}`}>
            Log in to your customer account
          </a>
        </div>
      </>
    );
  }

  if (state.approved || actionData?.ok) {
    return (
      <>
        <p className="ccs-eyebrow">Private store access</p>
        <h1 className="ccs-title">Access approved</h1>
        <p className="ccs-alert ccs-alert--success" role="status">{actionData?.message ?? "Your customer account is already approved."}</p>
        <div className="ccs-actions">
          <a className="ccs-btn ccs-btn--primary" href={`https://${state.shop}`}>Continue to the store</a>
        </div>
      </>
    );
  }

  return (
    <>
      <p className="ccs-eyebrow">Private store access</p>
      <h1 className="ccs-title">Enter your access code</h1>
      <p className="ccs-lead">Each code works once and expires 24 hours after it is issued.</p>
      <section className="ccs-card" aria-label="Access code">
        {actionData?.message ? <p className="ccs-alert ccs-alert--error" role="alert" id="accessCode-error">{actionData.message}</p> : null}
        <Form method="post">
          <input type="hidden" name="csrfToken" value={state.csrfToken ?? ""} />
          <div className="ccs-field">
            <label className="ccs-field__label" htmlFor="accessCode">Access code</label>
            <input
              id="accessCode"
              className="ccs-input ccs-input--code"
              name="accessCode"
              type="text"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              required
              minLength={8}
              maxLength={64}
              aria-describedby={actionData?.message ? "accessCode-hint accessCode-error" : "accessCode-hint"}
            />
            <span className="ccs-field__hint" id="accessCode-hint">Codes look like CCS-XXXX-XXXX-XXXX-XXXX-XXXX.</span>
          </div>
          <div className="ccs-actions">
            <button type="submit" className="ccs-btn ccs-btn--primary">Approve my account</button>
          </div>
        </Form>
      </section>
    </>
  );
}
