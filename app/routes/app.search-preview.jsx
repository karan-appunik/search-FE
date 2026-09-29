import { useState } from "react";
import { useFetcher } from "react-router";

// =========================================================
// SEARCH PREVIEW
// =========================================================
//
// Lets a seller test the live storefront search from the
// admin. Calls the existing /api/ai-search/search endpoint
// through api.search-preview.ts — the exact same backend
// endpoint the storefront widget uses. No new search logic,
// no ranking change.
//
// Only what the API actually returns is shown. It does not
// return retrieval candidate counts or timing — those are
// only ever written to the backend's server logs, not the
// HTTP response — so this page says so rather than inventing
// diagnostic detail that was never sent.
// =========================================================

export default function SearchPreview() {
  const fetcher = useFetcher();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("final");

  const isLoading = fetcher.state !== "idle";
  const result = fetcher.data;

  const runSearch = () => {
    const clean = query.trim();

    if (!clean) {
      return;
    }

    const params = new URLSearchParams({ q: clean, mode });

    fetcher.load(`/api/search-preview?${params.toString()}`);
  };

  return (
    <s-page heading="Search Preview">
      <s-section heading="Test a Search Query">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Enter a query the way a customer would search your
            storefront. This calls the same backend search API
            the theme search bar uses.
          </s-paragraph>

          <s-search-field
            label="Search query"
            placeholder="e.g. best shampoo for hair fall"
            value={query}
            onChange={(event) => setQuery(event?.currentTarget?.value ?? "")}
          />

          <s-choice-list
            label="Mode"
            name="mode"
            multiple={false}
            values={[mode]}
            onChange={(event) =>
              setMode(event?.currentTarget?.values?.[0] || "final")
            }
          >
            <s-choice value="final" details="The full AI-ranked search customers get on the results page.">
              Final
            </s-choice>
            <s-choice value="preview" details="The fast predictive-search path used while typing.">
              Preview
            </s-choice>
          </s-choice-list>

          <s-button
            variant="primary"
            onClick={runSearch}
            {...(isLoading ? { loading: true } : {})}
            {...(!query.trim() ? { disabled: true } : {})}
          >
            {isLoading ? "Searching…" : "Run Search"}
          </s-button>

          {result?.success === false && (
            <s-banner tone="critical">
              {result.message || "Search failed"}
            </s-banner>
          )}

          {result?.success === true && (
            <s-stack direction="block" gap="base">
              <s-box padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small-200">
                  <s-text>Intent: {result.intent || "—"}</s-text>
                  {result.resultType && (
                    <s-text>Result type: {result.resultType}</s-text>
                  )}
                  {result.message && (
                    <s-text color="subdued">{result.message}</s-text>
                  )}
                  <s-text color="subdued">
                    Candidate counts and retrieval timings are
                    only written to the backend&apos;s server
                    logs — the search API response does not
                    include them, so they cannot be shown here.
                  </s-text>
                </s-stack>
              </s-box>

              {Array.isArray(result.products) && result.products.length > 0 ? (
                <s-grid
                  gridTemplateColumns="repeat(auto-fill, minmax(200px, 1fr))"
                  gap="base"
                >
                  {result.products.map((product, index) => (
                    <s-grid-item key={product.sku || index}>
                      <s-box padding="base" borderWidth="base" borderRadius="base">
                        <s-stack direction="block" gap="small-200">
                          <s-text color="subdued">#{index + 1}</s-text>
                          <s-text type="strong">
                            {product.title || "Untitled product"}
                          </s-text>
                          <s-text color="subdued">SKU: {product.sku}</s-text>
                          {typeof product.recommendationScore === "number" && (
                            <s-text color="subdued">
                              Score: {product.recommendationScore}
                            </s-text>
                          )}
                        </s-stack>
                      </s-box>
                    </s-grid-item>
                  ))}
                </s-grid>
              ) : (
                <s-banner tone="info">No products returned for this query.</s-banner>
              )}
            </s-stack>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}
