import type { ActionFunctionArgs } from "react-router";

import { logger } from "../lib/logger.server";
import {
  redactCustomerM1Data,
  redactShopM1Data,
} from "../services/customer/compliance.server";
import { handleShopifyWebhook } from "../services/shopify/webhooks.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  return handleShopifyWebhook(request, async ({ payload, requestId, shop, topic }) => {
    if (topic === "CUSTOMERS_REDACT") {
      await redactCustomerM1Data(payload);
    } else if (topic === "SHOP_REDACT") {
      await redactShopM1Data();
    }

    // DATA_REQUEST contains no additional M1 PII beyond the customer GID.
    // Shopify expects an authenticated acknowledgement; no payload is logged.
    logger.info("shopify.compliance_webhook_acknowledged", {
      requestId,
      shop,
      topic,
    });
  });
};
