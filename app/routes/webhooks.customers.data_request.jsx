import { authenticate } from "../shopify.server";

// =========================================================
// GDPR: CUSTOMER DATA REQUEST
// =========================================================
//
// Mandatory compliance webhook — Shopify requires every App
// Store app to subscribe to this topic, regardless of whether
// the app actually stores customer data.
//
// This app never stores customer PII: the only data it holds is
// the shop's own product catalog (Product model) and the
// merchant's own search rules (Goal model) — no customer records,
// orders, or personal data are ever ingested anywhere in this
// app. So there is nothing to look up or export here; this only
// acknowledges the request, same as Shopify's own webhook
// templates do when an app has no matching data.
// =========================================================

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`, {
    customerId: payload?.customer?.id,
    ordersRequested: payload?.orders_requested
  });

  return new Response();
};
