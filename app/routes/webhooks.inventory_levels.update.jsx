import { authenticate } from "../shopify.server";
import { toInventoryItemGid } from "../utils/webhook-product.server";
import { backendInternalFetch } from "../utils/backend.server";

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const inventoryItemId = payload?.inventory_item_id;
  const available = payload?.available;

  if (!inventoryItemId) {
    console.warn(`[${topic}] Webhook payload missing inventory_item_id`, { shop });
    return new Response();
  }

  try {
    const result = await backendInternalFetch("/api/internal/inventory/webhook-update", {
      method: "POST",
      body: {
        shop,
        shopifyInventoryItemId: toInventoryItemGid(inventoryItemId),
        available
      }
    });

    if (!result.ok) {
      console.error(`[${topic}] Backend inventory update failed`, { shop, inventoryItemId, result: result.data });
    } else {
      console.log(`[${topic}] Backend inventory update succeeded`, { shop, inventoryItemId, result: result.data });
    }
  } catch (error) {
    console.error(`[${topic}] Failed to process webhook`, { shop, inventoryItemId, error: error?.message || error });
  }

  return new Response();
};
