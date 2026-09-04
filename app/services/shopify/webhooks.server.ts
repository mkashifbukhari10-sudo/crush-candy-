import { authenticate } from "../../shopify.server";
import { safeInternalErrorResponse } from "../../lib/errors.server";
import { logger } from "../../lib/logger.server";
import {
  getRequestId,
  requestIdHeaders,
} from "../../lib/request-context.server";

type VerifiedWebhook = Awaited<ReturnType<typeof authenticate.webhook>>;
type VerifiedWebhookHandler = (
  webhook: VerifiedWebhook & { requestId: string },
) => Promise<void>;

/**
 * Authenticates first so invalid HMACs retain Shopify's official 401 response,
 * then invokes a handler with safe metadata. Payloads are never logged here.
 */
export async function handleShopifyWebhook(
  request: Request,
  handler: VerifiedWebhookHandler,
): Promise<Response> {
  const requestId = getRequestId(request);
  const webhook = await authenticate.webhook(request);

  logger.info("shopify.webhook_received", {
    requestId,
    shop: webhook.shop,
    topic: webhook.topic,
  });

  try {
    await handler({ ...webhook, requestId });
    return new Response(null, {
      status: 204,
      headers: requestIdHeaders(requestId),
    });
  } catch (error) {
    logger.error("shopify.webhook_failed", {
      requestId,
      shop: webhook.shop,
      topic: webhook.topic,
      error,
    });
    return safeInternalErrorResponse(requestId);
  }
}

