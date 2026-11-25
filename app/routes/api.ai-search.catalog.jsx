import { authenticate } from "../shopify.server";
import { backendInternalFetch } from "../utils/backend.server";

// =========================================================
// STOREFRONT CATALOG (app proxy: /apps/askmerce/catalog)
// =========================================================
//
// The compact in-stock product list the storefront script keeps
// in the browser to show word matches while the shopper types
// (instant results). Same app-proxy authentication as search;
// the backend secret is added server-side.
//
// Any failure answers { enabled: false }: the storefront then
// simply keeps its normal search flow.
// =========================================================

export const loader = async ({ request }) => {
  try {
    const { session } = await authenticate.public.appProxy(request);

    const url = new URL(request.url);
    const shop = session?.shop || url.searchParams.get("shop") || "";

    if (!shop) {
      return Response.json({ success: false, enabled: false }, { status: 400 });
    }

    const result = await backendInternalFetch("/api/ai-search/catalog", {
      method: "GET",
      searchParams: { shop },
      signal: request.signal
    });

    return Response.json(
      result.ok ? result.data : { success: false, enabled: false },
      {
        status: result.ok ? 200 : result.status,
        headers: {
          // The browser keeps its own 5-minute copy; never cache shared.
          "Cache-Control": "private, no-store"
        }
      }
    );
  } catch (error) {
    // Shopify's auth responses must reach the browser as-is.
    if (error instanceof Response) {
      throw error;
    }

    console.error("[STOREFRONT CATALOG PROXY ERROR]", error);

    return Response.json({ success: false, enabled: false }, { status: 500 });
  }
};
