import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
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
