import { authenticate } from "../shopify.server";
import { fetchWebhookProduct, toProductGid } from "../utils/webhook-product.server";
import { backendInternalFetch } from "../utils/backend.server";

// =========================================================
// PRODUCT UPDATE (also covers variant add/update/remove)
// =========================================================
//
// Shopify has no separate "variant changed" webhook — a variant
// being added, edited, or removed is delivered as part of this
// same products/update event, always carrying the product's full,
// current variants list. The backend's webhook-upsert endpoint
// diffs that list against what it already has for this product
// and removes anything no longer present.
// =========================================================

export const action = async ({ request }) => {
  const { shop, topic, payload, session, admin } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can arrive after the app was uninstalled.
  if (!session || !admin) {
    return new Response();
  }

  const productId = payload?.id;

  if (!productId) {
    console.warn(`[${topic}] Webhook payload missing product id`, { shop });
    return new Response();
  }

  try {
    const { product, currency } = await fetchWebhookProduct(admin, toProductGid(productId));

    if (!product) {
      // Product may have been deleted again between the webhook
      // firing and this follow-up query — nothing to sync.
      console.warn(`[${topic}] Product no longer exists in Shopify`, { shop, productId });
      return new Response();
    }

    const result = await backendInternalFetch("/api/internal/products/webhook-upsert", {
      method: "POST",
      body: { shop, currency, product }
    });

    if (!result.ok) {
      console.error(`[${topic}] Backend upsert failed`, { shop, productId, result: result.data });
    } else {
      console.log(`[${topic}] Backend upsert succeeded`, { shop, productId, result: result.data });
    }
  } catch (error) {
    console.error(`[${topic}] Failed to process webhook`, { shop, productId, error: error?.message || error });
  }

  return new Response();
};
