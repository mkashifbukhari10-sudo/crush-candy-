import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { StatCard } from "../components/admin/StatCard";
import { APP_NAME } from "../config/constants";
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

const QUICK_ACTIONS = [
  ["Generate access code", "/app/access-codes"],
  ["Invite a driver", "/app/drivers"],
  ["Assign & schedule orders", "/app/dispatch"],
  ["Chat oversight", "/app/chat"],
  ["Support inbox", "/app/support"],
  ["Announcements", "/app/announcements"],
  ["Delivery settings", "/app/delivery-settings"],
] as const;

export default function Index() {
  const status = useLoaderData<typeof loader>();
  const withContext = (path: string) => (status.adminContext ? `${path}?${status.adminContext}` : path);
  // Counts are only meaningful when the database answered; otherwise show "—", never a fake 0.
  const value = (n: number) => (status.databaseConnected ? n : null);
  const m = status.metrics;

  // Derived only from counts the loader already returns — nothing new is queried.
  const attention = status.databaseConnected
    ? ([
        [m.pendingOrders, m.pendingOrders === 1 ? "order waiting for assignment or scheduling" : "orders waiting for assignment or scheduling", "Open dispatch", "/app/dispatch"],
        [m.openTickets, m.openTickets === 1 ? "open support request" : "open support requests", "Open support inbox", "/app/support"],
      ] as const).filter(([count]) => count > 0)
    : [];

  return (
    <s-page heading={APP_NAME} inlineSize="large">
      <s-stack direction="block" gap="base">
        {!status.databaseConnected ? (
          <s-banner tone="critical">The database is not reachable, so operational counts are unavailable. Try again shortly.</s-banner>
        ) : null}

        <s-section heading="Needs attention">
          {attention.length === 0 ? (
            <s-text>{status.databaseConnected ? "Nothing needs attention right now." : "Unavailable while the database is unreachable."}</s-text>
          ) : (
            <ul className="adm-attention">
              {attention.map(([count, text, cta, path]) => (
                <li key={path}>
                  <Link to={withContext(path)}>
                    <span>{count} {text}</span>
                    <span className="adm-attention__go">{cta} →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </s-section>

        <s-section heading="Operations">
          <div className="adm-stats">
            <StatCard label="Pending orders" value={value(m.pendingOrders)} to={withContext("/app/dispatch")} />
            <StatCard label="Scheduled deliveries" value={value(m.scheduledDeliveries)} to={withContext("/app/dispatch")} />
            <StatCard label="Active drivers" value={value(m.activeDrivers)} to={withContext("/app/drivers")} />
            <StatCard label="Open support" value={value(m.openTickets)} to={withContext("/app/support")} />
            <StatCard label="Active chats" value={value(m.activeConversations)} to={withContext("/app/chat")} />
            <StatCard label="Active access codes" value={value(m.activeAccessCodes)} to={withContext("/app/access-codes")} />
          </div>
        </s-section>

        <s-section heading="Quick actions">
          <nav className="adm-actions" aria-label="Quick actions">
            {QUICK_ACTIONS.map(([label, path]) => (
              <Link key={path + label} to={withContext(path)}>{label}</Link>
            ))}
          </nav>
        </s-section>

        <s-section heading="System">
          <div className="adm-system">
            <s-badge tone={status.appConnected ? "success" : "critical"}>App · {status.appConnected ? "Connected" : "Unavailable"}</s-badge>
            <s-badge tone={status.databaseConnected ? "success" : "critical"}>Database · {status.databaseConnected ? "Connected" : "Unavailable"}</s-badge>
            <s-badge tone="info">Environment · {status.environment}</s-badge>
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
