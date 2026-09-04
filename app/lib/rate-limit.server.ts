export interface RateLimitPolicy {
  readonly limit: number;
  readonly windowSeconds: number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds?: number;
}

export interface RateLimiter {
  consume(
    namespace: string,
    subject: string,
    policy: RateLimitPolicy,
  ): Promise<RateLimitResult>;
}

// The Postgres-backed adapter is DEFERRED TO M2. Defining the contract now keeps
// rate limiting plane-specific and prevents auth code from binding to a vendor.

