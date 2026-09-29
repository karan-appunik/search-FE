import { authenticate } from "../shopify.server";

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

    const backendUrl =
      new URL(
        `${process.env.BACKEND_URL}/api/ai-search/search`
      );

    backendUrl.searchParams.set(
      "q",
      query
    );

    backendUrl.searchParams.set(
      "shop",
      shop
    );

    backendUrl.searchParams.set(
      "mode",
      mode
    );

    const response =
      await fetch(
        backendUrl.toString(),
        {
          method: "GET",
          headers: {
            Accept:
              "application/json",
          },
          signal:
            request.signal,
        }
      );
      
      console.log("[APP PROXY AI SEARCH]", {
  query,
  shop,
  mode,
  backendUrl
});


    const text =
      await response.text();

    let data;

    try {
      data =
        JSON.parse(text);
    } catch {
      data = {
        success: false,
        message:
          "Invalid backend response",
      };
    }

    return Response.json(
      data,
      {
        status:
          response.status,
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