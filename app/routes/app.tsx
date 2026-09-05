import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";

import { requireAdmin } from "../auth/admin.server";
import { getShopifyRuntimeConfig } from "../config/env.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdmin(request);
  const url = new URL(request.url);
  const context = new URLSearchParams();
  for (const key of ["shop", "host", "embedded", "id_token"]) {
    const value = url.searchParams.get(key);
    if (value) context.set(key, value);
  }
  return { apiKey: getShopifyRuntimeConfig().apiKey, adminContext: context.toString() };
};

export default function App() {
  const { apiKey, adminContext } = useLoaderData<typeof loader>();
  const href = (path: string) => adminContext ? `${path}?${adminContext}` : path;

  return (
    <AppProvider embedded apiKey={apiKey}>
      <NavMenu>
        <a href={href("/app")}>Dashboard</a>
        <a href={href("/app/access-codes")}>Access Codes</a>
        <a href={href("/app/drivers")}>Drivers</a>
        <a href={href("/app/dispatch")}>Dispatch</a>
        <a href={href("/app/chat")}>Chat Oversight</a>
        <a href={href("/app/delivery-settings")}>Delivery Settings</a>
        <a href={href("/app/announcements")}>Announcements</a>
        <a href={href("/app/support")}>Support Inbox</a>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
