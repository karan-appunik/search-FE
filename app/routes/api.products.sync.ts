import type {
  ActionFunctionArgs
} from "react-router";

import {
  authenticate
} from "../shopify.server";

import {
  backendInternalFetch
} from "../utils/backend.server";

// =========================================================
// FULL PRODUCT SYNC
// =========================================================
//
// Only ACTIVE products are synced: draft and archived products
// are not on the online store, so they must never appear in
// storefront search. The result reports products and variants
// separately, plus how many Shopify products were left out
// because they aren't active, so every number matches Shopify
// admin.
//
// Every active product is fetched, page by page (and every
// variant of products with more than one page of variants):
// the backend removes products missing from the list, so the
// list must be complete.
// =========================================================

interface ProductSyncBackendResult {
  success?: boolean;
  message?: string;
  data?: {
    synced?: number;
    variantsSynced?: number;
    productsSynced?: number;
    productsRemoved?: number;
    skipped?: number;
    deleted?: number;
  };
}

type AdminGraphql = (
  query: string,
  options?: { variables?: Record<string, unknown> }
) => Promise<Response>;

// A single Admin GraphQL query may not cost more than 1,000
// points, and nested connections multiply (products × variants).
// 25 × 25 stays well under it; products with more variants get
// the rest through separate 100-variant queries.
const PRODUCTS_PAGE_SIZE = 25;
const VARIANTS_PAGE_SIZE = 25;
const MORE_VARIANTS_PAGE_SIZE = 100;
const MAX_RETRIES = 10;

const VARIANT_FIELDS = `
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
`;

const PRODUCTS_QUERY = `#graphql
  query SyncProducts($first: Int!, $after: String, $variantsFirst: Int!) {
    products(first: $first, after: $after, query: "status:active") {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
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
        variants(first: $variantsFirst) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            ${VARIANT_FIELDS}
          }
        }
      }
    }
  }
`;

const MORE_VARIANTS_QUERY = `#graphql
  query SyncMoreVariants($id: ID!, $first: Int!, $after: String) {
    product(id: $id) {
      variants(first: $first, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          ${VARIANT_FIELDS}
        }
      }
    }
  }
`;

const SHOP_QUERY = `#graphql
  query SyncShopInfo {
    shop {
      name
      currencyCode
    }
    allProducts: productsCount(limit: null) {
      count
    }
    activeProducts: productsCount(query: "status:active", limit: null) {
      count
    }
  }
`;

class ShopifyQueryError extends Error {}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/*
 * Runs one Admin GraphQL query, waiting and retrying when
 * Shopify throttles (large catalogs need many pages).
 */
async function runQuery(
  graphql: AdminGraphql,
  query: string,
  variables: Record<string, unknown> = {}
) {
  for (let attempt = 1; ; attempt++) {
    const response = await graphql(query, { variables });
    const result = await response.json();

    const throttled = (result?.errors || []).some(
      (error: { extensions?: { code?: string } }) => error?.extensions?.code === "THROTTLED"
    );

    if (throttled && attempt < MAX_RETRIES) {
      // Wait until Shopify's bucket has refilled enough for this
      // query (restoreRate points per second).
      const cost = result?.extensions?.cost;
      const missing =
        Number(cost?.requestedQueryCost || 0) -
        Number(cost?.throttleStatus?.currentlyAvailable || 0);
      const restoreRate = Number(cost?.throttleStatus?.restoreRate || 50);

      await wait(Math.max(1000, Math.ceil(Math.max(0, missing) / restoreRate) * 1000 + 250));
      continue;
    }

    if (result?.errors) {
      console.error("[SHOPIFY GRAPHQL ERROR]", result.errors);
      throw new ShopifyQueryError("Shopify GraphQL request failed");
    }

    return result.data;
  }
}

async function fetchAllActiveProducts(graphql: AdminGraphql) {
  const products: Record<string, any>[] = [];
  let after: string | null = null;

  do {
    const data = await runQuery(graphql, PRODUCTS_QUERY, {
      first: PRODUCTS_PAGE_SIZE,
      after,
      variantsFirst: VARIANTS_PAGE_SIZE
    });

    const page = data?.products;

    for (const product of page?.nodes || []) {
      // Products with more variants than one page holds.
      let variantsPage = product?.variants?.pageInfo;

      while (variantsPage?.hasNextPage) {
        const more = await runQuery(graphql, MORE_VARIANTS_QUERY, {
          id: product.id,
          first: MORE_VARIANTS_PAGE_SIZE,
          after: variantsPage.endCursor
        });

        const variants = more?.product?.variants;

        product.variants.nodes.push(...(variants?.nodes || []));
        variantsPage = variants?.pageInfo;
      }

      products.push(product);
    }

    after = page?.pageInfo?.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);

  return products;
}

export const action = async ({
  request,
}: ActionFunctionArgs) => {

  try {

    const {
      admin,
      session
    } =
      await authenticate.admin(
        request
      );

    const graphql = admin.graphql as AdminGraphql;

    const shopInfo = await runQuery(graphql, SHOP_QUERY);
    const products = await fetchAllActiveProducts(graphql);

    const currency =
      shopInfo?.shop?.currencyCode ||
      "USD";

    const shopifyProductsTotal =
      Number(shopInfo?.allProducts?.count ?? products.length);

    // Draft and archived products (not on the online store).
    const notActiveProducts =
      Math.max(0, shopifyProductsTotal - products.length);


    console.log(
      "[PRODUCT SYNC]",
      {
        shop:
          session.shop,

        shopifyProducts:
          shopifyProductsTotal,

        activeProducts:
          products.length,

        variants:
          products.reduce(
            (sum, product) => sum + (product?.variants?.nodes?.length || 0),
            0
          )
      }
    );


    const backendResponse =
      await backendInternalFetch(
        "/api/internal/products/sync",
        {
          method: "POST",

          body: {
            shop:
              session.shop,

            currency,

            products
          }
        }
      );


    const backendResult =
      backendResponse.data as ProductSyncBackendResult;


    if (
      !backendResponse.ok
    ) {

      console.error(
        "[BACKEND SYNC ERROR]",
        backendResult
      );


      return Response.json(
        {
          success: false,

          message:
            "Product sync failed"
        },
        {
          status: 500
        }
      );

    }


    return Response.json({

      success: true,

      shop:
        session.shop,

      shopName:
        shopInfo?.shop?.name ||
        "",

      // Products in Shopify admin (all statuses).
      shopifyProducts:
        shopifyProductsTotal,

      // Active products fetched and synced for search.
      activeProducts:
        products.length,

      notActiveProducts,

      productsSynced:
        backendResult?.data?.productsSynced ??
        products.length,

      variantsSynced:
        backendResult?.data?.variantsSynced ??
        backendResult?.data?.synced ??
        0,

      productsRemoved:
        backendResult?.data?.productsRemoved ||
        0,

      skipped:
        backendResult?.data?.skipped ||
        0

    });


  } catch (error) {
    // Shopify's auth responses (expired session -> re-auth, invalid
    // app proxy signature -> 400/401) must reach the browser as-is.
    if (error instanceof Response) {
      throw error;
    }


    console.error(
      "[PRODUCT SYNC ERROR]",
      error
    );


    return Response.json(
      {
        success: false,

        message:
          error instanceof ShopifyQueryError
            ? "Could not read products from Shopify. Please try again."
            : "Product sync failed"
      },
      {
        status: 500
      }
    );

  }

};
