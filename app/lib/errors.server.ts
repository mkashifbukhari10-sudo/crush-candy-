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

export class CustomerAuthenticationError extends Error {
  constructor(message = "Customer authentication required") {
    super(message);
    this.name = "CustomerAuthenticationError";
  }
}

export class CustomerAuthorizationError extends Error {
  constructor(message = "Approved customer access required") {
    super(message);
    this.name = "CustomerAuthorizationError";
  }
}

export class DriverAuthenticationError extends Error {
  constructor(message = "Driver authentication required") {
    super(message);
    this.name = "DriverAuthenticationError";
  }
}

export class DriverAuthorizationError extends Error {
  constructor(message = "Active driver access required") {
    super(message);
    this.name = "DriverAuthorizationError";
  }
}

export class DriverRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Too many authentication attempts");
    this.name = "DriverRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
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
