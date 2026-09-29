import { authenticate } from "../shopify.server";
import { backendInternalFetch } from "../utils/backend.server";

// =========================================================
// GDPR: SHOP REDACT
// =========================================================
//
// Sent ~48 hours after a shop uninstalls the app. Unlike
// webhooks.app.uninstalled.jsx (which only clears the login
// session immediately on uninstall), this is the actual mandatory
// data-deletion step: the app must delete everything it holds for
// this shop. See backend/src/controllers/privacy.controller.js
// for what "everything" means here (products, goal, Qdrant
// vectors) — this route only forwards the shop to that endpoint.
//
// No session is expected to exist by the time this fires (the
// shop already uninstalled), so this doesn't depend on one —
// `shop` comes directly from the verified webhook payload.
// =========================================================

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    const result = await backendInternalFetch("/api/internal/privacy/shop-redact", {
      method: "POST",
      body: { shop }
    });

    if (!result.ok) {
      console.error(`[${topic}] Backend redact failed`, { shop, result: result.data });
    } else {
      console.log(`[${topic}] Backend redact succeeded`, { shop, result: result.data });
    }
  } catch (error) {
    console.error(`[${topic}] Failed to process webhook`, { shop, error: error?.message || error });
  }

  return new Response();
};
