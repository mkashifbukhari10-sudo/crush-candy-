import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.ACCESS_CODE_HASH_SECRET ??=
  "integration-hash-secret-that-is-at-least-32-characters";
process.env.CUSTOMER_CSRF_SECRET ??=
  "integration-csrf-secret-that-is-at-least-32-characters";
process.env.SHOPIFY_API_KEY ??= "integration-client-id";
process.env.SHOPIFY_API_SECRET ??= "integration-api-secret";
process.env.SHOPIFY_APP_URL ??= "https://integration.invalid";
process.env.SCOPES ??= "write_customers,write_app_proxy";

import db from "../app/db.server";
import { hashAccessCode, hashPrivateIdentifier } from "../app/lib/access-code-security.server";
import {
  redeemAccessCode,
} from "../app/services/customer/access-code.server";
import {
  createAccessCode,
  listAccessCodes,
  revokeAccessCode,
} from "../app/services/admin/access-codes.server";
import { reconcileCustomerApproval } from "../app/services/customer/approval.server";
import { customerRateLimiter } from "../app/services/customer/rate-limit.server";

const runDatabaseTests = process.env.RUN_DATABASE_TESTS === "1";
const suite = runDatabaseTests ? describe : describe.skip;
const CUSTOMER_PREFIX = "gid://shopify/Customer/990000000000";
const TEST_ADMIN = "m1-integration-test";
const testCustomerIds = Array.from({ length: 20 }, (_, index) =>
  `${CUSTOMER_PREFIX}${index}`,
);
const testIps = Array.from({ length: 20 }, (_, index) => `192.0.2.${index + 1}`);

function fakeAdmin(approved: Set<string>): AdminApiContext {
  return {
    graphql: async (query: string, options?: { variables?: { id?: string } }) => {
      const customerId = options?.variables?.id ?? "";
      if (query.includes("AddApprovedCustomerTag")) approved.add(customerId);
      if (query.includes("RemoveApprovedCustomerTag")) approved.delete(customerId);

      if (query.includes("CustomerApproval")) {
        return Response.json({
          data: {
            customer: { id: customerId, hasAnyTag: approved.has(customerId) },
          },
        });
      }
      return Response.json({
        data: query.includes("tagsRemove")
          ? { tagsRemove: { userErrors: [] } }
          : { tagsAdd: { userErrors: [] } },
      });
    },
  } as unknown as AdminApiContext;
}

async function insertCode(
  plaintext: string,
  overrides: Partial<{
    status: "ACTIVE" | "CLAIMED" | "REDEEMED" | "REVOKED";
    expiresAt: Date;
    claimedByCustomerId: string;
    redeemedByCustomerId: string;
    revokedAt: Date;
  }> = {},
) {
  return db.accessCode.create({
    data: {
      codeHash: hashAccessCode(plaintext),
      codeLast4: plaintext.slice(-4),
      createdByAdminId: TEST_ADMIN,
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
      status: overrides.status ?? "ACTIVE",
      claimedAt: overrides.claimedByCustomerId ? new Date() : undefined,
      claimedByCustomerId: overrides.claimedByCustomerId,
      redeemedAt: overrides.redeemedByCustomerId ? new Date() : undefined,
      redeemedByCustomerId: overrides.redeemedByCustomerId,
      revokedAt: overrides.revokedAt,
    },
  });
}

async function cleanTestData() {
  await db.customerProfile.deleteMany({
    where: { shopifyCustomerId: { startsWith: CUSTOMER_PREFIX } },
  });
  await db.auditLog.deleteMany({
    where: {
      OR: [
        { actorId: { startsWith: CUSTOMER_PREFIX } },
        { targetId: { startsWith: CUSTOMER_PREFIX } },
        { actorId: TEST_ADMIN },
      ],
    },
  });
  await db.accessCode.deleteMany({ where: { createdByAdminId: TEST_ADMIN } });

  const bucketKeys = testCustomerIds.flatMap((customerId, index) => [
    hashPrivateIdentifier("rate-limit", `access-code-customer:${customerId}`),
    hashPrivateIdentifier("rate-limit", `access-code-ip:${testIps[index]}`),
  ]);
  await db.rateLimitBucket.deleteMany({ where: { keyHash: { in: bucketKeys } } });
}

