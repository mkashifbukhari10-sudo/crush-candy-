import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { getShopifyRuntimeConfig } from "./config/env.server";

const runtime = getShopifyRuntimeConfig();

const shopify = shopifyApp({
  apiKey: runtime.apiKey,
  apiSecretKey: runtime.apiSecretKey,
  apiVersion: ApiVersion.July26,
  scopes: runtime.scopes,
  appUrl: runtime.appUrl,
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.SingleMerchant,
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(runtime.customShopDomains
    ? { customShopDomains: runtime.customShopDomains }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
