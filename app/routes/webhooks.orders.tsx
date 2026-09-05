import type { ActionFunctionArgs } from "react-router";
import { syncShopifyOrder } from "../services/dispatch.server";
import { handleShopifyWebhook } from "../services/shopify/webhooks.server";

export const action = async ({ request }: ActionFunctionArgs) =>
  handleShopifyWebhook(request, async ({ payload, topic }) => {
    await syncShopifyOrder(payload, `shopify:${topic}`);
  });
