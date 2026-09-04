import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";

import db from "../db.server";
import { handleShopifyWebhook } from "../services/shopify/webhooks.server";
import { parseInput } from "../utils/validation";

const scopesUpdatePayload = z.object({
  current: z.array(z.string()),
});

export const action = async ({ request }: ActionFunctionArgs) => {
  return handleShopifyWebhook(request, async ({ payload, session }) => {
    if (session) {
      const { current } = parseInput(scopesUpdatePayload, payload);
      await db.session.updateMany({
        where: { id: session.id },
        data: { scope: current.join(",") },
      });
    }
  });
};
