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
//
// Also shows the storefront search onboarding: the theme app
// embed must be turned on in the theme editor, and the
// "Enable in theme editor" button deep-links there with the
// embed pre-selected (Shopify's activateAppId link).
// =========================================================

// File name of the app embed block in
// extensions/ai-product-search/blocks/ (without .liquid).
const APP_EMBED_HANDLE = "ai-search-embed";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const result = await backendInternalFetch("/api/internal/status", {
    searchParams: { shop: session.shop },
    signal: request.signal
  });

  const themeEditorUrl =
    `https://${session.shop}/admin/themes/current/editor` +
    // eslint-disable-next-line no-undef
    `?context=apps&activateAppId=${process.env.SHOPIFY_API_KEY}/${APP_EMBED_HANDLE}`;

  return {
    shop: session.shop,
    themeEditorUrl,
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
  const { status, statusError, themeEditorUrl } = useLoaderData();
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
        variant="primary"
        onClick={syncProducts}
        {...(isSyncing ? { loading: true } : {})}
      >
        {isSyncing ? "Syncing Products..." : "Sync Products"}
      </s-button>

      <s-section heading="Set up storefront search">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            AI Product Search works through your theme&apos;s existing
            search bar. Complete these steps once to turn it on:
          </s-paragraph>

          <s-ordered-list>
            <s-list-item>
              Click <s-text type="strong">Sync Products</s-text> (top right)
              so your catalog is ready to search.
            </s-list-item>
            <s-list-item>
              Click <s-text type="strong">Enable in theme editor</s-text>{" "}
              below. Your theme editor opens with{" "}
              <s-text type="strong">AI Product Search</s-text> selected under
              App embeds.
            </s-list-item>
            <s-list-item>
              Make sure the <s-text type="strong">AI Product Search</s-text>{" "}
              toggle is on, then click <s-text type="strong">Save</s-text>.
            </s-list-item>
            <s-list-item>
              Open your online store and try a search, for example a product
              name or &quot;something warm for winter&quot;.
            </s-list-item>
          </s-ordered-list>

          <s-text color="subdued">
            Using a different theme later? Repeat steps 2 and 3 for the new
            theme. Products stay in sync automatically when you edit them in
            Shopify.
          </s-text>

          <s-box>
            <s-button variant="primary" href={themeEditorUrl} target="_top">
              Enable in theme editor
            </s-button>
          </s-box>
        </s-stack>
      </s-section>

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
