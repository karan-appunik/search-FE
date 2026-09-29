import type { LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { backendInternalFetch } from "../utils/backend.server";

// =========================================================
// SEARCH PREVIEW PROXY
// =========================================================
//
// GET /api/search-preview?q=...&mode=preview|final
//
// Authenticated admin-only resource route so a seller can test
// the storefront search from the admin. This calls the exact
// same backend endpoint the storefront widget calls
// (/api/ai-search/search) — no new search logic, no ranking
// change, just a second authenticated caller of the existing
// API.
// =========================================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);

    const url = new URL(request.url);
    const query = String(url.searchParams.get("q") || "").trim();
    const mode = String(url.searchParams.get("mode") || "final").trim().toLowerCase();

    if (!query) {
      return Response.json(
        { success: false, message: "Search query is required" },
        { status: 400 }
      );
    }

    const result = await backendInternalFetch("/api/ai-search/search", {
      searchParams: {
        shop: session.shop,
        q: query,
        mode: mode === "preview" ? "preview" : "final"
      },
      signal: request.signal
    });

    return Response.json(result.data, { status: result.status });
  } catch (error) {
    console.error("[SEARCH PREVIEW PROXY ERROR]", error);

    return Response.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Search preview failed"
      },
      { status: 500 }
    );
  }
};
