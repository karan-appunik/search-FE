import type {
  ActionFunctionArgs
} from "react-router";

import {
  authenticate
} from "../shopify.server";

import {
  backendInternalFetch
} from "../utils/backend.server";

interface ProductSyncBackendResult {
  success?: boolean;
  message?: string;
  data?: {
    synced?: number;
    skipped?: number;
    deleted?: number;
  };
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


    const response =
      await admin.graphql(
        `#graphql
          query GetProducts(
            $first: Int!
          ) {

            shop {
              name
              currencyCode
            }

            products(
              first: $first
              query: "status:active"
            ) {

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

          }
        `,
        {
          variables: {
            first: 100
          }
        }
      );


    const result =
      await response.json();


    if (
      result.errors
    ) {

      console.error(
        "[SHOPIFY GRAPHQL ERROR]",
        result.errors
      );


      return Response.json(
        {
          success: false,

          message:
            "Shopify GraphQL request failed",

          errors:
            result.errors
        },
        {
          status: 500
        }
      );

    }


    const products =
      result?.data?.products?.nodes ||
      [];


    const currency =
      result?.data?.shop?.currencyCode ||
      "USD";


    console.log(
      "[PRODUCT SYNC]",
      {
        shop:
          session.shop,

        products:
          products.length
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
            "MongoDB product sync failed",

          backend:
            backendResult
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
        result?.data?.shop?.name ||
        "",

      productsFound:
        products.length,

      synced:
        backendResult?.data?.synced ||
        0,

      skipped:
        backendResult?.data?.skipped ||
        0,

      deleted:
        backendResult?.data?.deleted ||
        0

    });


  } catch (error) {

    console.error(
      "[PRODUCT SYNC ERROR]",
      error
    );


    return Response.json(
      {
        success: false,

        message:
          error instanceof Error
            ? error.message
            : "Product sync failed",

        error:
          error instanceof Error
            ? error.stack
            : String(error)
      },
      {
        status: 500
      }
    );

  }

};