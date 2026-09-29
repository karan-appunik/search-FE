import { authenticate } from "../shopify.server";

// =========================================================
// GDPR: CUSTOMER REDACT
// =========================================================
//
// Mandatory compliance webhook. Shopify sends this 10 days after
// a customer requests deletion of their data (or on merchant
// request), and requires the app to delete any data it holds for
// that customer.
//
// Same reasoning as webhooks.customers.data_request.jsx: this app
// never stores customer PII anywhere (only the shop's product
// catalog and the merchant's own search rules), so there is
// nothing belonging to this customer to delete. This only
// acknowledges the request.
// =========================================================

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`, {
    customerId: payload?.customer?.id
  });

  return new Response();
};
