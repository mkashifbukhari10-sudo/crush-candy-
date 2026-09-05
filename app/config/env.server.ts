import { z } from "zod";
import { createHmac } from "node:crypto";

import { CURRENT_MILESTONE } from "./constants";
import { AppConfigurationError } from "../lib/errors.server";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(1).optional(),
);
const optionalUrl = z.preprocess(
  emptyToUndefined,
  z.url().optional(),
);
const optionalSecret = z.preprocess(
  emptyToUndefined,
  z.string().min(32).optional(),
);
const requiredConfigString = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !value.includes("<") && !value.includes(">"), {
    message: "must replace the example placeholder",
  });

const serverEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z
    .string()
    .refine(
      (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
      "must be a PostgreSQL connection URL",
    )
    .refine((value) => !value.includes("<") && !value.includes(">"), {
      message: "must replace the example placeholder",
    }),
  SHOPIFY_API_KEY: requiredConfigString,
  SHOPIFY_API_SECRET: requiredConfigString,
  SHOPIFY_APP_URL: z.url(),
  SCOPES: z.string().default(""),
  SHOPIFY_STORE_DOMAIN: z.preprocess(
    emptyToUndefined,
    z.string().regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/).optional(),
  ),
  SHOP_CUSTOM_DOMAIN: optionalString,

  ACCESS_CODE_HASH_SECRET: optionalSecret,
  CUSTOMER_CSRF_SECRET: optionalSecret,
  DRIVER_CSRF_SECRET: optionalSecret,
  DRIVER_SESSION_COOKIE_NAME: z.preprocess(
    emptyToUndefined,
    z.literal("__Host-ccs_driver").optional(),
  ),
  DRIVER_IDLE_TIMEOUT_MINUTES: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().optional(),
  ),
  DRIVER_ABSOLUTE_TIMEOUT_HOURS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().optional(),
  ),
  APPROVAL_RECONCILIATION_SECRET: optionalSecret,

  EMAIL_PROVIDER: optionalString,
  EMAIL_API_KEY: optionalString,
  EMAIL_FROM: z.preprocess(emptyToUndefined, z.email().optional()),
  DISTANCE_PROVIDER: optionalString,
  DISTANCE_API_KEY: optionalString,
  OBJECT_STORAGE_ENDPOINT: optionalUrl,
  OBJECT_STORAGE_REGION: optionalString,
  OBJECT_STORAGE_BUCKET: optionalString,
  OBJECT_STORAGE_ACCESS_KEY_ID: optionalString,
  OBJECT_STORAGE_SECRET_ACCESS_KEY: optionalString,
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

let cachedEnvironment: ServerEnvironment | undefined;

export function getServerEnvironment(): ServerEnvironment {
  if (cachedEnvironment) return cachedEnvironment;

  const result = serverEnvironmentSchema.safeParse(process.env);
  if (!result.success) {
    const fields = [
      ...new Set(result.error.issues.map((issue) => issue.path.join("."))),
    ];
    throw new AppConfigurationError(fields);
  }

  cachedEnvironment = result.data;
  return cachedEnvironment;
}

export function getShopifyRuntimeConfig() {
  const environment = getServerEnvironment();
  const configuredScopes = environment.SCOPES.split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);

  return {
    apiKey: environment.SHOPIFY_API_KEY,
    apiSecretKey: environment.SHOPIFY_API_SECRET,
    appUrl: environment.SHOPIFY_APP_URL,
    scopes:
      configuredScopes.length > 0
        ? configuredScopes
        : ["write_customers", "write_app_proxy"],
    customShopDomains: environment.SHOP_CUSTOM_DOMAIN
      ? [environment.SHOP_CUSTOM_DOMAIN]
      : undefined,
  } as const;
}

export function getCustomerSecurityConfig() {
  const environment = getServerEnvironment();
  const derive = (purpose: string) =>
    createHmac("sha256", environment.SHOPIFY_API_SECRET)
      .update(`crush-candy-m1:${purpose}`, "utf8")
      .digest("hex");

  return {
    accessCodeHashSecret:
      environment.ACCESS_CODE_HASH_SECRET ?? derive("access-code-hash"),
    customerCsrfSecret:
      environment.CUSTOMER_CSRF_SECRET ?? derive("customer-csrf"),
  } as const;
}

export function getDriverSecurityConfig() {
  const environment = getServerEnvironment();
  const derive = (purpose: string) =>
    createHmac("sha256", environment.SHOPIFY_API_SECRET)
      .update(`crush-candy-m2:${purpose}`, "utf8")
      .digest("hex");

  return {
    csrfSecret: environment.DRIVER_CSRF_SECRET ?? derive("driver-csrf"),
    tokenSecret: derive("driver-token"),
    cookieName: environment.DRIVER_SESSION_COOKIE_NAME ?? "__Host-ccs_driver",
    idleTimeoutMinutes: environment.DRIVER_IDLE_TIMEOUT_MINUTES ?? 120,
    absoluteTimeoutHours: environment.DRIVER_ABSOLUTE_TIMEOUT_HOURS ?? 12,
  } as const;
}

export function getInternalSecurityConfig() {
  const environment = getServerEnvironment();
  return { approvalReconciliationSecret: environment.APPROVAL_RECONCILIATION_SECRET } as const;
}

export function getSafeRuntimeSummary() {
  const environment = getServerEnvironment();

  return {
    environment: environment.NODE_ENV,
    milestone: CURRENT_MILESTONE,
  } as const;
}
