import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import { backendInternalFetch } from "../utils/backend.server";


// =========================================================
// GOAL PRODUCTS — CATALOG BROWSER + GOAL/RULE EDITOR
// =========================================================
//
// This page lists the already-synced MongoDB catalog, lets the
// merchant select products, and lets them draft + save a
// single rule (name, type, selected products) for this shop.
//
// The saved goal is loaded on mount via this route's own
// loader (GET /api/internal/goal, server-side), and saved/
// deleted via a second fetcher against api.goal.ts (PUT/DELETE
// /api/internal/goal). Only one goal may ever exist per shop —
// enforced by the backend's unique index — matching the
// Phase 1 data model.
//
// Product browsing data comes from GET /api/goal/products, an
// authenticated resource route (api.goal.products.ts) that
// proxies to the backend's internal goal-products API. The
// backend URL and internal secret never reach this component;
// they are only used server-side inside these loaders/actions.
//
// Selection is keyed by SKU — the same product identifier
// used everywhere else in this app (Product model, AI catalog,
// Qdrant payloads) — and stored in a Map so the full product
// snapshot (title/image/price) survives page changes and
// searches without needing to re-fetch it for the summary.
//
// Rule behavior (Boost/Exclude/Demote) is stored but NOT yet
// read by search.service.js — wiring it into search ranking is
// a separate, later phase.
// =========================================================

const PAGE_SIZE = 25;

const SEARCH_DEBOUNCE_MS = 400;


/*
 * The three rule types a seller can choose from, each with the
 * seller-facing description it must show. This is UI copy only
 * — it has no effect on search yet.
 */
const RULE_TYPES = [
  {
    value: "boost",
    label: "Boost",
    description:
      "Promote selected products to the top of search results."
  },
  {
    value: "exclude",
    label: "Exclude",
    description:
      "Hide selected products from website search results."
  },
  {
    value: "demote",
    label: "Demote",
    description:
      "Push selected products lower in search results."
  }
];


/*
 * Load the shop's existing saved goal (if any) so the page can
 * hydrate the rule form and selection with real backend data
 * instead of starting blank every time it's opened.
 */
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  // Safe to log: shop domain only, no secrets, no body content.
  console.log("[GOAL PRODUCTS PAGE] loader", { shop: session.shop });

  const result = await backendInternalFetch("/api/internal/goal", {
    searchParams: { shop: session.shop },
    signal: request.signal
  });

  if (!result.ok) {
    console.warn("[GOAL PRODUCTS PAGE] failed to load saved goal", {
      shop: session.shop,
      status: result.status
    });
  }

  return {
    savedGoal: result.ok ? result.data?.data || null : null
  };
};


