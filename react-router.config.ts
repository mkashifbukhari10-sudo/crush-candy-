import type { Config } from "@react-router/dev/config";

// Shopify embedded Admin submits actions from admin.shopify.com to the app's
// Railway origin. React Router's single-fetch CSRF guard requires this origin
// to be explicitly allowed before dispatching the route action.
export default {
  allowedActionOrigins: ["admin.shopify.com"],
} satisfies Config;
