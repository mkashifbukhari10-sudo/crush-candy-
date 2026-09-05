import db from "../../db.server";
import { appendAuditLog } from "../audit/audit.server";
import { hashPrivateIdentifier } from "../../lib/access-code-security.server";
import { toShopifyCustomerGid } from "../../auth/customer.server";

function readCustomerId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const customer = (payload as { customer?: unknown }).customer;
  if (!customer || typeof customer !== "object") return null;
  const id = (customer as { id?: unknown }).id;
  if (typeof id !== "string" && typeof id !== "number") return null;
  return toShopifyCustomerGid(id);
}

export async function redactCustomerM1Data(payload: unknown): Promise<void> {
  const shopifyCustomerId = readCustomerId(payload);
  if (!shopifyCustomerId) return;

  const pseudonym = `redacted:${hashPrivateIdentifier(
    "customer-redaction",
    shopifyCustomerId,
  )}`;

  await db.$transaction(async (transaction) => {
    await transaction.customerProfile.deleteMany({
      where: { shopifyCustomerId },
    });
    await transaction.accessCode.updateMany({
      where: {
        claimedByCustomerId: shopifyCustomerId,
        status: "CLAIMED",
      },
      data: {
        claimedByCustomerId: null,
        status: "REVOKED",
        revokedAt: new Date(),
        revokedBy: "shopify-compliance",
      },
    });
    await transaction.accessCode.updateMany({
      where: { claimedByCustomerId: shopifyCustomerId },
      data: { claimedByCustomerId: null },
    });
    await transaction.accessCode.updateMany({
      where: { redeemedByCustomerId: shopifyCustomerId },
      data: { redeemedByCustomerId: null },
    });
    await transaction.auditLog.updateMany({
      where: { actorId: shopifyCustomerId },
      data: { actorId: pseudonym },
    });
    await transaction.auditLog.updateMany({
      where: { targetId: shopifyCustomerId },
      data: { targetId: pseudonym },
    });
    const tickets = await transaction.supportTicket.findMany({
      where: { shopifyCustomerId },
      select: { id: true },
    });
    if (tickets.length > 0) {
      const ticketIds = tickets.map((ticket) => ticket.id);
      await transaction.supportTicket.updateMany({
        where: { id: { in: ticketIds } },
        data: {
          shopifyCustomerId: pseudonym,
          initialMessage: "[redacted]",
        },
      });
      await transaction.supportMessage.updateMany({
        where: { ticketId: { in: ticketIds }, senderPlane: "CUSTOMER" },
        data: { senderId: pseudonym, body: "[redacted]" },
      });
    }
    await appendAuditLog(transaction, {
      actorPlane: "SYSTEM",
      actorId: "shopify-compliance",
      action: "CUSTOMER_DATA_REDACTED",
      targetType: "CustomerProfile",
      targetId: pseudonym,
      payload: {},
    });
  });
}

export async function redactShopM1Data(): Promise<void> {
  await db.$transaction([
    db.customerProfile.deleteMany(),
    db.accessCode.deleteMany(),
    db.rateLimitBucket.deleteMany(),
    db.auditLog.deleteMany(),
  ]);
}
