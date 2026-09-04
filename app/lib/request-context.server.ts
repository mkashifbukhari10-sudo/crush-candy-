const REQUEST_ID_HEADER = "x-request-id";
const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

const generatedIds = new WeakMap<Request, string>();

export function getRequestId(request: Request): string {
  const incoming = request.headers.get(REQUEST_ID_HEADER);
  if (incoming && VALID_REQUEST_ID.test(incoming)) return incoming;

  const existing = generatedIds.get(request);
  if (existing) return existing;

  const requestId = crypto.randomUUID();
  generatedIds.set(request, requestId);
  return requestId;
}

export function requestIdHeaders(requestId: string): Headers {
  return new Headers({ [REQUEST_ID_HEADER]: requestId });
}

