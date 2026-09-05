import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { getServerEnvironment } from "../config/env.server";
import { CustomerAuthenticationError } from "../lib/errors.server";

const NUMERIC_CUSTOMER_ID = /^\d+$/;
const CUSTOMER_GID = /^gid:\/\/shopify\/Customer\/\d+$/;

export interface CustomerProxyContext {
  readonly plane: "customer";
  readonly shop: string;
  readonly shopifyCustomerId: string | null;
  readonly admin: AdminApiContext;
}

export interface CustomerAuthContext extends CustomerProxyContext {
  readonly shopifyCustomerId: string;
}

export function toShopifyCustomerGid(customerId: string | number): string {
  const value = String(customerId);
  if (CUSTOMER_GID.test(value)) return value;
  if (!NUMERIC_CUSTOMER_ID.test(value)) {
    throw new CustomerAuthenticationError("Invalid Shopify customer identity");
  }
  return `gid://shopify/Customer/${value}`;
}

export async function authenticateCustomerProxy(
  request: Request,
): Promise<CustomerProxyContext> {
  const proxy = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const signedShop = url.searchParams.get("shop");
  const rawCustomerId = url.searchParams.get("logged_in_customer_id");

  if (!proxy.session || !proxy.admin || !signedShop) {
    throw new Response("Store connection unavailable", { status: 503 });
  }

  if (proxy.session.shop !== signedShop) {
    throw new CustomerAuthenticationError("Shop identity mismatch");
  }

  const configuredShop = getServerEnvironment().SHOPIFY_STORE_DOMAIN;
  if (configuredShop && configuredShop !== signedShop) {
    throw new CustomerAuthenticationError("Unexpected Shopify store");
  }

  return {
    plane: "customer",
    shop: signedShop,
    shopifyCustomerId: rawCustomerId
      ? toShopifyCustomerGid(rawCustomerId)
      : null,
    admin: proxy.admin,
  };
}

export async function requireCustomer(
  request: Request,
): Promise<CustomerAuthContext> {
  const context = await authenticateCustomerProxy(request);
  if (!context.shopifyCustomerId) throw new CustomerAuthenticationError();
  return context as CustomerAuthContext;
}