export default function GoalProducts() {

  const { savedGoal } =
    useLoaderData();

  const fetcher =
    useFetcher();

  /*
   * A separate fetcher for saving/deleting the goal, so it
   * does not interfere with the product-listing fetcher above.
   */
  const goalFetcher =
    useFetcher();


  const [
    searchInput,
    setSearchInput
  ] =
    useState("");

  const [
    search,
    setSearch
  ] =
    useState("");

  const [
    page,
    setPage
  ] =
    useState(1);


  /*
   * Selected products, keyed by SKU. A Map (rather than a Set
   * of SKUs) also keeps the product snapshot the summary
   * section needs, so switching pages or searching never loses
   * what a selected product looked like.
   */
  const [
    selected,
    setSelected
  ] =
    useState(
      () => new Map()
    );


  /*
   * Rule draft state. Collapsed until the seller clicks
   * "Add Rule"; once open it stays open so the rule type and
   * name can be changed freely — there is no "locked in" state
   * before an actual save exists.
   */
  const [
    isRuleFormOpen,
    setIsRuleFormOpen
  ] =
    useState(false);

  const [
    ruleName,
    setRuleName
  ] =
    useState("");

  const [
    ruleType,
    setRuleType
  ] =
    useState("");


  /*
   * Hydrate from the saved goal exactly once, on mount. This
   * intentionally does not re-run on navigation/re-render, so
   * it never clobbers edits the seller is actively making.
   */
  useEffect(() => {

    if (!savedGoal) {

      return;
    }


    setRuleName(savedGoal.name || "");

    setRuleType(savedGoal.ruleType || "");

    setIsRuleFormOpen(true);


    if (Array.isArray(savedGoal.products) && savedGoal.products.length) {

      setSelected(
        new Map(
          savedGoal.products.map(
            product => [product.matchKey, product]
          )
        )
      );

    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  /*
   * Debounce the raw input before it drives a request. Typing
   * always resets back to page 1, since a new search term
   * invalidates whatever page the previous term was on.
   */
  useEffect(() => {

    const timer =
      setTimeout(() => {

        setSearch(
          searchInput.trim()
        );

        setPage(1);

      }, SEARCH_DEBOUNCE_MS);


    return () =>
      clearTimeout(timer);

  }, [searchInput]);


  const fetcherRef =
    useRef(fetcher);

  fetcherRef.current =
    fetcher;


  useEffect(() => {

    const params =
      new URLSearchParams();


    params.set(
      "page",
      String(page)
    );

    params.set(
      "limit",
      String(PAGE_SIZE)
    );


    if (search) {

      params.set(
        "search",
        search
      );

    }


    fetcherRef.current.load(
      `/api/goal/products?${params.toString()}`
    );

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search]);


  const isLoading =
    fetcher.state !== "idle";

  const response =
    fetcher.data;

  const succeeded =
    response?.success === true;

  const failed =
    response?.success === false;

  const products =
    succeeded &&
    Array.isArray(response?.data?.products)
      ? response.data.products
      : [];

  const hasMore =
    succeeded
      ? Boolean(response?.data?.hasMore)
      : false;

  const isEmpty =
    succeeded &&
    !isLoading &&
    products.length === 0;


  const goToPreviousPage = () => {

    setPage(
      current =>
        Math.max(1, current - 1)
    );

  };


  const goToNextPage = () => {

    if (!hasMore) {

      return;
    }


    setPage(
      current => current + 1
    );

  };


  /*
   * Toggle a single product's selection, keeping every other
   * selected product (on this page or any other) untouched.
   */
  const toggleProduct = (
    product
  ) => {

    setSelected(
      current => {

        const next =
          new Map(current);


        if (
          next.has(product.matchKey)
        ) {

          next.delete(
            product.matchKey
          );

        } else {

          next.set(
            product.matchKey,
            product
          );

        }


        return next;

      }
    );

  };


  const removeSelected = (
    matchKey
  ) => {

    setSelected(
      current => {

        if (
          !current.has(matchKey)
        ) {

          return current;
        }


        const next =
          new Map(current);


        next.delete(matchKey);


        return next;

      }
    );

  };


  /*
   * "Select all" / "Deselect all" only ever acts on the products
   * currently on screen. Selections on other pages are left as
   * they are, matching requirement 3 (current page only).
   */
  const allOnPageSelected =
    products.length > 0 &&
    products.every(
      product =>
        selected.has(product.matchKey)
    );


  const toggleSelectAllOnPage = () => {

    setSelected(
      current => {

        const next =
          new Map(current);


        if (allOnPageSelected) {

          for (
            const product
            of products
          ) {

            next.delete(
              product.matchKey
            );

          }

        } else {

          for (
            const product
            of products
          ) {

            next.set(
              product.matchKey,
              product
            );

          }

        }


        return next;

      }
    );

  };


  const selectedProducts =
    Array.from(
      selected.values()
    );


  const selectedRuleType =
    RULE_TYPES.find(
      rule =>
        rule.value === ruleType
    ) ||
    null;


  const isSaving =
    goalFetcher.state !== "idle" &&
    goalFetcher.formMethod === "PUT";

  const isDeleting =
    goalFetcher.state !== "idle" &&
    goalFetcher.formMethod === "DELETE";

  const goalActionResult =
    goalFetcher.data;

  const saveRule = () => {

    goalFetcher.submit(
      {
        name: ruleName.trim(),
        ruleType: ruleType || undefined,
        skus: selectedProducts.map(
          product => product.matchKey
        ),
        products: selectedProducts
      },
      {
        method: "PUT",
        action: "/api/goal",
        encType: "application/json"
      }
    );

  };

  const deleteRule = () => {

    goalFetcher.submit(
      {},
      {
        method: "DELETE",
        action: "/api/goal"
      }
    );

    setSelected(new Map());
    setRuleName("");
    setRuleType("");
    setIsRuleFormOpen(false);

  };

  const canSave =
    ruleName.trim().length > 0 &&
    Boolean(ruleType) &&
    selectedProducts.length > 0;


  return (
    <s-page heading="Goal Products">

      {/* =================================================
        // 1. ADD RULE
        // ================================================= */}

      <s-section heading="Add Rule">

        <s-stack
          direction="block"
          gap="base"
        >

          {
            !isRuleFormOpen && (

              <s-button
                onClick={
                  () =>
                    setIsRuleFormOpen(true)
                }
              >
                + Add Rule
              </s-button>

            )
          }

          {
            isRuleFormOpen && (

              <s-stack
                direction="block"
                gap="base"
              >

                <s-paragraph>
                  Choose how this rule should affect the
                  products selected below. The rule type and
                  name can be changed at any time before saving.
                </s-paragraph>

                <s-text-field
                  label="Rule Name"
                  placeholder="e.g. Clear Stack"
                  value={ruleName}
                  onChange={
                    event =>
                      setRuleName(
                        event?.currentTarget?.value ?? ""
                      )
                  }
                />

                <s-choice-list
                  label="Rule Type"
                  name="ruleType"
                  multiple={false}
                  values={
                    ruleType
                      ? [ruleType]
                      : []
                  }
                  onChange={
                    event =>
                      setRuleType(
                        event?.currentTarget?.values?.[0] ?? ""
                      )
                  }
                >

                  {
                    RULE_TYPES.map(
                      rule => (

                        <s-choice
                          key={rule.value}
                          value={rule.value}
                          details={rule.description}
                        >
                          {rule.label}
                        </s-choice>

                      )
                    )
                  }

                </s-choice-list>

                <s-box
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                >

                  <s-stack
                    direction="block"
                    gap="small"
                  >

                    <s-text type="strong">
                      Rule Summary
                    </s-text>

                    <s-text>
                      Name:{" "}
                      {
                        ruleName.trim() ||
                        "Not set"
                      }
                    </s-text>

                    <s-text>
                      Type:{" "}
                      {
                        selectedRuleType
                          ? selectedRuleType.label
                          : "Not selected"
                      }
                    </s-text>

                    <s-text color="subdued">
                      {
                        selectedRuleType
                          ? selectedRuleType.description
                          : "Choose a rule type above to see what it does."
                      }
                    </s-text>

                    <s-text color="subdued">
                      Applies to{" "}
                      {selectedProducts.length}{" "}
                      selected{" "}
                      {
                        selectedProducts.length === 1
                          ? "product"
                          : "products"
                      }
                      .
                    </s-text>

                  </s-stack>

                </s-box>

                {
                  goalActionResult?.success === true &&
                  isSaving === false &&
                  isDeleting === false && (

                    <s-banner tone="success">
                      {
                        goalActionResult?.deleted !== undefined
                          ? (
                              goalActionResult.deleted
                                ? "Rule deleted."
                                : "No saved rule existed to delete."
                            )
                          : "Rule saved."
                      }
                    </s-banner>

                  )
                }

                {
                  goalActionResult?.success === false && (

                    <s-banner tone="critical">
                      {
                        goalActionResult?.message ||
                        "Unable to save the rule."
                      }
                    </s-banner>

                  )
                }

                <s-stack
                  direction="inline"
                  gap="base"
                  alignItems="center"
                >

                  <s-button
                    variant="primary"
                    onClick={saveRule}
                    {...(isSaving ? { loading: true } : {})}
                    {...(!canSave ? { disabled: true } : {})}
                  >
                    {isSaving ? "Saving…" : "Save Rule"}
                  </s-button>

                  {
                    savedGoal && (

                      <s-button
                        variant="tertiary"
                        onClick={deleteRule}
                        {...(isDeleting ? { loading: true } : {})}
                      >
                        {isDeleting ? "Deleting…" : "Delete Rule"}
                      </s-button>

                    )
                  }

                </s-stack>

                {
                  !canSave && (

                    <s-text color="subdued">
                      A rule name, a rule type, and at least one
                      selected product are required before
                      saving.
                    </s-text>

                  )
                }

              </s-stack>

            )
          }

        </s-stack>

      </s-section>

      {/* =================================================
        // 2. SELECTED PRODUCTS
        // ================================================= */}

      <s-section
        heading={`Selected Products (${selectedProducts.length})`}
      >

        <s-stack
          direction="block"
          gap="base"
        >

          {
            selectedProducts.length === 0 ? (

              <s-paragraph>
                No products selected yet. Check the boxes in
                &quot;All Products&quot; below to add products
                to this rule.
              </s-paragraph>

            ) : (

              <s-stack
                direction="block"
                gap="small-200"
              >

                {
                  selectedProducts.map(
                    product => (

                      <s-box
                        key={product.matchKey}
                        padding="small"
                        borderWidth="base"
                        borderRadius="base"
                      >

                        <s-stack
                          direction="inline"
                          gap="base"
                          alignItems="center"
                          justifyContent="space-between"
                        >

                          <s-stack
                            direction="inline"
                            gap="base"
                            alignItems="center"
                          >

                            {
                              product.image ? (

                                <s-thumbnail
                                  src={product.image}
                                  alt={product.title || product.sku}
                                  size="small"
                                />

                              ) : (

                                <s-text color="subdued">
                                  No image
                                </s-text>

                              )
                            }

                            <s-stack
                              direction="block"
                              gap="small-200"
                            >

                              <s-text type="strong">
                                {
                                  product.title ||
                                  "Untitled product"
                                }
                              </s-text>

                              <s-text color="subdued">
                                {
                                  product.sku
                                    ? `SKU: ${product.sku}`
                                    : "No SKU"
                                }
                              </s-text>

                            </s-stack>

                          </s-stack>

                          <s-button
                            variant="tertiary"
                            onClick={
                              () =>
                                removeSelected(product.matchKey)
                            }
                          >
                            Remove
                          </s-button>

                        </s-stack>

                      </s-box>

                    )
                  )
                }

              </s-stack>

            )
          }

        </s-stack>

      </s-section>

      {/* =================================================
        // 3. CURRENT TOP SEARCH PRODUCTS
        //
        // The backend has no endpoint or stored data for
        // "what is currently ranking at the top of search
        // results" — search.service.js only ever ranks
        // products live, per customer query; nothing about
        // past or current rankings is logged or aggregated
        // anywhere (confirmed by inspecting
        // backend/src/services/search/search.service.js and
        // its controllers/routes).
        //
        // So this section is a real, honest empty state —
        // not a placeholder standing in for a fetch that was
        // simply left unwired. Do not replace this with fake
        // or invented products.
        // ================================================= */}

      <s-section heading="Current Top Search Products">

        <s-stack
          direction="block"
          gap="base"
        >

          <s-paragraph>
            This section will show which products are
            currently appearing at the top of website search
            results, based on live search ranking.
          </s-paragraph>

          <s-banner tone="info">

            Current search ranking data is not available yet.
            Search results are generated live for each customer
            query — the backend does not currently store or
            expose a ranking of &quot;top&quot; products
            independent of a search term, so there is nothing
            real to show here.
            This section will display live data once that
            capability exists.

          </s-banner>

        </s-stack>

      </s-section>

      {/* =================================================
        // 4. ALL PRODUCTS
        // ================================================= */}

      <s-section heading="All Products">

        <s-stack
          direction="block"
          gap="base"
        >

          <s-paragraph>
            Search and browse every product synced from
            Shopify. Select products here to add them to the
            rule above.
          </s-paragraph>

          <s-search-field
            label="Search products"
            placeholder="Search by title, SKU, or handle"
            value={searchInput}
            onChange={
              event =>
                setSearchInput(
                  event?.currentTarget?.value ?? ""
                )
            }
          />

          <s-stack
            direction="inline"
            gap="base"
            alignItems="center"
          >

            <s-text type="strong">
              {selected.size}{" "}
              {
                selected.size === 1
                  ? "product"
                  : "products"
              }{" "}
              selected
            </s-text>

            {
              !isLoading &&
              products.length > 0 && (

                <s-button
                  onClick={toggleSelectAllOnPage}
                >
                  {
                    allOnPageSelected
                      ? "Deselect all on this page"
                      : "Select all on this page"
                  }
                </s-button>

              )
            }

          </s-stack>

          {
            isLoading && (
              <s-stack
                direction="inline"
                gap="small-200"
                alignItems="center"
              >

                <s-spinner
                  accessibilityLabel="Loading products"
                  size="base"
                />

                <s-text>
                  Loading products…
                </s-text>

              </s-stack>
            )
          }

          {
            failed && (
              <s-banner tone="critical">

                {
                  response?.message ||
                  "Unable to load products"
                }

              </s-banner>
            )
          }

          {
            isEmpty && (
              <s-banner tone="info">

                {
                  search
                    ? `No products found for "${search}".`
                    : "No products found. Sync your Shopify catalog first."
                }

              </s-banner>
            )
          }

          {
            !isLoading &&
            products.length > 0 && (

              <s-grid
                gridTemplateColumns="repeat(auto-fill, minmax(220px, 1fr))"
                gap="base"
              >

                {
                  products.map(
                    product => (

                      <s-grid-item
                        key={product.matchKey}
                      >

                        <s-box
                          padding="base"
                          borderWidth="base"
                          borderRadius="base"
                        >

                          <s-stack
                            direction="block"
                            gap="small"
                          >

                            <s-checkbox
                              label="Select"
                              checked={
                                selected.has(product.matchKey)
                              }
                              onChange={
                                () =>
                                  toggleProduct(product)
                              }
                            />

                            {
                              product.image ? (

                                <s-image
                                  src={product.image}
                                  alt={product.title || product.sku}
                                  inlineSize="fill"
                                  aspectRatio="1/1"
                                  objectFit="cover"
                                  borderRadius="base"
                                />

                              ) : (

                                <s-box
                                  padding="base"
                                  borderWidth="base"
                                  borderRadius="base"
                                >

                                  <s-text
                                    color="subdued"
                                  >
                                    No image
                                  </s-text>

                                </s-box>

                              )
                            }

                            <s-text type="strong">
                              {
                                product.title ||
                                "Untitled product"
                              }
                            </s-text>

                            <s-text color="subdued">
                              {
                                product.sku
                                  ? `SKU: ${product.sku}`
                                  : "No SKU"
                              }
                            </s-text>

                            <s-text>
                              {
                                typeof product.price === "number"
                                  ? `$${product.price.toFixed(2)}`
                                  : "—"
                              }
                            </s-text>

                            <s-badge
                              tone={
                                product.availableForSale
                                  ? "success"
                                  : "critical"
                              }
                            >
                              {
                                product.availableForSale
                                  ? "In stock"
                                  : "Out of stock"
                              }
                            </s-badge>

                          </s-stack>

                        </s-box>

                      </s-grid-item>

                    )
                  )
                }

              </s-grid>

            )
          }

          {
            !isLoading &&
            products.length > 0 && (

              <s-stack
                direction="inline"
                gap="base"
                alignItems="center"
              >

                <s-button
                  onClick={goToPreviousPage}
                  {...(page <= 1 ? { disabled: true } : {})}
                >
                  Previous
                </s-button>

                <s-text>
                  Page {page}
                </s-text>

                <s-button
                  onClick={goToNextPage}
                  {...(!hasMore ? { disabled: true } : {})}
                >
                  Next
                </s-button>

              </s-stack>

            )
          }

        </s-stack>

      </s-section>

    </s-page>
  );
}