suite("access-code database lifecycle", () => {
  beforeAll(cleanTestData);
  afterAll(async () => {
    await cleanTestData();
    await db.$disconnect();
  });

  it("stores only the hash and permits admin revocation once", async () => {
    const created = await createAccessCode(TEST_ADMIN);
    const stored = await db.accessCode.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.codeHash).toBe(hashAccessCode(created.plaintext));
    expect(JSON.stringify(stored)).not.toContain(created.plaintext);
    expect((await listAccessCodes()).find((code) => code.id === created.id)?.last4).toBe(
      created.plaintext.slice(-4),
    );
    expect(await revokeAccessCode(created.id, TEST_ADMIN)).toBe(true);
    expect(await revokeAccessCode(created.id, TEST_ADMIN)).toBe(false);
  });

  it("redeems a valid code and treats the approved customer as returning", async () => {
    const code = "CCS-TEST-VALID-0001-AAAA";
    await insertCode(code);
    const approved = new Set<string>();
    const admin = fakeAdmin(approved);
    const customerId = testCustomerIds[1];

    expect(
      await redeemAccessCode({
        admin,
        code,
        ipAddress: testIps[1],
        shopifyCustomerId: customerId,
      }),
    ).toEqual({ status: "APPROVED" });
    expect(
      await redeemAccessCode({
        admin,
        code: "anything-is-ignored-for-approved-returning-customer",
        ipAddress: testIps[1],
        shopifyCustomerId: customerId,
      }),
    ).toEqual({ status: "ALREADY_APPROVED" });
  });

  it.each([
    ["expired", "CCS-TEST-EXPIRED-0002", { expiresAt: new Date(Date.now() - 1000) }, "EXPIRED"],
    ["revoked", "CCS-TEST-REVOKED-0003", { status: "REVOKED" as const, revokedAt: new Date() }, "REVOKED"],
    ["used", "CCS-TEST-USED-0004", { status: "REDEEMED" as const, redeemedByCustomerId: testCustomerIds[9] }, "USED"],
  ])("rejects an %s code", async (_label, code, overrides, reason) => {
    await insertCode(code, overrides);
    await expect(
      redeemAccessCode({
        admin: fakeAdmin(new Set()),
        code,
        ipAddress: testIps[2],
        shopifyCustomerId: testCustomerIds[2],
      }),
    ).rejects.toMatchObject({ reason });
  });

  it("allows only one customer to win a concurrent claim", async () => {
    const code = "CCS-TEST-CONCURRENT-0005";
    await insertCode(code);
    const approved = new Set<string>();

    const results = await Promise.allSettled([
      redeemAccessCode({
        admin: fakeAdmin(approved),
        code,
        ipAddress: testIps[5],
        shopifyCustomerId: testCustomerIds[5],
      }),
      redeemAccessCode({
        admin: fakeAdmin(approved),
        code,
        ipAddress: testIps[6],
        shopifyCustomerId: testCustomerIds[6],
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const stored = await db.accessCode.findUniqueOrThrow({
      where: { codeHash: hashAccessCode(code) },
    });
    expect(stored.status).toBe("REDEEMED");
    expect(approved.size).toBe(1);
  });

  it("finalizes a same-customer retry after Shopify committed the tag", async () => {
    const code = "CCS-TEST-RECOVERY-0006";
    const customerId = testCustomerIds[7];
    const record = await insertCode(code, {
      status: "CLAIMED",
      claimedByCustomerId: customerId,
    });
    const approved = new Set([customerId]);

    await expect(
      redeemAccessCode({
        admin: fakeAdmin(approved),
        code,
        ipAddress: testIps[7],
        shopifyCustomerId: customerId,
      }),
    ).resolves.toEqual({ status: "APPROVED" });

    await expect(
      db.accessCode.findUniqueOrThrow({ where: { id: record.id } }),
    ).resolves.toMatchObject({
      status: "REDEEMED",
      redeemedByCustomerId: customerId,
    });
  });

  it("revokes local approval when the authoritative tag is removed", async () => {
    const customerId = testCustomerIds[8];
    await db.customerProfile.create({
      data: {
        shopifyCustomerId: customerId,
        approvedAt: new Date(),
        approvalSource: "ADMIN_MANUAL",
      },
    });

    await reconcileCustomerApproval(customerId, false, {
      actorId: "shopify-customer-tag-webhook",
      actorPlane: "SYSTEM",
    });

    await expect(
      db.customerProfile.findUniqueOrThrow({ where: { shopifyCustomerId: customerId } }),
    ).resolves.toMatchObject({ approvalRevokedAt: expect.any(Date) });
    await expect(
      db.auditLog.count({
        where: { targetId: customerId, action: "APPROVAL_DIVERGENCE" },
      }),
    ).resolves.toBe(1);
  });

  it("records an externally added authoritative tag as manual approval", async () => {
    const customerId = testCustomerIds[10];
    await reconcileCustomerApproval(customerId, true, {
      actorId: "shopify-customer-tag-webhook",
      actorPlane: "SYSTEM",
      source: "ADMIN_MANUAL",
    });

    await expect(
      db.customerProfile.findUniqueOrThrow({ where: { shopifyCustomerId: customerId } }),
    ).resolves.toMatchObject({
      approvedAt: expect.any(Date),
      approvalSource: "ADMIN_MANUAL",
      approvalRevokedAt: null,
    });
  });

  it("atomically limits concurrent attempts for one subject", async () => {
    const results = await Promise.all(
      Array.from({ length: 7 }, () =>
        customerRateLimiter.consume(
          "access-code-customer",
          testCustomerIds[11],
          { limit: 5, windowSeconds: 3600 },
        ),
      ),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(5);
    expect(results.filter((result) => !result.allowed)).toHaveLength(2);
  });
});
