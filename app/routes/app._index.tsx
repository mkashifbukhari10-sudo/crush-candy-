import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { APP_NAME, APP_PHASE } from "../config/constants";
import { getFoundationStatus } from "../services/admin/foundation.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const status = await getFoundationStatus(request);
  // Embedded Admin navigations must retain Shopify's launch context. Without
  // these parameters, a full navigation to a child route cannot establish the
  // shop/session binding and Shopify renders its generic error page.
  const url = new URL(request.url);
  const context = new URLSearchParams();
  for (const key of ["shop", "host", "embedded", "id_token"]) {
    const value = url.searchParams.get(key);
    if (value) context.set(key, value);
  }
  return { ...status, adminContext: context.toString() };
};

export default function Index() {
  const status = useLoaderData<typeof loader>();
  const withContext = (path: string) =>
    status.adminContext ? `${path}?${status.adminContext}` : path;
  const metrics = status.metrics;
  const actions = [
    ["Access Codes", "Create and revoke private-store codes", "/app/access-codes"],
    ["Drivers", "Manage driver accounts and sessions", "/app/drivers"],
    ["Dispatch", "Assign and schedule operational orders", "/app/dispatch"],
    ["Chat Oversight", "Review customer-driver conversations", "/app/chat"],
    ["Delivery Settings", "Manage delivery rules and pricing", "/app/delivery-settings"],
    ["Announcements", "Publish customer and driver notices", "/app/announcements"],
    ["Support Inbox", "Respond to customer support requests", "/app/support"],
  ] as const;

  return (
    <s-page heading={APP_NAME} inlineSize="large">
      <s-stack direction="block" gap="base">
        <s-section heading={APP_PHASE}>
          <s-stack direction="block" gap="base">
            <s-text>{status.milestone}</s-text>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              <s-badge tone={status.appConnected ? "success" : "critical"}>App · {status.appConnected ? "Connected" : "Unavailable"}</s-badge>
              <s-badge tone={status.databaseConnected ? "success" : "critical"}>Database · {status.databaseConnected ? "Connected" : "Unavailable"}</s-badge>
              <s-badge tone="info">Environment · {status.environment}</s-badge>
            </div>
          </s-stack>
        </s-section>
        <s-section heading="Operational overview">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            {[
              ["Active drivers", metrics.activeDrivers],
              ["Pending orders", metrics.pendingOrders],
              ["Scheduled deliveries", metrics.scheduledDeliveries],
              ["Open support", metrics.openTickets],
              ["Active chats", metrics.activeConversations],
              ["Active access codes", metrics.activeAccessCodes],
            ].map(([label, value]) => <div key={label} style={{ border: "1px solid #e1e3e5", borderRadius: 8, padding: 16, background: "#fff" }}><s-text>{label}</s-text><div style={{ fontSize: 28, fontWeight: 650, marginTop: 8 }}>{value}</div></div>)}
          </div>
        </s-section>
        <s-section heading="Quick actions">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            {actions.map(([title, description, path]) => <Link key={path} to={withContext(path)} style={{ display: "block", border: "1px solid #e1e3e5", borderRadius: 8, padding: 16, color: "inherit", textDecoration: "none", background: "#fff" }}><strong>{title}</strong><div style={{ marginTop: 6, color: "#616161", fontSize: 14 }}>{description}</div></Link>)}
          </div>
        </s-section>
      </s-stack>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
