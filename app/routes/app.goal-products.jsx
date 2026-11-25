import { useEffect, useRef, useState } from "react";
import { Link, useFetcher, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import { backendInternalFetch } from "../utils/backend.server";
import {
  Banner,
  Button,
  EmptyState,
  Icon,
  LinkButton,
  Page,
  TextField,
  initials
} from "../components/ui";


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

// Products per page in the product list.
const PAGE_SIZE = 10;

/*
 * "Current Top Search Products" (rule test panel, including its
 * search-type descriptions) is hidden for now. Set to true to
 * show it again; nothing else depends on it.
 */
const SHOW_RULE_TEST_PANEL = false;

const SEARCH_DEBOUNCE_MS = 400;


// Sort choices for "Choose products" (applied by the backend).
const SORT_OPTIONS = [
  { value: "title_asc", label: "Name, A–Z" },
  { value: "title_desc", label: "Name, Z–A" },
  { value: "price_asc", label: "Price, low to high" },
  { value: "price_desc", label: "Price, high to low" }
];


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
 * Look of each rule type (icon + soft tone), matching the
 * dashboard. Display only.
 */
const RULE_LOOK = {
  boost: { icon: "arrowUp", tone: "sage" },
  demote: { icon: "arrowDown", tone: "sage" },
  exclude: { icon: "eyeOff", tone: "sage" }
};


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
   * Sort / filters for the product list. Applied by the backend
   * to the whole catalog (not just the page on screen), so they
   * stay correct across pages. Defaults = the original list.
   */
  const [sort, setSort] = useState("title_asc");
  const [productType, setProductType] = useState("");
  const [productTypes, setProductTypes] = useState([]);

  /*
   * Bumped to reload the current list in the background, so
   * products that come back in stock appear (and sold-out ones
   * disappear) without the merchant refreshing the page.
   */
  const [refreshTick, setRefreshTick] = useState(0);


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


    if (sort !== "title_asc") {
      params.set("sort", sort);
    }

    // Only in-stock products can be chosen: out-of-stock products
    // never show in storefront search anyway.
    params.set("inStock", "1");

    if (productType) {
      params.set("productType", productType);
    }


    fetcherRef.current.load(
      `/api/goal/products?${params.toString()}`
    );

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, sort, productType, refreshTick]);


  /*
   * Stock changes reach the app's catalog through Shopify's
   * inventory/product webhooks. Reload the list every minute
   * while the page is visible, and when the merchant returns to
   * the tab, so it always matches current stock.
   */
  useEffect(() => {
    const REFRESH_MS = 60000;

    const refresh = () => {
      if (
        document.visibilityState === "visible" &&
        fetcherRef.current.state === "idle"
      ) {
        setRefreshTick((tick) => tick + 1);
      }
    };

    const timer = setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);


  // Keep the last known product types so the filter list does
  // not flicker while a page is loading.
  useEffect(() => {
    const types = fetcher.data?.data?.productTypes;

    if (Array.isArray(types)) {
      setProductTypes(types);
    }
  }, [fetcher.data]);


  // A new sort or filter starts again from page 1.
  const changeSort = (value) => {
    setSort(value);
    setPage(1);
  };

  const changeProductType = (value) => {
    setProductType(value);
    setPage(1);
  };

  const hasActiveFilters =
    sort !== "title_asc" || Boolean(productType);

  const clearFilters = () => {
    setSort("title_asc");
    setProductType("");
    setPage(1);
  };


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


  /*
   * Search always uses the SAVED rule, so the rule test panel
   * warns when the form differs from it.
   */
  const savedKeys =
    (savedGoal?.skus || []).slice().sort().join("|");

  const draftKeys =
    selectedProducts
      .map(product => product.matchKey)
      .sort()
      .join("|");

  const hasUnsavedRuleChanges =
    savedGoal
      ? (ruleType || "") !== (savedGoal.ruleType || "") ||
        draftKeys !== savedKeys
      : Boolean(ruleType) || selectedProducts.length > 0;


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

  /*
   * Display only: whether the form differs from the saved rule
   * (name included), so the Save button can show "Save rule"
   * vs "Saved".
   */
  const hasFormChanges = savedGoal
    ? ruleName.trim() !== (savedGoal.name || "").trim() || hasUnsavedRuleChanges
    : Boolean(ruleName.trim()) || hasUnsavedRuleChanges;



  const selectedChips = selectedProducts.length > 0 && (
    <div className="gr-chips">
      {selectedProducts.map((product) => (
        <span className="gr-chip" key={product.matchKey}>
          <span className="gr-chip__thumb">
            {product.image ? (
              <img src={product.image} alt="" />
            ) : (
              initials(product.title || product.sku)
            )}
          </span>
          <span className="gr-chip__text" title={product.title || product.sku || ""}>
            {product.title || "Untitled product"}
          </span>
          <button
            type="button"
            className="gr-chip__remove"
            aria-label={`Remove ${product.title || "product"}`}
            onClick={() => removeSelected(product.matchKey)}
          >
            <Icon name="close" size={12} strokeWidth={2.2} />
          </button>
        </span>
      ))}
    </div>
  );


  return (
    <Page>
      {/* ---------- Header ---------- */}
      <header className="dash-hero">
        <div className="dash-hero__text">
          <Link to="/app" className="gr-back">
            <Icon name="back" size={13} />
            Dashboard
          </Link>
          <h1 className="dash-hero__title">Goals &amp; rules</h1>
          <p className="dash-hero__sub">
            Choose products and decide where they appear in your store&apos;s search results:
            higher, lower, or not at all.
          </p>
        </div>

        <div className="dash-hero__side">
          <span className={`dash-pill${savedGoal ? "" : " dash-pill--warn"}`}>
            <span className="dash-pill__dot" aria-hidden="true" />
            {savedGoal
              ? `Rule saved${savedGoal.ruleType ? ` · ${RULE_TYPES.find(rule => rule.value === savedGoal.ruleType)?.label || savedGoal.ruleType}` : ""}`
              : "No rule yet"}
          </span>
        </div>
      </header>

      {/* =================================================
        // 1. RULE
        // ================================================= */}

      {!isRuleFormOpen ? (
        <section className="dash-card" aria-labelledby="gr-intro">
          <div className="dash-card__head">
            <h2 id="gr-intro" className="dash-card__title">What a rule can do</h2>
            <span className="dash-card__meta">One rule per store</span>
          </div>

          <div className="gr-types gr-types--static">
            {RULE_TYPES.map((rule) => (
              <div className="gr-type" key={rule.value}>
                <span className={`dash-icon dash-tone--${RULE_LOOK[rule.value].tone}`} aria-hidden="true">
                  <Icon name={RULE_LOOK[rule.value].icon} size={15} />
                </span>
                <span className="gr-type__label">{rule.label}</span>
                <span className="gr-type__text">{rule.description}</span>
              </div>
            ))}
          </div>

          <div className="gr-intro__action">
            <Button variant="primary" size="sm" icon="plus" onClick={() => setIsRuleFormOpen(true)}>
              Create a rule
            </Button>
            <span className="ui-help">Takes about a minute. Nothing changes until you save.</span>
          </div>
        </section>
      ) : (
        <section className="dash-card" aria-labelledby="gr-rule">
          <div className="dash-card__head">
            <h2 id="gr-rule" className="dash-card__title">
              {savedGoal ? "Your rule" : "New rule"}
            </h2>
            {hasFormChanges && canSave && !isSaving ? (
              <span className="gr-unsaved">
                <span className="dash-pill__dot" aria-hidden="true" />
                Unsaved changes
              </span>
            ) : (
              <span className="dash-card__meta">3 quick steps</span>
            )}
          </div>

          <ol className="gr-steps">
            <li className="gr-step">
              <span className={`dash-num ${ruleName.trim() ? "dash-tone--sage" : "dash-tone--slate"}`} aria-hidden="true">
                {ruleName.trim() ? <Icon name="check" size={13} strokeWidth={2.4} /> : "1"}
              </span>
              <div className="gr-step__body">
                <label htmlFor="rule-name" className="gr-step__title">Name your rule</label>
                <p className="gr-step__text">Only you see this name. It helps you remember what the rule is for.</p>
                <div className="gr-step__field">
                  <TextField
                    id="rule-name"
                    placeholder="e.g. Push winter stock"
                    value={ruleName}
                    onChange={setRuleName}
                  />
                </div>
              </div>
            </li>

            <li className="gr-step">
              <span className={`dash-num ${ruleType ? "dash-tone--sage" : "dash-tone--mauve"}`} aria-hidden="true">
                {ruleType ? <Icon name="check" size={13} strokeWidth={2.4} /> : "2"}
              </span>
              <div className="gr-step__body">
                <span className="gr-step__title" id="rule-type-label">What should it do?</span>
                <p className="gr-step__text">Pick one. You can change it anytime.</p>

                <div className="gr-types" role="radiogroup" aria-labelledby="rule-type-label">
                  {RULE_TYPES.map((rule) => {
                    const checked = ruleType === rule.value;
                    const look = RULE_LOOK[rule.value];

                    return (
                      <label key={rule.value} className={`gr-type gr-type--choice${checked ? " is-checked" : ""}`}>
                        <input
                          type="radio"
                          name="ruleType"
                          value={rule.value}
                          checked={checked}
                          onChange={() => setRuleType(rule.value)}
                          className="gr-type__input"
                        />
                        <span className={`dash-icon dash-tone--${look.tone}`} aria-hidden="true">
                          <Icon name={look.icon} size={15} />
                        </span>
                        <span className="gr-type__label">{rule.label}</span>
                        <span className="gr-type__text">{rule.description}</span>
                        <span className="gr-type__check" aria-hidden="true">
                          <Icon name="check" size={11} strokeWidth={2.6} />
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </li>

            <li className="gr-step">
              <span className={`dash-num ${selectedProducts.length ? "dash-tone--sage" : "dash-tone--teal"}`} aria-hidden="true">
                {selectedProducts.length ? <Icon name="check" size={13} strokeWidth={2.4} /> : "3"}
              </span>
              <div className="gr-step__body">
                <span className="gr-step__title">
                  Pick products
                  <span className="gr-count">{selectedProducts.length} selected</span>
                </span>
                <p className="gr-step__text">
                  {selectedProducts.length
                    ? "Remove one with ×, or tick more in the product list below."
                    : "Tick the products in the list below."}
                </p>
                {selectedChips && <div className="gr-step__field">{selectedChips}</div>}
              </div>
            </li>
          </ol>

          {/* Save */}
          <div className="gr-save">
            {goalActionResult?.success === true &&
              isSaving === false &&
              isDeleting === false &&
              !hasFormChanges && (
                <Banner tone="success">
                  {goalActionResult?.deleted !== undefined
                    ? goalActionResult.deleted
                      ? "Rule deleted."
                      : "There was no saved rule to delete."
                    : "Rule saved. It now applies to your store's search."}
                </Banner>
              )}

            {goalActionResult?.success === false && (
              <Banner tone="warning">
                {goalActionResult?.message || "The rule couldn't be saved. Please try again."}
              </Banner>
            )}

            <div className="gr-save__actions">
              {savedGoal && !hasFormChanges && !isSaving ? (
                <Button variant="secondary" size="sm" icon="check" disabled>
                  Saved
                </Button>
              ) : (
                <Button
                  variant={canSave ? "primary" : "secondary"}
                  size="sm"
                  loading={isSaving}
                  disabled={!canSave}
                  onClick={saveRule}
                >
                  {isSaving ? "Saving…" : "Save rule"}
                </Button>
              )}

              {savedGoal && (
                <LinkButton disabled={isDeleting} onClick={deleteRule}>
                  {isDeleting ? "Deleting…" : "Delete rule"}
                </LinkButton>
              )}

            </div>
          </div>
        </section>
      )}

      {/* =================================================
        // 2. SELECTED PRODUCTS (shown here only while no rule
        //    form is open; inside the form they are step 3)
        // ================================================= */}

      {!isRuleFormOpen && selectedProducts.length > 0 && (
        <section className="dash-card" aria-labelledby="gr-selected">
          <div className="dash-card__head">
            <h2 id="gr-selected" className="dash-card__title">
              Selected products ({selectedProducts.length})
            </h2>
          </div>
          {selectedChips}
        </section>
      )}

      {/* =================================================
        // 3. CURRENT TOP SEARCH PRODUCTS
        // ================================================= */}

      {SHOW_RULE_TEST_PANEL && (
        <RuleTestPanel savedGoal={savedGoal} hasUnsavedChanges={hasUnsavedRuleChanges} />
      )}

      {/* =================================================
        // 4. ALL PRODUCTS
        // ================================================= */}

      <section className="dash-card" aria-labelledby="gr-products">
        <div className="dash-card__head">
          <div>
            <h2 id="gr-products" className="dash-card__title">Product list</h2>
            <p className="gr-card-sub">
              In-stock products only, the ones shoppers can find. The list updates on its own as stock changes.
            </p>
          </div>
          <span className={`gr-count${selected.size ? " gr-count--on" : ""}`}>
            {selected.size} selected
          </span>
        </div>

        <div className="ui-stack" style={{ gap: 12 }}>
          <div className="gr-toolbar">
            <TextField
              id="product-search"
              aria-label="Search products"
              icon="search"
              placeholder="Search by title, SKU or handle"
              value={searchInput}
              onChange={setSearchInput}
            />

            <div className="gr-filters">
              <label className="gr-filter">
                <span className="gr-filter__label">Sort by</span>
                <select
                  className="gr-select"
                  value={sort}
                  onChange={(event) => changeSort(event.target.value)}
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="gr-filter">
                <span className="gr-filter__label">Type</span>
                <select
                  className="gr-select"
                  value={productType}
                  onChange={(event) => changeProductType(event.target.value)}
                  disabled={productTypes.length === 0 && !productType}
                >
                  <option value="">All types</option>
                  {productTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                  {productType && !productTypes.includes(productType) && (
                    <option value={productType}>{productType}</option>
                  )}
                </select>
              </label>

              {hasActiveFilters && (
                <LinkButton tone="accent" onClick={clearFilters}>
                  Clear filters
                </LinkButton>
              )}
            </div>
          </div>

          {failed && (
            <Banner tone="warning">
              {response?.message || "Products couldn't be loaded. Please try again."}
            </Banner>
          )}

          {isLoading && products.length === 0 && (
            <div className="ui-empty">
              <span className="ui-spinner ui-spinner--accent" aria-hidden="true" />
              <div>Loading products…</div>
            </div>
          )}

          {isEmpty && (
            <EmptyState icon="box">
              {search
                ? `No products match "${search}".`
                : hasActiveFilters
                  ? "No products match these filters."
                  : "No in-stock products right now. Sync your catalog from the Dashboard if this looks wrong."}
            </EmptyState>
          )}

          {products.length > 0 && (
            <div
              className={`gr-list${isLoading ? " gr-list--loading" : ""}`}
              role="group"
              aria-label="Products"
              aria-busy={isLoading || undefined}
            >
              <label className="gr-list__head">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={toggleSelectAllOnPage}
                  aria-label={allOnPageSelected ? "Deselect all on this page" : "Select all on this page"}
                />
                <span />
                <span>Product</span>
                <span>Price</span>
              </label>

              {products.map((product) => {
                const isSelected = selected.has(product.matchKey);

                return (
                  <label
                    key={product.matchKey}
                    className={`gr-row${isSelected ? " gr-row--selected" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleProduct(product)}
                      aria-label={`Select ${product.title || product.sku || "product"}`}
                    />
                    <span className="gr-thumb">
                      {product.image ? (
                        <img src={product.image} alt="" loading="lazy" />
                      ) : (
                        initials(product.title || product.sku)
                      )}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span className="gr-row__title">{product.title || "Untitled product"}</span>
                      {product.sku && <span className="gr-row__meta">SKU: {product.sku}</span>}
                    </span>
                    <span className="gr-row__price">
                      {typeof product.price === "number" ? `$${product.price.toFixed(2)}` : "—"}
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          {products.length > 0 && (
            <div className="gr-footer">
              <span>Page {page}</span>
              <div className="gr-pager">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={goToPreviousPage}>
                  Previous
                </Button>
                <Button variant="secondary" size="sm" disabled={!hasMore} onClick={goToNextPage}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>
    </Page>
  );
}


// =========================================================
// CURRENT TOP SEARCH PRODUCTS (RULE TEST)
// =========================================================
//
// Search ranking only exists per query, so the seller types a
// search and sees the real top results customers get right
// now — the same backend search the storefront uses, through
// the admin-only /api/search-preview route — with the SAVED
// rule applied by the backend. Products the saved rule targets
// are labelled so the rule's effect is visible.
// =========================================================

const RULE_BADGES = {
  boost: { label: "Boosted", tone: "success" },
  demote: { label: "Demoted", tone: "warning" }
};

// Plain JS page without prop-types (same as the rest of the app).
/* eslint-disable react/prop-types */
function RuleTestPanel({
  savedGoal,
  hasUnsavedChanges
}) {

  const fetcher = useFetcher();

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("final");

  const isLoading = fetcher.state !== "idle";
  const result = fetcher.data;
  const products = Array.isArray(result?.products) ? result.products : [];

  const activeRule =
    savedGoal?.enabled !== false &&
    savedGoal?.ruleType &&
    Array.isArray(savedGoal?.skus) &&
    savedGoal.skus.length
      ? savedGoal
      : null;

  const targetKeys = new Set(activeRule?.skus || []);

  const runSearch = () => {
    const clean = query.trim();

    if (!clean) {
      return;
    }

    fetcher.load(
      `/api/search-preview?${new URLSearchParams({ q: clean, mode }).toString()}`
    );
  };

  /*
   * Boost only lifts products that are relevant to the search,
   * so explain an "absent" boosted product only when it matters.
   */
  const boostedMissing =
    result?.success === true &&
    activeRule?.ruleType === "boost" &&
    !products.some(product => targetKeys.has(product.matchKey));

  return (
    <s-section heading="Current Top Search Products">

      <s-stack direction="block" gap="base">

        <s-paragraph>
          Type a search the way a customer would to see the top
          products your store returns for it right now, with your
          saved rule applied.
        </s-paragraph>

        {
          hasUnsavedChanges && (
            <s-banner tone="warning">
              You have unsaved rule changes. Results use the last
              saved rule until you click Save Rule.
            </s-banner>
          )
        }

        <s-search-field
          label="Search"
          placeholder="e.g. jacket"
          value={query}
          onChange={(event) => setQuery(event?.currentTarget?.value ?? "")}
        />

        <s-choice-list
          label="Search type"
          name="ruleTestMode"
          multiple={false}
          values={[mode]}
          onChange={(event) =>
            setMode(event?.currentTarget?.values?.[0] || "final")
          }
        >
          <s-choice value="final" details="The AI-ranked results page customers get after pressing Enter.">
            Search results page
          </s-choice>
          <s-choice value="preview" details="The instant suggestions shown while typing.">
            Instant suggestions
          </s-choice>
        </s-choice-list>

        <s-button
          variant="primary"
          onClick={runSearch}
          {...(isLoading ? { loading: true } : {})}
          {...(!query.trim() ? { disabled: true } : {})}
        >
          {isLoading ? "Searching…" : "Show Top Products"}
        </s-button>

        {
          result?.success === false && (
            <s-banner tone="critical">
              {result.message || "Search failed"}
            </s-banner>
          )
        }

        {
          result?.success === true && result.message && (
            <s-text color="subdued">{result.message}</s-text>
          )
        }

        {
          result?.success === true && (
            products.length ? (

              <s-stack direction="block" gap="small-200">
                {
                  products.map((product, index) => {

                    const badge =
                      targetKeys.has(product.matchKey)
                        ? RULE_BADGES[activeRule.ruleType]
                        : null;

                    return (
                      <s-box
                        key={product.matchKey || index}
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
                          <s-stack direction="inline" gap="base" alignItems="center">

                            <s-text type="strong">#{index + 1}</s-text>

                            {
                              product.image && (
                                <s-thumbnail
                                  src={product.image}
                                  alt={product.title || ""}
                                  size="small"
                                />
                              )
                            }

                            <s-stack direction="block" gap="small-200">
                              <s-text type="strong">
                                {product.title || "Untitled product"}
                              </s-text>
                              <s-text color="subdued">
                                {product.sku ? `SKU: ${product.sku}` : "No SKU"}
                              </s-text>
                            </s-stack>

                          </s-stack>

                          {
                            badge && (
                              <s-badge tone={badge.tone}>
                                {badge.label}
                              </s-badge>
                            )
                          }
                        </s-stack>
                      </s-box>
                    );
                  })
                }
              </s-stack>

            ) : (

              <s-text color="subdued">
                No products found for this search.
              </s-text>

            )
          )
        }

        {
          boostedMissing && products.length > 0 && (
            <s-text color="subdued">
              None of your boosted products appear here. Boost only
              moves a product to the top for searches it is relevant
              to — try a search that matches one of them.
            </s-text>
          )
        }

      </s-stack>

    </s-section>
  );
}
/* eslint-enable react/prop-types */
