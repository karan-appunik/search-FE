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

    console.log(
      "[SHOPIFY APP PROXY]",
      {
        shop,
        query,
      }
    );

    const backendResponse =
      await backendInternalFetch(
        "/api/ai-search/search",
        {
          method: "GET",
          searchParams: { shop, q: query },
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