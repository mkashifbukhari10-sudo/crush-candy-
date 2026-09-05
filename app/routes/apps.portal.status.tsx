import type { LoaderFunctionArgs } from "react-router";

import { authenticateCustomerProxy } from "../auth/customer.server";
import { getCustomerApprovalState } from "../services/customer/approval.server";

const PRIVATE_HEADERS = { "cache-control": "no-store, private" };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await authenticateCustomerProxy(request);
  if (!context.shopifyCustomerId) {
    return Response.json(
      { authenticated: false, approved: false },
      { status: 401, headers: PRIVATE_HEADERS },
    );
  }
  const state = await getCustomerApprovalState(
    context.admin,
    context.shopifyCustomerId,
  );
  return Response.json(
    { authenticated: true, approved: state.approved },
    { headers: PRIVATE_HEADERS },
  );
};
