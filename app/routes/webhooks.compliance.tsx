import type { ActionFunctionArgs } from "react-router";

import { logger } from "../lib/logger.server";
import { handleShopifyWebhook } from "../services/shopify/webhooks.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  return handleShopifyWebhook(request, async ({ requestId, shop, topic }) => {
    // Milestone 0 stores Shopify sessions only, so there is no customer feature
    // data to export or redact. Full data-subject workflows are DEFERRED TO M8
    // and must be implemented before later milestones persist customer data.
    logger.info("shopify.compliance_webhook_acknowledged", {
      requestId,
      shop,
      topic,
    });
  });
};
