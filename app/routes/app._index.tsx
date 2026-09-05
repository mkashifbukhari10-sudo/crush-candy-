import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { APP_NAME, APP_PHASE } from "../config/constants";
import { getFoundationStatus } from "../services/admin/foundation.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return getFoundationStatus(request);
};

export default function Index() {
  const status = useLoaderData<typeof loader>();

  return (
    <s-page heading={APP_NAME} inlineSize="small">
      <s-section heading={APP_PHASE}>
        <s-stack direction="block" gap="base">
          <s-heading>{status.milestone}</s-heading>
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-text type="strong">App</s-text>
            <s-badge tone="success">
              {status.appConnected ? "Connected" : "Unavailable"}
            </s-badge>
          </s-stack>
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-text type="strong">Database</s-text>
            <s-badge tone={status.databaseConnected ? "success" : "critical"}>
              {status.databaseConnected ? "Connected" : "Unavailable"}
            </s-badge>
          </s-stack>
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-text type="strong">Environment</s-text>
            <s-text>{status.environment}</s-text>
          </s-stack>
          <Link to="/app/access-codes">Manage private-store access codes</Link>
          <Link to="/app/drivers">Manage driver accounts</Link>
          <Link to="/app/dispatch">Manage dispatch</Link>
          <Link to="/app/chat">Chat oversight</Link>
          <Link to="/app/delivery-settings">Delivery settings</Link>
          <Link to="/app/announcements">Announcements</Link>
          <Link to="/app/support">Support inbox</Link>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
