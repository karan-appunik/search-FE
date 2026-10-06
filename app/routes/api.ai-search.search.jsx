import { authenticate } from "../shopify.server";
import { backendInternalFetch } from "../utils/backend.server";

export const loader = async ({ request }) => {
  try {
    const { session } =
      await authenticate.public.appProxy(
        request
      );

    const url = new URL(request.url);

    const query =
      url.searchParams
        .get("q")
        ?.trim() || "";

    if (!query) {
      return Response.json(
        {
          success: false,
          message:
            "Search query is required",
        },
        {
          status: 400,
        }
      );
    }

    const shop =
      session?.shop ||
      url.searchParams.get("shop");

    if (!shop) {
      return Response.json(
        {
          success: false,
          message: "Shop could not be determined",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * Customers get the AI model (GLM) first ("final"); the
     * backend falls back to JEV only if GLM fails. "preview"
     * (JEV only) is used only when explicitly requested.
     */
    const mode =
      url.searchParams.get("mode") === "preview"
        ? "preview"
        : "final";

    console.log(
      "[SHOPIFY APP PROXY]",
      {
        shop,
        query,
        mode,
      }
    );

    const backendResponse =
      await backendInternalFetch(
        "/api/ai-search/search",
        {
          method: "GET",
          searchParams: { shop, q: query, mode },
          // Customer typed past this search: cancel it in the
          // backend too, so its AI call is dropped.
          signal: request.signal,
        }
      );

    return Response.json(
      backendResponse.data,
      {
        status:
          backendResponse.status,
      }
    );
  } catch (error) {
    console.error(
      "[SHOPIFY APP PROXY ERROR]",
      error
    );

    return Response.json(
      {
        success: false,
        message:
          "AI search proxy failed",
      },
      {
        status: 500,
      }
    );
  }
};