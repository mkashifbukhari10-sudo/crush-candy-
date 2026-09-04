import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { handleShopifyWebhook } from "../services/shopify/webhooks.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  return handleShopifyWebhook(request, async ({ shop }) => {
    // Idempotent: deliveries can repeat and can arrive after sessions are gone.
    await db.session.deleteMany({ where: { shop } });
  });
};
