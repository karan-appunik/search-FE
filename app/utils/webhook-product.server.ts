// =========================================================
// WEBHOOK PRODUCT FETCH (server-side only)
// =========================================================
//
// products/create and products/update webhooks only carry a
// lightweight, REST-shaped payload (numeric IDs, HTML description,
// comma-separated tags, no computed availableForSale). Rather than
// re-implementing that field mapping a second time and risking it
// drifting from what the manual sync already does correctly, this
// makes one GraphQL follow-up call for just that one product,
// using the exact same field selection api.products.sync.ts
// already uses — so the shape handed to the backend is identical
// to what a manual sync would have produced.
// =========================================================

const PRODUCT_QUERY = `
  query GetWebhookProduct($id: ID!) {
    shop {
      currencyCode
    }

    product(id: $id) {
      id
      handle
      title
      description
      productType
      vendor
      tags
      onlineStoreUrl

      featuredImage {
        url
        altText
      }

      variants(first: 100) {
        nodes {
          id
          title
          sku
          price
          compareAtPrice
          availableForSale
          inventoryQuantity

          inventoryItem {
            id
          }

          image {
            url
            altText
          }
        }
      }
    }
  }
`;

export interface WebhookProductFetchResult {
  product: Record<string, unknown> | null;
  currency: string;
}

/*
 * `admin` here is the AdminApiContext returned by
 * authenticate.webhook() when a session exists for the shop.
 * `productId` must already be the full GraphQL GID
 * (gid://shopify/Product/...).
 */
export async function fetchWebhookProduct(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  productId: string
): Promise<WebhookProductFetchResult> {
  const response = await admin.graphql(PRODUCT_QUERY, {
    variables: { id: productId }
  });

  const result = await response.json();

  if (result.errors) {
    throw new Error(`Shopify GraphQL request failed: ${JSON.stringify(result.errors)}`);
  }

  return {
    product: result?.data?.product || null,
    currency: result?.data?.shop?.currencyCode || "USD"
  };
}

/*
 * Shopify's REST-shaped webhook payloads use plain numeric IDs
 * (e.g. 123456789), while every product already in MongoDB was
 * synced with GraphQL's GID strings (gid://shopify/Product/...).
 * Without this conversion, a product touched by both the manual
 * sync and a webhook would end up as two different documents.
 * Left untouched if it's already a GID (defensive, in case a
 * webhook payload shape ever changes).
 */
export function toProductGid(id: string | number): string {
  const value = String(id);
  return value.startsWith("gid://") ? value : `gid://shopify/Product/${value}`;
}

export function toInventoryItemGid(id: string | number): string {
  const value = String(id);
  return value.startsWith("gid://") ? value : `gid://shopify/InventoryItem/${value}`;
}
