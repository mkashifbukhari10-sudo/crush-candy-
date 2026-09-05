import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

import { APPROVED_CUSTOMER_TAG } from "../../config/constants";

interface ApprovalQueryResponse {
  data?: {
    customer: { id: string; hasAnyTag: boolean } | null;
  };
  errors?: Array<{ message: string }>;
}

interface TagMutationResponse {
  data?: {
    tagsAdd?: { userErrors: Array<{ message: string }> };
    tagsRemove?: { userErrors: Array<{ message: string }> };
  };
  errors?: Array<{ message: string }>;
}

function assertGraphqlSuccess(
  response: { errors?: Array<{ message: string }> },
): void {
  if (response.errors?.length) throw new Error("Shopify customer operation failed");
}

export async function readApprovedCustomerTag(
  admin: AdminApiContext,
  shopifyCustomerId: string,
): Promise<boolean> {
  const response = await admin.graphql(
    `#graphql
      query CustomerApproval($id: ID!, $tags: [String!]!) {
        customer(id: $id) {
          id
          hasAnyTag(tags: $tags)
        }
      }`,
    {
      variables: {
        id: shopifyCustomerId,
        tags: [APPROVED_CUSTOMER_TAG],
      },
    },
  );
  const body = (await response.json()) as ApprovalQueryResponse;
  assertGraphqlSuccess(body);
  return body.data?.customer?.hasAnyTag === true;
}

export async function addApprovedCustomerTag(
  admin: AdminApiContext,
  shopifyCustomerId: string,
): Promise<void> {
  const response = await admin.graphql(
    `#graphql
      mutation AddApprovedCustomerTag($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) {
          userErrors { message }
        }
      }`,
    {
      variables: {
        id: shopifyCustomerId,
        tags: [APPROVED_CUSTOMER_TAG],
      },
    },
  );
  const body = (await response.json()) as TagMutationResponse;
  assertGraphqlSuccess(body);
  if (body.data?.tagsAdd?.userErrors.length) {
    throw new Error("Shopify rejected the approved customer tag update");
  }
}

export async function removeApprovedCustomerTag(
  admin: AdminApiContext,
  shopifyCustomerId: string,
): Promise<void> {
  const response = await admin.graphql(
    `#graphql
      mutation RemoveApprovedCustomerTag($id: ID!, $tags: [String!]!) {
        tagsRemove(id: $id, tags: $tags) {
          userErrors { message }
        }
      }`,
    {
      variables: {
        id: shopifyCustomerId,
        tags: [APPROVED_CUSTOMER_TAG],
      },
    },
  );
  const body = (await response.json()) as TagMutationResponse;
  assertGraphqlSuccess(body);
  if (body.data?.tagsRemove?.userErrors.length) {
    throw new Error("Shopify rejected the approved customer tag removal");
  }
}
