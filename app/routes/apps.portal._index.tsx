import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

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

const AREAS = [
  ["/apps/portal/orders", "Orders & delivery status", "Track your orders and open the delivery chat."],
  ["/apps/portal/delivery", "Delivery charges", "Minimum order and distance-based delivery pricing."],
  ["/apps/portal/help", "Help & support", "Guided answers, or send our team a message."],
  ["/apps/portal/announcements", "Announcements", "Updates from Crush Candy Supplies."],
] as const;

export default function PortalIndex() {
  const state = useLoaderData<typeof loader>();
  const returnTo = encodeURIComponent("/apps/portal");

  if (!state.authenticated) {
    return (
      <>
        <p className="ccs-eyebrow">Private store</p>
        <h1 className="ccs-title">Customer login required</h1>
        <p className="ccs-lead">This private store is available only to approved customers.</p>
        <div className="ccs-actions">
          <a className="ccs-btn ccs-btn--primary" href={`https://${state.shop}/account/login?return_url=${returnTo}`}>Log in to continue</a>
        </div>
      </>
    );
  }

  if (!state.approved) {
    return (
      <>
        <p className="ccs-eyebrow">Private store</p>
        <h1 className="ccs-title">Approval required</h1>
        <p className="ccs-lead">Your customer account is signed in but is not yet approved.</p>
        <div className="ccs-actions">
          <a className="ccs-btn ccs-btn--primary" href="/apps/portal/onboarding">Enter an access code</a>
        </div>
      </>
    );
  }

  return (
    <>
      <p className="ccs-eyebrow">Your account</p>
      <h1 className="ccs-title">Welcome back</h1>
      <p className="ccs-lead">Your account is approved. You do not need another access code.</p>
      <ul className="ccs-links">
        {AREAS.map(([href, title, meta]) => (
          <li key={href}>
            <a className="ccs-link-card" href={href}>
              <span className="ccs-link-card__title">{title}</span>
              <span className="ccs-link-card__meta">{meta}</span>
            </a>
          </li>
        ))}
      </ul>
      <div className="ccs-actions">
        <a className="ccs-btn ccs-btn--secondary" href={`https://${state.shop}`}>Continue shopping</a>
      </div>
    </>
  );
}
