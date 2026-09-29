import { authenticate } from "../shopify.server";
import { toProductGid } from "../utils/webhook-product.server";
import { backendInternalFetch } from "../utils/backend.server";

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const productId = payload?.id;

  if (!productId) {
    console.warn(`[${topic}] Webhook payload missing product id`, { shop });
    return new Response();
  }

  try {
    const result = await backendInternalFetch("/api/internal/products/webhook-delete", {
      method: "POST",
      body: { shop, shopifyProductId: toProductGid(productId) }
    });

    if (!result.ok) {
      console.error(`[${topic}] Backend delete failed`, { shop, productId, result: result.data });
    } else {
      console.log(`[${topic}] Backend delete succeeded`, { shop, productId, result: result.data });
    }
  } catch (error) {
    console.error(`[${topic}] Failed to process webhook`, { shop, productId, error: error?.message || error });
  }

  return new Response();
};
