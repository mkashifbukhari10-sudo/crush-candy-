export class AppConfigurationError extends Error {
  readonly fields: string[];

  constructor(fields: string[]) {
    super(`Invalid server configuration: ${fields.join(", ")}`);
    this.name = "AppConfigurationError";
    this.fields = fields;
  }
}

export class PlaneUnavailableError extends Error {
  readonly milestone: string;

  constructor(plane: "customer" | "driver", milestone: string) {
    super(`${plane} plane authentication is not available in Milestone 0`);
    this.name = "PlaneUnavailableError";
    this.milestone = milestone;
  }
}

export function safeInternalErrorResponse(requestId: string): Response {
  return Response.json(
    {
      error: "Internal server error",
      requestId,
    },
    {
      status: 500,
      headers: { "x-request-id": requestId },
    },
  );
}

