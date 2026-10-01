import { authenticate } from "../shopify.server";
import { backendInternalFetch } from "../utils/backend.server";

export const loader = async ({
  request,
}: {
  request: Request;
}) => {
  try {
    const { session } =
      await authenticate.public.appProxy(
        request
      );

    const url =
      new URL(request.url);

    const query =
      String(
        url.searchParams.get("q") || ""
      ).trim();

    const mode =
      String(
        url.searchParams.get("mode") || "preview"
      ).trim().toLowerCase();

    if (!query) {
      return Response.json(
        {
          success: false,
          message:
            "Search query is required",
        },
        { status: 400 }
      );
    }

    if (
      mode !== "preview" &&
      mode !== "final"
    ) {
      return Response.json(
        {
          success: false,
          message:
            "Invalid search mode",
        },
        { status: 400 }
      );
    }

    const shop =
      session?.shop ||
      url.searchParams.get("shop") ||
      "";

    if (!shop) {
      return Response.json(
        {
          success: false,
          message:
            "Shopify shop could not be determined",
        },
        { status: 400 }
      );
    }

    console.log(
      "[APP PROXY] Authenticated request",
      {
        shop,
        query,
        mode,
      }
    );

    /*
     * backendInternalFetch adds the internal API secret
     * server-side; the backend rejects search requests
     * without it.
     */
    const result =
      await backendInternalFetch(
        "/api/ai-search/search",
        {
          method: "GET",
          searchParams: {
            q: query,
            shop,
            mode,
          },
          signal:
            request.signal,
        }
      );

    return Response.json(
      result.data,
      {
        status:
          result.status,
      }
    );
  } catch (error) {
    console.error(
      "[APP PROXY ERROR]",
      error
    );

    return Response.json(
      {
        success: false,
        message:
          "AI product search failed",
      },
      {
        status: 500,
      }
    );
  }
};