import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { type EntryContext } from "react-router";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";
import { logger } from "./lib/logger.server";
import { getRequestId } from "./lib/request-context.server";
import { startApprovalReconciliationScheduler } from "./services/customer/approval-reconciliation.server";

startApprovalReconciliationScheduler();

export const streamTimeout = 5000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext
) {
  const requestId = getRequestId(request);
  addDocumentResponseHeaders(request, responseHeaders);
  responseHeaders.set("x-request-id", requestId);
  responseHeaders.set("x-content-type-options", "nosniff");
  responseHeaders.set("referrer-policy", "strict-origin-when-cross-origin");
  responseHeaders.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? '')
    ? "onAllReady"
    : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter
        context={reactRouterContext}
        url={request.url}
      />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );
          pipe(body);
        },
        onShellError(error) {
          logger.error("react.shell_render_failed", { requestId, error });
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          logger.error("react.render_failed", { requestId, error });
        },
      }
    );

    // Automatically timeout the React renderer after 6 seconds, which ensures
    // React has enough time to flush down the rejected boundary contents
    setTimeout(abort, streamTimeout + 1000);
  });
}
