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
        <h1>Log in first</h1>
        <p>An access code can only approve a signed-in Shopify customer.</p>
        <a href={`https://${state.shop}/account/login?return_url=${returnTo}`}>
          Log in to your customer account
        </a>
      </>
    );
  }

  if (state.approved || actionData?.ok) {
    return (
      <>
        <h1>Access approved</h1>
        <p>{actionData?.message ?? "Your customer account is already approved."}</p>
        <a href={`https://${state.shop}`}>Continue to the store</a>
      </>
    );
  }

  return (
    <>
      <h1>Enter your access code</h1>
      <p>Codes are single-use and expire 24 hours after they are issued.</p>
      {actionData?.message ? <p role="alert">{actionData.message}</p> : null}
      <Form method="post">
        <input type="hidden" name="csrfToken" value={state.csrfToken ?? ""} />
        <label htmlFor="accessCode">Access code</label>
        <input
          id="accessCode"
          name="accessCode"
          type="text"
          autoComplete="one-time-code"
          required
          minLength={8}
          maxLength={64}
          style={{ display: "block", width: "100%", padding: 12, margin: "8px 0 16px" }}
        />
        <button type="submit" style={{ padding: "12px 20px", cursor: "pointer" }}>
          Approve my account
        </button>
      </Form>
    </>
  );
}
