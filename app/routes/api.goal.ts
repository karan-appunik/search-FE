import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { backendInternalFetch } from "../utils/backend.server";

// =========================================================
// GOAL PROXY
// =========================================================
//
// GET    /api/goal   -> load this shop's saved goal (or null)
// PUT    /api/goal    (via action, method override below)
// DELETE /api/goal    (via action, method override below)
//
// Authenticated admin-only resource route. The shop always
// comes from the Shopify session, never from the request body
// — the same rule the backend's own goal endpoints already
// enforce, applied a second time here so a forged shop field
// in the request body is simply overwritten.
// =========================================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);

    // Safe to log: shop is a store domain, not a secret. Never
    // logs INTERNAL_API_SECRET or any request/response body.
    console.log("[GOAL PROXY] loader", { shop: session.shop });

    const result = await backendInternalFetch("/api/internal/goal", {
      searchParams: { shop: session.shop },
      signal: request.signal
    });

    console.log("[GOAL PROXY] loader result", { shop: session.shop, status: result.status });

    return Response.json(result.data, { status: result.status });
  } catch (error) {
    console.error("[GOAL PROXY LOAD ERROR]", error);

    return Response.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Unable to load goal"
      },
      { status: 500 }
    );
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);

    // Safe to log: method + shop domain only, no body content,
    // no secrets.
    console.log("[GOAL PROXY] action", { method: request.method, shop: session.shop });

    if (request.method === "DELETE") {
      const result = await backendInternalFetch("/api/internal/goal", {
        method: "DELETE",
        body: { shop: session.shop },
        signal: request.signal
      });

      console.log("[GOAL PROXY] action result", { method: "DELETE", shop: session.shop, status: result.status });

      return Response.json(result.data, { status: result.status });
    }

    if (request.method === "PUT") {
      const payload = await request.json();

      const result = await backendInternalFetch("/api/internal/goal", {
        method: "PUT",
        body: {
          ...payload,
          // The shop always comes from the authenticated session,
          // overriding anything the client sent.
          shop: session.shop
        },
        signal: request.signal
      });

      console.log("[GOAL PROXY] action result", {
        method: "PUT",
        shop: session.shop,
        status: result.status,
        skuCount: Array.isArray(payload?.skus) ? payload.skus.length : 0
      });

      return Response.json(result.data, { status: result.status });
    }

    console.warn("[GOAL PROXY] unsupported method", { method: request.method, shop: session.shop });

    return Response.json(
      { success: false, message: "Method not allowed" },
      { status: 405 }
    );
  } catch (error) {
    console.error("[GOAL PROXY ACTION ERROR]", { method: request.method, error });

    return Response.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : request.method === "DELETE"
              ? "Unable to delete goal"
              : "Unable to save goal"
      },
      { status: 500 }
    );
  }
};
