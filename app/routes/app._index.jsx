import { useFetcher, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import { backendInternalFetch } from "../utils/backend.server";

// =========================================================
// SELLER DASHBOARD
// =========================================================
//
// Real, backend-sourced status for this shop: product counts,
// availability, goal/rule status, and a "last synced" signal
// derived from product update timestamps (there is no
// dedicated sync-log table, so this is the honest proxy for
// it, not an invented value).
// =========================================================

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const result = await backendInternalFetch("/api/internal/status", {
    searchParams: { shop: session.shop },
    signal: request.signal
  });

  return {
    shop: session.shop,
    status: result.ok ? result.data?.data?.shop : null,
    statusError: result.ok ? null : result.data?.message || "Unable to load status"
  };
};

function formatDate(value) {
  if (!value) {
    return "Never";
  }

  try {
    return new Date(value).toLocaleString();
  } catch {
    return "Unknown";
  }
}

export default function Index() {
  const { status, statusError } = useLoaderData();
  const fetcher = useFetcher();

  const isSyncing = fetcher.state !== "idle";
  const result = fetcher.data;

  const syncProducts = () => {
    fetcher.submit({}, { method: "POST", action: "/api/products/sync" });
  };

  return (
    <s-page heading="AI Product Search">
      <s-button
        slot="primary-action"
        onClick={syncProducts}
        {...(isSyncing ? { loading: true } : {})}
      >
        {isSyncing ? "Syncing Products..." : "Sync Products"}
      </s-button>

      <s-section heading="Dashboard">
        <s-stack direction="block" gap="base">
          {statusError && (
            <s-banner tone="critical">{statusError}</s-banner>
          )}

          {status && (
            <s-grid
              gridTemplateColumns="repeat(auto-fill, minmax(200px, 1fr))"
              gap="base"
            >
              <s-box padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small-200">
                  <s-text color="subdued">Products synced</s-text>
                  <s-heading>{status.products.total}</s-heading>
                </s-stack>
              </s-box>

              <s-box padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small-200">
                  <s-text color="subdued">Available for sale</s-text>
                  <s-heading>{status.products.available}</s-heading>
                </s-stack>
              </s-box>

              <s-box padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small-200">
                  <s-text color="subdued">Out of stock</s-text>
                  <s-heading>{status.products.unavailable}</s-heading>
                </s-stack>
              </s-box>

              <s-box padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small-200">
                  <s-text color="subdued">Goal / rule</s-text>
                  <s-heading>
                    {status.goal ? status.goal.name : "Not set up"}
                  </s-heading>
                  {status.goal && (
                    <s-text color="subdued">
                      {status.goal.ruleType
                        ? `${status.goal.ruleType} · `
                        : ""}
                      {status.goal.selectedProductCount} product
                      {status.goal.selectedProductCount === 1 ? "" : "s"}
                    </s-text>
                  )}
                </s-stack>
              </s-box>

              <s-box padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small-200">
                  <s-text color="subdued">Last synced</s-text>
                  <s-heading>{formatDate(status.lastSyncedAt)}</s-heading>
                </s-stack>
              </s-box>
            </s-grid>
          )}
        </s-stack>
      </s-section>

      {result?.success && (
        <s-banner tone="success">
          Product sync completed successfully.
          <s-stack direction="block" gap="small">
            <s-text>Shop: {result.shop}</s-text>
            <s-text>Products found: {result.productsFound}</s-text>
            <s-text>Products synced: {result.synced}</s-text>
            <s-text>Products skipped: {result.skipped}</s-text>
            <s-text>Products deleted: {result.deleted}</s-text>
          </s-stack>
        </s-banner>
      )}

      {result?.success === false && (
        <s-banner tone="critical">
          {result.message || "Product sync failed"}
        </s-banner>
      )}

      <s-section heading="AI Search">
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small">
              <s-heading>Natural Language Search</s-heading>
              <s-paragraph>
                Customers can search naturally using the existing
                Shopify theme search bar.
              </s-paragraph>
              <s-text>
                Example: &quot;Give me the best shampoo for hair
                fall&quot;
              </s-text>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>
    </s-page>
  );
}
