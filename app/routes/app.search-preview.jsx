import { useState } from "react";
import { useFetcher } from "react-router";

import {
  Badge,
  Banner,
  Button,
  Card,
  ChoiceCards,
  EmptyState,
  Page,
  PageHeader,
  ProductMedia,
  TextField
} from "../components/ui";

// =========================================================
// SEARCH PREVIEW
// =========================================================
//
// Lets a seller test the live storefront search from the
// admin. Calls the existing /api/ai-search/search endpoint
// through api.search-preview.ts — the exact same backend
// endpoint the storefront widget uses. No new search logic,
// no ranking change. Only what the API returns is shown.
// =========================================================

const MODES = [
  {
    value: "final",
    label: "Search results page",
    description: "What shoppers get after pressing Enter or picking a question."
  },
  {
    value: "preview",
    label: "Instant suggestions",
    description: "The quick results in the dropdown while shoppers type."
  }
];

// General enough to make sense for any store's catalog.
const EXAMPLES = [
  "a thoughtful gift for a friend",
  "something for everyday use"
];

const MAX_QUERY_LENGTH = 200;

// Plain-language names for the result types the API returns.
// Calm, neutral colours only: none of these is an error.
const RESULT_TYPES = {
  direct: { label: "Exact matches", tone: "accent" },
  recommended: { label: "Recommended", tone: "accent" },
  alternative: { label: "Closest matches" },
  none: { label: "No exact match" }
};

export default function SearchPreview() {
  const fetcher = useFetcher();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("final");
  const [inputError, setInputError] = useState("");
  const [searched, setSearched] = useState(null);

  const isLoading = fetcher.state !== "idle";
  const result = fetcher.data;

  const runSearch = (value = query) => {
    const clean = value.trim();

    if (!clean) {
      setInputError("Type a search first, the way a shopper would.");
      return;
    }

    if (clean.length > MAX_QUERY_LENGTH) {
      setInputError(`Keep it under ${MAX_QUERY_LENGTH} characters.`);
      return;
    }

    setInputError("");
    setSearched({ query: clean, mode });

    const params = new URLSearchParams({ q: clean, mode });

    fetcher.load(`/api/search-preview?${params.toString()}`);
  };

  const tryExample = (example) => {
    setQuery(example);
    runSearch(example);
  };

  const products = Array.isArray(result?.products) ? result.products : [];
  const resultType = RESULT_TYPES[result?.resultType] || null;
  const modeLabel = MODES.find((item) => item.value === searched?.mode)?.label;

  return (
    <Page narrow>
      <PageHeader
        backTo="/app"
        title="Search preview"
        subtitle="See exactly which products shoppers get for any search, before they do."
      />

      <Card>
        <div className="ui-stack" style={{ gap: 16 }}>
          <TextField
            id="preview-query"
            label="What would a shopper search for?"
            icon="search"
            placeholder="e.g. gift for someone who loves coffee"
            value={query}
            maxLength={MAX_QUERY_LENGTH + 1}
            error={inputError || undefined}
            onChange={(value) => {
              setQuery(value);

              if (inputError) {
                setInputError("");
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                runSearch();
              }
            }}
          />

          <div className="pv-examples">
            <span>Try:</span>
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                className="pv-example"
                onClick={() => tryExample(example)}
              >
                {example}
              </button>
            ))}
          </div>

          <ChoiceCards
            name="mode"
            label="Where shoppers see it"
            options={MODES}
            value={mode}
            onChange={setMode}
          />

          <div className="pv-actions">
            <Button
              variant="secondary"
              size="sm"
              icon="sparkle"
              loading={isLoading}
              onClick={() => runSearch()}
            >
              {isLoading ? "Searching…" : "Run search"}
            </Button>
            <span className="ui-help">
              Searches your live catalog. Nothing in your store or app will change.
            </span>
          </div>
        </div>
      </Card>

      {!isLoading && result?.success === false && (
        <Banner tone="critical">
          <p>
            <strong>We couldn&apos;t run this search right now.</strong>{" "}
            {result.message && result.message !== "Search preview failed"
              ? `${result.message}. `
              : ""}
            Please try again in a moment.
          </p>
        </Banner>
      )}

      {result?.success === true && searched ? (
        <Card
          title={`Results for “${searched.query}”`}
          description={
            result.message ||
            `${products.length} ${products.length === 1 ? "product" : "products"}, in the order shoppers see them on the ${modeLabel ? modeLabel.toLowerCase() : "store"}.`
          }
          aside={resultType && <Badge tone={resultType.tone}>{resultType.label}</Badge>}
        >
          {products.length > 0 ? (
            <div className="ui-product-grid">
              {products.map((product, index) => (
                <div className="ui-product" key={product.sku || index}>
                  <span className="ui-rank">#{index + 1}</span>
                  <ProductMedia image={product.image} title={product.title} />
                  <span className="ui-product__title">
                    {product.title || "Untitled product"}
                  </span>
                  <span className="ui-product__meta">
                    {product.sku ? `SKU: ${product.sku}` : "No SKU"}
                  </span>
                  {typeof product.recommendationScore === "number" && (
                    <span className="ui-product__meta">
                      Match score: <strong>{product.recommendationScore}</strong>
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon="search">
              No products found for this search. Try different words, or check that the
              product is active and synced.
            </EmptyState>
          )}
        </Card>
      ) : (
        result?.success !== false &&
        !isLoading && (
          <section className="ui-card ui-card--dashed">
            <EmptyState icon="list">
              Results appear here, ranked in the order shoppers see them.
            </EmptyState>
          </section>
        )
      )}

      {isLoading && (
        <section className="ui-card ui-card--dashed">
          <div className="ui-empty">
            <span className="ui-spinner ui-spinner--accent" aria-hidden="true" />
            <div>Searching your catalog…</div>
          </div>
        </section>
      )}
    </Page>
  );
}
