import type {
  LoaderFunctionArgs
} from "react-router";

import {
  authenticate
} from "../shopify.server";


// =========================================================
// GOAL PRODUCT LISTING PROXY
// =========================================================
//
// GET /api/goal/products?page=&limit=&search=
//
// Authenticated admin-only resource route. Resolves the shop
// from the Shopify session (never from client input) and
// forwards a read-only listing request to the backend's
// internal goal-products API.
//
// The INTERNAL_API_SECRET is read from process.env on the
// server only. It is never sent to, or readable by, the
// browser: this loader runs on the app server, and its
// response body never includes the secret.
//
// This route does not create, save, edit, or delete a goal.
// It only lists the already-synced MongoDB catalog for the
// future picker UI.
// =========================================================

export const loader = async ({
  request
}: LoaderFunctionArgs) => {

  try {

    const {
      session
    } =
      await authenticate.admin(
        request
      );


    if (
      !process.env.BACKEND_URL
    ) {

      throw new Error(
        "BACKEND_URL is missing in ai-product-search/.env"
      );

    }


    if (
      !process.env.INTERNAL_API_SECRET
    ) {

      throw new Error(
        "INTERNAL_API_SECRET is missing in ai-product-search/.env"
      );

    }


    const url =
      new URL(request.url);


    const page =
      url.searchParams.get("page") ||
      "";

    const limit =
      url.searchParams.get("limit") ||
      "";

    const search =
      url.searchParams.get("search") ||
      "";


    const backendUrl =
      new URL(
        `${process.env.BACKEND_URL}/api/internal/goal/products`
      );


    backendUrl.searchParams.set(
      "shop",
      session.shop
    );


    if (page) {

      backendUrl.searchParams.set(
        "page",
        page
      );

    }


    if (limit) {

      backendUrl.searchParams.set(
        "limit",
        limit
      );

    }


    if (search) {

      backendUrl.searchParams.set(
        "search",
        search
      );

    }


    console.log(
      "[GOAL PRODUCTS PROXY]",
      {
        shop:
          session.shop,

        page,

        limit,

        search
      }
    );


    const backendResponse =
      await fetch(
        backendUrl.toString(),
        {
          method: "GET",

          headers: {
            Accept:
              "application/json",

            "x-internal-api-secret":
              process.env.INTERNAL_API_SECRET
          },

          signal:
            request.signal
        }
      );


    const text =
      await backendResponse.text();


    let data;

    try {

      data =
        JSON.parse(text);

    } catch {

      data = {
        success: false,

        message:
          "Invalid backend response"
      };

    }


    return Response.json(
      data,
      {
        status:
          backendResponse.status
      }
    );


  } catch (error) {

    console.error(
      "[GOAL PRODUCTS PROXY ERROR]",
      error
    );


    return Response.json(
      {
        success: false,

        message:
          error instanceof Error
            ? error.message
            : "Unable to load products"
      },
      {
        status: 500
      }
    );

  }

};
