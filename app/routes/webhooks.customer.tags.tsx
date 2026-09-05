import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";

import { toShopifyCustomerGid } from "../auth/customer.server";
import { reconcileCustomerTagWebhook } from "../services/customer/approval.server";
import { handleShopifyWebhook } from "../services/shopify/webhooks.server";
import { parseInput } from "../utils/validation";

const customerTagsPayload = z.object({
  customerId: z.string().min(1),
  tags: z.array(z.string()),
  occurredAt: z.iso.datetime(),
});

export const action = async ({ request }: ActionFunctionArgs) => {
  return handleShopifyWebhook(request, async ({ payload }) => {
    const parsed = parseInput(customerTagsPayload, payload);
    await reconcileCustomerTagWebhook(
      toShopifyCustomerGid(parsed.customerId),
      parsed.tags,
      new Date(parsed.occurredAt),
    );
  });
};
