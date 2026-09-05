import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";

import { authenticateCustomerProxy } from "../auth/customer.server";
import { getCustomerApprovalState } from "../services/customer/approval.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await authenticateCustomerProxy(request);
  if (!context.shopifyCustomerId) {
    return { authenticated: false, approved: false, shop: context.shop };
  }
  const state = await getCustomerApprovalState(
    context.admin,
    context.shopifyCustomerId,
  );
  return { authenticated: true, approved: state.approved, shop: context.shop };
};

export default function PortalIndex() {
  const state = useLoaderData<typeof loader>();
  const returnTo = encodeURIComponent("/apps/portal");

  if (!state.authenticated) {
    return (
      <>
        <h1>Customer login required</h1>
        <p>This private store is available only to approved customers.</p>
        <a href={`https://${state.shop}/account/login?return_url=${returnTo}`}>
          Log in to continue
        </a>
      </>
    );
  }

  if (!state.approved) {
    return (
      <>
        <h1>Approval required</h1>
        <p>Your customer account is signed in but is not yet approved.</p>
        <Link to="/apps/portal/onboarding">Enter an access code</Link>
      </>
    );
  }

  return (
    <>
      <h1>Access approved</h1>
      <p>Your approval is active. You do not need another access code.</p>
      <p><Link to="/apps/portal/orders">View delivery status</Link></p>
      <p><Link to="/apps/portal/delivery">View delivery charges and minimum order</Link></p>
      <p><Link to="/apps/portal/announcements">Announcements</Link></p>
      <p><Link to="/apps/portal/help">Help &amp; support</Link></p>
      <a href={`https://${state.shop}`}>Continue to the store</a>
    </>
  );
}
