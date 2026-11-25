(function () {
  "use strict";

  // Prevent duplicate app-embed/script instances from attaching a second
  // set of listeners and sending duplicate AI preview requests.
  // This is intentionally global so separate copies of the same bundle
  // on one storefront share a single runtime.
  const AI_SEARCH_RUNTIME_KEY = "__AI_PRODUCT_SEARCH_RUNTIME__";

  // Keep the runtime state on window so duplicate copies of this bundle
  // cannot create separate request/caching maps. The first copy owns the
  // listeners; later copies exit immediately.
  const existingRuntime = window[AI_SEARCH_RUNTIME_KEY];

  // HARD SINGLETON GUARD. This also handles older versions of the script
  // that stored only `true` in this global. If any copy already owns the
  // storefront, this copy must not attach another input listener.
  if (existingRuntime) {
    return;
  }

  const runtime = {
    initialized: true,
    runtimeId: `ai-search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    cache: new Map(),
    inFlight: new Map(),
    sequence: 0
  };

  window[AI_SEARCH_RUNTIME_KEY] = runtime;

  // =========================================================
  // CONFIG
  // =========================================================

  const CFG = {
  // Preview search is now ~284ms end to end (GLM was removed from
  // that path), so a short debounce is enough to avoid firing a
  // request on every keystroke while still feeling live.
  minLength: 2,
  debounce: 200,
  // The AI request waits for a slightly longer typing pause than
  // the instant (JEV) one, so half-typed words don't each start
  // an AI call. 300ms (was 400ms): the AI answer starts 0.1s sooner.
  aiPause: 300,
  maxResults: 6,
  // Instant local results: the in-stock product list is kept in the
  // browser this long before it's fetched again.
  localCatalogTtl: 5 * 60 * 1000,
  cacheTtl: 60000,
  cacheSize: 30,
  pendingSearchKey:
    "ai-product-search-pending"
};

  /*
   * Customers get the AI model's results; the backend falls back
   * to JEV only when the AI fails.
   *
   * While the AI works (seconds), the instant JEV results
   * ("preview") are shown first and then replaced by the AI's
   * results when they arrive. If the AI fails, the JEV results
   * simply stay.
   */
  const SEARCH_MODE = "final";
  const INSTANT_MODE = "preview";

  // Marks a render of instant local results (see LOCAL CATALOG).
  const LOCAL_REQUEST = "local";

  // Storefront path of this app's app proxy ([app_proxy] prefix +
  // subpath in shopify.app.askmerce.toml): /apps/askmerce/*.
  const APP_PROXY_PATH = "apps/askmerce";

  const states = new WeakMap();
  // Shared across the whole storefront runtime. This is important because
  // the same query may be triggered by more than one search input.
  const cache = runtime.cache;
  const inFlight = runtime.inFlight;
  const patchedHosts = new WeakSet();
  const attachedInputs = new WeakSet();
  const trackedInputs = new Set();

  let fetchPatched = false;

  function nextSequence() {
    runtime.sequence += 1;
    return runtime.sequence;
  }


  // =========================================================
  // STATE
  // =========================================================

  function getState(input) {
    let state = states.get(input);

    if (!state) {
      state = {
        timer: null,
        controller: null,
        request: 0,

        query: "",
        aiQuery: "",
        lastStartedQuery: "",
        markup: "",

        host: null,
        container: null,

        observer: null,

        mode: "idle",
        // idle | loading | results | no-results

        internalMutation: false,
        renderingAI: false,

        searchingQuery: "",

        // Last successful native markup. It is reused if the theme
        // re-renders its predictive-search UI while the tab is restored.
        lastRenderedQuery: "",
        resultType: "direct",
        resultMessage: "",
        statusText: ""
      };

      states.set(input, state);
    }

    return state;
  }


  function cancelState(state) {
    if (!state) {
      return;
    }

    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    if (state.controller) {
      state.controller.abort();
      state.controller = null;
    }

    if (state.instantLane?.controller) {
      state.instantLane.controller.abort();
    }

    state.instantLane = null;

    state.request =
      nextSequence();
  }


  // =========================================================
  // SEARCH INPUT DETECTION
  // =========================================================

  function isSearchInput(element) {
    if (
      !element ||
      element.tagName !== "INPUT"
    ) {
      return false;
    }

    const type =
      String(
        element.getAttribute("type") || ""
      ).toLowerCase();

    const name =
      String(
        element.getAttribute("name") || ""
      ).toLowerCase();

    const placeholder =
      String(
        element.getAttribute("placeholder") || ""
      ).toLowerCase();

    const ariaLabel =
      String(
        element.getAttribute("aria-label") || ""
      ).toLowerCase();

    const formAction = String(
      element.form?.getAttribute("action") || ""
    ).toLowerCase();

    const role = String(
      element.getAttribute("role") || ""
    ).toLowerCase();

    return (
      type === "search" ||
      name === "q" ||
      name === "query" ||
      name === "search" ||
      role === "searchbox" ||
      placeholder.includes("search") ||
      ariaLabel.includes("search") ||
      formAction.includes("/search")
    );
  }


  function findSearchInputs() {
    return Array.from(
      document.querySelectorAll(
        [
          'input[type="search"]',
          'input[name="q"]',
          'input[name="query"]',
          'input[placeholder*="search" i]',
          'input[aria-label*="search" i]'
        ].join(",")
      )
    );
  }


  // =========================================================
  // NATIVE PREDICTIVE SEARCH HOST / CONTAINER
  // =========================================================

  function getPredictiveHost(input) {
    if (!input) {
      return null;
    }

    return (
      input.closest(
        [
          "predictive-search",
          "search-modal",
          "search-drawer",
          "[data-predictive-search]",
          "[data-search]",
          "[data-search-component]"
        ].join(",")
      ) || input.form || null
    );
  }


  function getResultContainer(input) {
    if (!input) {
      return null;
    }

    const host = getPredictiveHost(input);

    if (!host) {
      return null;
    }

    return (
      host.querySelector(
        [
          "#predictive-search-results",
          "[data-predictive-search-results]",
          "[role='listbox']",
          "[data-predictive-search]",
          "#predictive-search"
        ].join(",")
      ) || null
    );
  }


  function openNativeShell(input) {
    const host =
      getPredictiveHost(input);

    if (!host) {
      return null;
    }

    const state =
      getState(input);

    state.host =
      host;


    if (
      typeof host.open ===
      "function"
    ) {

      try {
        host.open();
      } catch (_) {}

    } else {

      host.setAttribute(
        "open",
        "true"
      );
    }


    input.setAttribute(
      "aria-expanded",
      "true"
    );


    return getResultContainer(
      input
    );
  }


  function closeNativeShell(input) {
    const host =
      getPredictiveHost(input);


    if (
      host &&
      typeof host.close ===
      "function"
    ) {

      try {
        host.close();
      } catch (_) {}
    }


    input.setAttribute(
      "aria-expanded",
      "false"
    );
  }


  // =========================================================
  // PATCH SHOPIFY PREDICTIVE SEARCH
  // =========================================================

  function patchPredictiveHost(input) {
    const host = getPredictiveHost(input);
    const state = getState(input);

    state.host = host;

    if (!host || host === input.form) {
      return;
    }

    /*
     * The theme still owns the entire UI. We only stop its automatic
     * predictive-search fetch because AI is supplying the predictive
     * results for this input. Without this guard, some themes schedule
     * their own search a few hundred milliseconds later and overwrite
     * the AI results with the normal "Search for ..." row.
     *
     * We intentionally patch only the known predictive-search controller
     * methods when they exist. Keyboard, focus, Escape, arrows, mobile
     * behavior and rendering remain native.
     */
    if (!state.nativeMethodsPatched) {
      // The theme's predictive-search custom element may not be
      // defined yet (its script can load after this one, e.g. on
      // heavier pages like /search). Its methods don't exist
      // until then, so patch once it is defined instead of
      // marking it patched now and leaving native search active.
      const tagName = host.tagName.toLowerCase();

      if (
        tagName.includes("-") &&
        window.customElements &&
        !window.customElements.get(tagName)
      ) {
        if (!state.nativePatchPending) {
          state.nativePatchPending = true;

          window.customElements.whenDefined(tagName).then(() => {
            state.nativePatchPending = false;
            patchPredictiveHost(input);
          });
        }

        return;
      }

      state.nativeMethodsPatched = true;
      state.originalOnChange =
        typeof host.onChange === "function"
          ? host.onChange
          : null;
      state.originalGetSearchResults =
        typeof host.getSearchResults === "function"
          ? host.getSearchResults
          : null;

      if (state.originalOnChange) {
        host.onChange = function () {};
      }

      if (state.originalGetSearchResults) {
        host.getSearchResults = function () {};
      }
    }
  }


  // =========================================================
  // STOP NATIVE SEARCH NETWORK CALLS
  // =========================================================

  function patchFetch() {
    // Native Shopify predictive-search requests must remain enabled.
    // The theme owns rendering, accessibility, keyboard behavior and
    // responsive UI. We only provide the AI-selected query when needed.
    fetchPatched = true;
  }


  // =========================================================
  // CACHE
  // =========================================================

  function getCached(key) {
    const item =
      cache.get(key);


    if (!item) {
      return null;
    }


    if (
      Date.now() -
      item.time >
      CFG.cacheTtl
    ) {

      cache.delete(
        key
      );

      return null;
    }


    return item.value;
  }


  function setCached(
    key,
    value
  ) {

    cache.delete(
      key
    );


    cache.set(
      key,
      {
        time:
          Date.now(),

        value
      }
    );


    while (
      cache.size >
      CFG.cacheSize
    ) {

      const firstKey =
        cache.keys()
          .next()
          .value;


      cache.delete(
        firstKey
      );
    }
  }


  // =========================================================
  // AI REQUEST
  // =========================================================

  async function requestAI(
    query,
    state,
    mode = "preview"
  ) {
    const normalizedQuery =
      String(
        query || ""
      )
        .trim()
        .toLowerCase();

    // Preview and final searches must never share cache/in-flight results.
    const cacheKey =
      `${mode}:${normalizedQuery}`;


    /*
     * -------------------------------------------------------
     * COMPLETED CACHE
     * -------------------------------------------------------
     */

    const cached =
      getCached(
        cacheKey
      );


    if (cached) {

      const id =
        nextSequence();


      state.request =
        id;




      return {
        result:
          cached,

        id
      };
    }


    /*
     * -------------------------------------------------------
     * IN-FLIGHT REQUEST
     * -------------------------------------------------------
     */

    const existing =
      inFlight.get(
        cacheKey
      );


    if (existing) {

      const id =
        nextSequence();


      state.request =
        id;


      const result =
        await existing.promise;


      if (
        id !==
        state.request
      ) {

        return {
          result:
            null,

          id
        };
      }




      return {
        result,

        id
      };
    }


    /*
     * -------------------------------------------------------
     * NEW REQUEST
     * -------------------------------------------------------
     */

    const id =
      nextSequence();


    state.request =
      id;


    const controller =
      new AbortController();


    state.controller =
      controller;


    const url =
      `/${APP_PROXY_PATH}/search?q=` +
      encodeURIComponent(query) +
      "&mode=" +
      encodeURIComponent(mode);


    const promise =
      (async () => {





        const response =
          await fetch(
            url,
            {
              method:
                "GET",

              headers: {
                Accept:
                  "application/json"
              },

              credentials:
                "same-origin",

              signal:
                controller.signal
            }
          );


        if (
          !response.ok
        ) {

          throw new Error(
            `AI search failed: ${response.status}`
          );
        }


        const result =
          await response.json();




        setCached(
          cacheKey,
          result
        );


        return result;

      })();


    inFlight.set(
      cacheKey,
      {
        promise,
        controller
      }
    );


    try {

      const result =
        await promise;


      if (
        id !==
          state.request ||
        query !==
          String(
            state.query || ""
          ).trim()
      ) {

        return {
          result:
            null,

          id
        };
      }


      return {
        result,

        id
      };

    } finally {

      const current =
        inFlight.get(
          cacheKey
        );


      if (
        current?.promise ===
        promise
      ) {

        inFlight.delete(
          cacheKey
        );
      }


      if (
        state.controller ===
        controller
      ) {

        state.controller =
          null;
      }
    }
  }


  // =========================================================
  // INTERNAL SHOPIFY QUERY
  // =========================================================

  function escapeShopifyPhrase(
    value
  ) {

    return String(
      value || ""
    )
      .replace(
        /\\/g,
        "\\\\"
      )
      .replace(
        /"/g,
        '\\"'
      );
  }


  function buildAIQuery(
    products,
    fallbackQuery
  ) {

    if (
      !Array.isArray(
        products
      ) ||
      !products.length
    ) {

      return String(
        fallbackQuery || ""
      ).trim();
    }


    const clauses =
      products
        .slice(
          0,
          CFG.maxResults
        )
        .map(
          product => {

            const title =
              String(
                product?.title ||
                ""
              ).trim();


            return title
              ? `title:"${escapeShopifyPhrase(
                  title
                )}"`
              : "";
          }
        )
        .filter(
          Boolean
        );


    return clauses.length
      ? clauses.join(
          " OR "
        )
      : String(
          fallbackQuery || ""
        ).trim();
  }


  // =========================================================
  // FETCH NATIVE SHOPIFY MARKUP
  // =========================================================

  // ---------------------------------------------------------
  // Which section renders the theme's predictive search
  // ---------------------------------------------------------

  const PREDICTIVE_SECTION_DEFAULT = "predictive-search";
  const PREDICTIVE_SECTION_NONE = "__none__";

  function predictiveSectionKey() {
    return `ai-product-search:predictive-section:${window.Shopify?.theme?.id || ""}`;
  }

  function rememberPredictiveSection(sectionId) {
    try {
      window.sessionStorage.setItem(predictiveSectionKey(), sectionId);
    } catch (error) {
      // Storage unavailable: it is simply worked out again.
    }
  }

  function predictiveSectionCandidates(input) {
    let remembered = "";

    try {
      remembered = window.sessionStorage.getItem(predictiveSectionKey()) || "";
    } catch (error) {
      // ignore
    }

    if (remembered === PREDICTIVE_SECTION_NONE) {
      return [];
    }

    const candidates = [];
    const add = value => {
      const id = String(value || "").trim();

      if (/^[\w-]{1,80}$/.test(id) && !candidates.includes(id)) {
        candidates.push(id);
      }
    };

    add(remembered);

    // Section names the theme puts on its search component.
    try {
      const host = getPredictiveHost(input);
      const nearby = [];

      for (let element = input; element && element !== document.body; element = element.parentElement) {
        nearby.push(element);
      }

      if (host) {
        nearby.push(...host.querySelectorAll("[data-section-id], [data-section], [section-id]"));
      }

      nearby.forEach(element => {
        ["data-section-id", "data-section", "section-id"].forEach(name => {
          const value = element.getAttribute && element.getAttribute(name);

          if (value && /search|predictive/i.test(value) && candidates.length < 3) {
            add(value);
          }
        });
      });
    } catch (error) {
      // ignore
    }

    add(PREDICTIVE_SECTION_DEFAULT);
    return candidates;
  }

  function escapeHtmlText(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatSuggestionPrice(price) {
    const amount = Number(price);

    if (!price || Number.isNaN(amount)) {
      return "";
    }

    try {
      const currency = window.Shopify?.currency?.active;

      if (currency) {
        return new Intl.NumberFormat(document.documentElement.lang || undefined, {
          style: "currency",
          currency
        }).format(amount);
      }
    } catch (error) {
      // fall through
    }

    return amount.toFixed(2);
  }

  function safeUrl(value) {
    const url = String(value || "").trim();

    return /^(https?:)?\/\//i.test(url) || url.startsWith("/") ? url : "";
  }

  /*
   * For themes without a predictive-search section: the same
   * AI-selected products from Shopify's standard suggestion
   * data, as simple rows (image, title, price) that take the
   * theme's font and colours. Only used when the theme has no
   * section to render them itself.
   */
  async function fetchSuggestionRows(root, params, signal, aiProducts) {
    const response = await fetch(
      `${root}search/suggest.json?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-AI-Search-Internal": "1"
        },
        credentials: "same-origin",
        signal
      }
    );

    if (!response.ok) {
      throw new Error(`Native Shopify search failed: ${response.status}`);
    }

    const data = await response.json();
    const products = data?.resources?.results?.products;

    if (!Array.isArray(products) || !products.length) {
      return "";
    }

    // Same order as the AI ranked them.
    const order = (Array.isArray(aiProducts) ? aiProducts : [])
      .map(product => String(product?.handle || "").trim())
      .filter(Boolean);
    const rank = product => {
      const index = order.indexOf(String(product?.handle || ""));
      return index === -1 ? order.length : index;
    };

    products.sort((a, b) => rank(a) - rank(b));

    const rows = products.map(product => {
      const href = safeUrl(product.url) || (product.handle ? `/products/${encodeURIComponent(product.handle)}` : "");

      if (!href) {
        return "";
      }

      let image = safeUrl(product.featured_image?.url || product.image);

      if (image) {
        image += `${image.includes("?") ? "&" : "?"}width=120`;
      }

      const price = formatSuggestionPrice(product.price);

      return `<li role="option" aria-selected="false" style="list-style:none;margin:0;">` +
        `<a href="${escapeHtmlText(href)}" style="display:flex;align-items:center;gap:12px;padding:8px 16px;color:inherit;text-decoration:none;">` +
        (image
          ? `<img src="${escapeHtmlText(image)}" alt="" width="48" height="48" loading="lazy" style="width:48px;height:48px;object-fit:cover;border-radius:4px;flex:none;">`
          : "") +
        `<span style="display:flex;flex-direction:column;min-width:0;">` +
        `<span>${escapeHtmlText(product.title)}</span>` +
        (price ? `<span style="opacity:0.75;font-size:0.9em;">${escapeHtmlText(price)}</span>` : "") +
        `</span></a></li>`;
    }).join("");

    return rows
      ? `<ul role="listbox" data-ai-search-rows style="list-style:none;margin:0;padding:6px 0;">${rows}</ul>`
      : "";
  }

  async function fetchNativeMarkup(
    query,
    input,
    signal,
    aiProducts
  ) {



    const container =
      getResultContainer(
        input
      );


    const root =
      (
        window.Shopify
          ?.routes
          ?.root ||
        "/"
      ).replace(
        /\/?$/,
        "/"
      );


    const params =
      new URLSearchParams();


    params.set(
      "q",
      query
    );


    params.set(
      "resources[type]",
      "product"
    );


    params.set(
      "resources[limit]",
      String(
        CFG.maxResults
      )
    );


    params.set(
      "resources[options][unavailable_products]",
      "last"
    );


    params.set(
      "resources[options][fields]",
      "variants.sku,title,product_type,variants.title,vendor"
    );


    /*
     * The theme's predictive-search section is "predictive-search"
     * in Dawn-family themes, but other themes name it differently
     * and Shopify answers 404 for a section the theme doesn't
     * have. Try the name that worked before on this store, names
     * the theme exposes near its search box, then the standard
     * one. If none exists, build simple rows from Shopify's
     * standard suggestion data (works on every store).
     */
    let sectionId = "";
    let html = "";

    for (const candidate of predictiveSectionCandidates(input)) {
      // Same parameter order as before (q, section_id, ...).
      const sectionParams = new URLSearchParams();
      sectionParams.set("q", query);
      sectionParams.set("section_id", candidate);

      params.forEach((value, key) => {
        if (key !== "q") {
          sectionParams.append(key, value);
        }
      });

      const response =
        await fetch(
          `${root}search/suggest?${sectionParams.toString()}`,
          {
            method:
              "GET",

            headers: {
              Accept:
                "text/html",

              /*
               * Allow our patched fetch wrapper
               * to pass this request through.
               */
              "X-AI-Search-Internal":
                "1"
            },

            credentials:
              "same-origin",

            signal
          }
        );

      if (response.ok) {
        sectionId = candidate;
        html = await response.text();
        rememberPredictiveSection(candidate);
        break;
      }

      if (response.status !== 404) {
        throw new Error(
          `Native Shopify search failed: ${response.status}`
        );
      }
    }

    if (!sectionId) {
      rememberPredictiveSection(PREDICTIVE_SECTION_NONE);
      return fetchSuggestionRows(root, params, signal, aiProducts);
    }



    const doc =
      new DOMParser()
        .parseFromString(
          html,
          "text/html"
        );


    const wrapper =
      doc.getElementById(
        `shopify-section-${sectionId}`
      );


    if (wrapper) {
      return wrapper.innerHTML;
    }


    const fallback =
      doc.querySelector(
        [
          "#predictive-search",
          "#predictive-search-results",
          "[data-predictive-search]",
          "[role='listbox']"
        ].join(",")
      );


    if (fallback) {
      return fallback.innerHTML;
    }


    if (container) {
      return (
        container.innerHTML ||
        ""
      );
    }


    return "";
  }


  // =========================================================
  // REMOVE NATIVE "SEARCH FOR..." ACTION
  // =========================================================

  function removeNativeSearchForAction(
    markup
  ) {

    if (!markup) {
      return "";
    }


    try {

      const doc =
        new DOMParser()
          .parseFromString(
            markup,
            "text/html"
          );


      const selectors = [
        "#predictive-search-option-search-keywords",

        "[data-predictive-search-search-for-text]",

        ".predictive-search__search-for-button",

        ".predictive-search__search-for",

        ".predictive-search__search-for-text"
      ];


      selectors.forEach(
        selector => {

          doc
            .querySelectorAll(
              selector
            )
            .forEach(
              element => {

                const row =
                  element.closest(
                    "li, a, button"
                  ) ||
                  element;


                row.remove();
              }
            );
        }
      );


      /*
       * Generic fallback.
       */
      Array.from(
        doc.body.querySelectorAll(
          "*"
        )
      )
        .filter(
          element =>
            element.children.length ===
            0
        )
        .forEach(
          element => {

            const text =
              String(
                element.textContent ||
                ""
              ).trim();


            if (
              /^Search for\s+/i.test(
                text
              )
            ) {

              const row =
                element.closest(
                  "li, a, button, div"
                ) ||
                element;


              row.remove();
            }
          }
        );


      return doc.body.innerHTML;

    } catch (
      error
    ) {

      console.warn(
        "[Askmerce] Could not remove native search action",
        error
      );


      return markup;
    }
  }


  // =========================================================
  // CLEAR RESULT AREA
  // =========================================================

  function clearResultArea(
    input
  ) {

    const container =
      getResultContainer(
        input
      );


    if (!container) {
      return;
    }


    const state =
      getState(input);


    state.internalMutation =
      true;


    container.replaceChildren();


    queueMicrotask(
      () => {

        state.internalMutation =
          false;
      }
    );
  }


  // =========================================================
  // STATUS UI
  // =========================================================
  //
  // No custom CSS is injected.
  // Theme-native classes are used.
  //
  // =========================================================

  /*
   * How this theme renders a predictive-search product row,
   * learned from the theme's own markup the first time results
   * are shown (see learnThemeStatusStyle). Status messages copy
   * it so they look native in any theme, not just Dawn. Kept in
   * sessionStorage so messages shown before the first result on
   * a later page (e.g. "Looking for best result...") match too.
   */
  const THEME_STYLE_KEY = "ai-product-search:status-style";
  let themeStatusStyle = null;

  try {
    themeStatusStyle = JSON.parse(
      window.sessionStorage.getItem(THEME_STYLE_KEY) || "null"
    );
  } catch (error) {
    themeStatusStyle = null;
  }

  /*
   * Reads the first product row of native markup: the classes
   * on the element holding the product title (typography) and
   * where the row's content starts (spacing). Only reads the
   * DOM; never changes the theme's markup.
   */
  function learnThemeStatusStyle(container) {
    try {
      const link = container.querySelector("a[href*='/products/']");

      if (!link) {
        return;
      }

      // Deepest element in the row that holds visible text: the
      // product title in every theme's predictive markup.
      const titleElement = Array.from(link.querySelectorAll("*"))
        .filter(element =>
          element.children.length === 0 &&
          String(element.textContent || "").trim()
        )[0];

      const containerRect = container.getBoundingClientRect();
      const linkRect = link.getBoundingClientRect();
      const linkStyle = window.getComputedStyle(link);

      if (!linkRect.width || !containerRect.width) {
        return;
      }

      themeStatusStyle = {
        textTag: titleElement ? titleElement.tagName.toLowerCase() : "span",
        textClass: titleElement ? titleElement.className : "",
        paddingTop: linkStyle.paddingTop,
        paddingBottom: linkStyle.paddingBottom,
        paddingLeft:
          Math.max(0, Math.round(linkRect.left - containerRect.left + parseFloat(linkStyle.paddingLeft || "0"))) + "px",
        paddingRight:
          Math.max(0, Math.round(containerRect.right - linkRect.right + parseFloat(linkStyle.paddingRight || "0"))) + "px"
      };

      try {
        window.sessionStorage.setItem(THEME_STYLE_KEY, JSON.stringify(themeStatusStyle));
      } catch (error) {
        // Storage unavailable (private mode): this page still uses it.
      }
    } catch (error) {
      // Styling is best-effort; never break search over it.
    }
  }

  /*
   * A status line (loading / alternative / no results) styled
   * like the theme's own product rows. Marked with
   * data-ai-search-status so the persistence observer can tell
   * when a theme re-render dropped it.
   */
  function createStatusElement(
    input,
    text
  ) {

    const container =
      getResultContainer(
        input
      );


    if (!container) {
      return null;
    }


    const status =
      document.createElement(
        container.matches("ul, ol") ? "li" : "div"
      );

    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.setAttribute("data-ai-search-status", "true");
    status.style.listStyle = "none";


    const learned = themeStatusStyle;

    const textElement =
      document.createElement(
        learned && /^(p|span|div|h[1-6])$/.test(learned.textTag)
          ? learned.textTag
          : "span"
      );

    if (learned) {
      textElement.className = learned.textClass || "";
      status.style.paddingTop = learned.paddingTop;
      status.style.paddingBottom = learned.paddingBottom;
      status.style.paddingLeft = learned.paddingLeft;
      status.style.paddingRight = learned.paddingRight;
    } else {
      // Nothing learned yet on this store: Dawn-family classes
      // (most Shopify themes derive from Dawn), plus padding only
      // if the theme gives this element none.
      status.className =
        "predictive-search__list-item predictive-search__item";
      textElement.className =
        "predictive-search__item-heading h5";
    }

    textElement.style.margin = "0";
    textElement.textContent = text;
    status.appendChild(textElement);

    if (!learned) {
      queueMicrotask(() => {
        try {
          if (
            status.isConnected &&
            parseFloat(window.getComputedStyle(status).paddingLeft || "0") === 0
          ) {
            status.style.padding = "1rem 2rem";
          }
        } catch (error) {
          // best-effort only
        }
      });
    }


    return status;
  }

  /*
   * Text for a search with nothing to show (rare: the backend
   * returns similar in-stock products whenever it has any).
   * Same message as alternative results; the native
   * "No results found" wording is never shown.
   */
  const ALTERNATIVE_MESSAGE =
    "We didn't find exactly that, but you might like these";

  function noResultsText() {
    return ALTERNATIVE_MESSAGE;
  }

  const LOADING_TEXT = "Looking for best result...";

  function renderStatus(input, state, text) {
    const container = getResultContainer(input);

    if (!container) {
      return;
    }

    state.internalMutation = true;

    try {
      const statusElement = createStatusElement(input, text);
      container.replaceChildren(statusElement || document.createTextNode(text));
    } finally {
      queueMicrotask(() => { state.internalMutation = false; });
    }
  }

function showStatus(
    input,
    text,
    mode
  ) {
    const state = getState(input);
    state.mode = mode;
    state.searchingQuery = String(input?.value || "").trim();

    // Remembered so the persistence observer can put the same
    // message back if the theme re-renders the dropdown.
    state.statusText = text;

    if (mode === "loading") {
      input?.setAttribute("aria-busy", "true");
      openNativeShell(input);
      renderStatus(input, state, text);
      return;
    }

    input?.removeAttribute("aria-busy");

    if (mode === "no-results") {
      renderStatus(input, state, text);
    }
  }

  // =========================================================
  // OBSERVER
  // =========================================================

  function stripSearchForRowsFromLiveContainer(
    container
  ) {

    const selectors = [

      "#predictive-search-option-search-keywords",

      "[data-predictive-search-search-for-text]",

      ".predictive-search__search-for-button",

      ".predictive-search__search-for",

      ".predictive-search__search-for-text"

    ];


    selectors.forEach(
      selector => {

        container
          .querySelectorAll(
            selector
          )
          .forEach(
            element => {

              const row =
                element.closest(
                  "li, a, button"
                ) ||
                element;


              row.remove();
            }
          );
      }
    );


    /*
     * Generic fallback.
     */
    Array.from(
      container.querySelectorAll(
        "*"
      )
    )
      .filter(
        element =>
          element.children.length ===
          0
      )
      .forEach(
        element => {

          const text =
            String(
              element.textContent ||
              ""
            ).trim();


          if (
            /^Search for\s+/i.test(
              text
            )
          ) {

            const row =
              element.closest(
                "li, a, button, div"
              ) ||
              element;


            row.remove();
          }
        }
      );
  }


  // =========================================================
  // KEEP AI RESULTS ALIVE THROUGH THEME RE-RENDERS
  // =========================================================

  function hasSearchForRow(container) {
    if (!container) {
      return false;
    }

    const text = String(container.textContent || "").trim();
    return /^Search for\s+/i.test(text) ||
      !!container.querySelector(
        [
          "#predictive-search-option-search-keywords",
          "[data-predictive-search-search-for-text]",
          ".predictive-search__search-for",
          ".predictive-search__search-for-button"
        ].join(",")
      );
  }


  function restoreLastAIResults(input, options) {
    const force = Boolean(options && options.force);

    if (!input || !document.documentElement.contains(input)) {
      return false;
    }

    const state = getState(input);
    const query = String(input.value || "").trim();

    if (
      state.mode !== "results" ||
      !state.markup ||
      !state.lastRenderedQuery ||
      query !== state.lastRenderedQuery
    ) {
      return false;
    }

    const container = getResultContainer(input);

    if (!container) {
      return false;
    }

    // Only restore when the theme has actually replaced our AI
    // results. This avoids fighting normal native theme DOM
    // updates (e.g. keyboard-navigation highlighting). `force`
    // bypasses this heuristic when the caller already confirmed,
    // via a more precise signal than textual "Search for..."
    // detection (the current product handle order no longer
    // matching what was rendered), that a foreign replacement
    // occurred.
    if (!force && !hasSearchForRow(container) && container.innerHTML.trim()) {
      return false;
    }

    state.internalMutation = true;
    try {
      container.innerHTML = state.markup;
      input.setAttribute("aria-expanded", "true");
      input.removeAttribute("aria-busy");
      return true;
    } finally {
      queueMicrotask(() => {
        state.internalMutation = false;
      });
    }
  }


  function scheduleAIResultRestore(input) {
    // Theme/browser restoration can happen asynchronously, so check a few
    // times without making another AI request.
    [0, 50, 150, 400, 800].forEach(delay => {
      window.setTimeout(() => {
        restoreLastAIResults(input);
      }, delay);
    });
  }


  function restoreAllAIResults() {
    trackedInputs.forEach(input => {
      scheduleAIResultRestore(input);
    });
  }


  function installResultPersistenceObserver() {
    const observer = new MutationObserver(mutations => {
      if (!mutations.length) {
        return;
      }

      trackedInputs.forEach(input => {
        const state = states.get(input);

        if (
          !state ||
          state.internalMutation
        ) {
          return;
        }

        // Questions in the theme's area or the panel: put them
        // back if the theme re-rendered and dropped them.
        if (
          state.mode === "questions" &&
          state.questionKind &&
          state.questionKind !== "native"
        ) {
          if (
            !getQuestionGroup(state.questionContainer) &&
            document.activeElement === input &&
            questionsAllowedFor(input)
          ) {
            showQuestionSuggestions(input, { restore: true });
          }
          return;
        }

        const container = getResultContainer(input);

        if (!container) {
          return;
        }

        // Merchant questions open for an empty, focused input: put
        // them back if the theme re-rendered its dropdown.
        if (state.mode === "questions") {
          if (
            !getQuestionGroup(container) &&
            document.activeElement === input &&
            questionsAllowedFor(input)
          ) {
            showQuestionSuggestions(input, { restore: true });
          }
          return;
        }

        if (state.mode === "loading" || state.mode === "no-results") {
          const statusText =
            state.statusText ||
            (state.mode === "loading" ? LOADING_TEXT : noResultsText(state.searchingQuery));

          if (
            String(container.textContent || "").trim() !== statusText ||
            !container.querySelector("[data-ai-search-status]")
          ) {
            renderStatus(input, state, statusText);
          }
          return;
        }

        if (state.mode === "results") {
          const searchForRowPresent = hasSearchForRow(container);

          // Broader signal than the "Search for..." text check
          // alone: the theme's own predictive-search controller
          // can independently re-fetch and replace the entire
          // container with its own, differently-ordered (and
          // rule-unaware) native result list, without ever
          // introducing a "Search for..." row at all. Comparing
          // the current product handle order against what we
          // actually rendered catches that case too.
          //
          // Only compared when we have a non-empty expected order
          // to compare against — on a theme where handle-matching
          // never found anything to begin with, there is nothing
          // reliable to detect drift against, so this simply does
          // not trigger, exactly like before.
          const expectedHandles =
            Array.isArray(state.expectedHandles) ? state.expectedHandles : [];

          let handlesDiverged = false;

          if (expectedHandles.length) {
            const currentHandles = getContainerHandleOrder(container);

            handlesDiverged =
              currentHandles.length !== expectedHandles.length ||
              currentHandles.some(
                (handle, index) => handle !== expectedHandles[index]
              );
          }

          // The theme re-rendered the same products but dropped
          // our "We didn't find exactly that..." message.
          const messageMissing =
            Boolean(state.resultMessage) &&
            !container.querySelector("[data-ai-search-status]");

          if (searchForRowPresent || handlesDiverged || messageMissing) {
            restoreLastAIResults(input, { force: true });
          }
        }
      });
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    return observer;
  }


  // =========================================================
  // REORDER NATIVE RESULTS TO MATCH BACKEND products[] ORDER
  // =========================================================
  //
  // Shopify's native predictive search re-ranks by its own
  // relevance algorithm, so the DOM order it returns is not
  // guaranteed to match the backend's GLM/rule-ranked
  // products[] order. This function only REORDERS elements
  // that already exist in the native markup — it never adds,
  // removes, or rewrites markup, and never invents a product
  // that Shopify didn't already render.
  //
  // Products are matched by handle, extracted from each
  // result's own "/products/{handle}" link. This is a Shopify
  // platform convention followed by effectively every theme's
  // predictive-search snippet, unlike SKU, which most themes
  // never expose in the rendered markup at all.
  //
  // Called from inside the same state.internalMutation = true
  // window as `container.innerHTML = markup`, so the mutation
  // observer that watches for the theme re-rendering results
  // ignores this too — no new infinite-loop risk.
  // =========================================================

  function extractProductHandle(href) {
    if (!href) {
      return "";
    }

    const match =
      String(href).match(
        /\/products\/([^/?#]+)/
      );

    return match ? match[1] : "";
  }


  // =========================================================
  // CURRENT PRODUCT ORDER, READ-ONLY
  // =========================================================
  //
  // Reads the product handles currently present in `container`,
  // in DOM order, deduplicated by first occurrence per row. This
  // never modifies the DOM. Used both to compute what
  // reorderNativeResults() actually achieved, and later, by the
  // persistence observer, to detect whether something else (the
  // theme's own predictive-search controller) has since replaced
  // the container's contents wholesale.
  // =========================================================

  function getContainerHandleOrder(container) {
    if (!container) {
      return [];
    }

    const seen = new Set();
    const handles = [];

    container
      .querySelectorAll('a[href*="/products/"]')
      .forEach(link => {

        const handle =
          extractProductHandle(
            link.getAttribute("href")
          );

        if (!handle || seen.has(handle)) {
          return;
        }

        seen.add(handle);
        handles.push(handle);

      });

    return handles;
  }


  function reorderNativeResults(
    container,
    products
  ) {

    if (
      !container ||
      !Array.isArray(products) ||
      products.length < 2
    ) {
      // Nothing meaningful to reorder with 0 or 1 products.
      // Still report the container's actual current order so the
      // caller has an accurate baseline to detect later changes
      // against, even when no reordering was attempted.
      return getContainerHandleOrder(container);
    }

    const orderedHandles =
      products
        .map(product => String(product?.handle || "").trim())
        .filter(Boolean);

    if (!orderedHandles.length) {
      // Backend response has no handles to match against
      // (should not normally happen); leave native order as-is
      // rather than guess.
      return getContainerHandleOrder(container);
    }

    const rowByHandle = new Map();

    const productLinks =
      container.querySelectorAll(
        'a[href*="/products/"]'
      );

    productLinks.forEach(link => {

      const handle =
        extractProductHandle(
          link.getAttribute("href")
        );

      if (!handle || rowByHandle.has(handle)) {
        // No handle found, or this handle's row was already
        // claimed by an earlier link (e.g. an image link and a
        // title link both pointing at the same product) —
        // skip, so the same row is never queued to move twice.
        return;
      }

      // The reorderable unit is the nearest ancestor that is a
      // direct child of the results container — theme-agnostic,
      // does not assume any particular tag or class name, and
      // mirrors the element.closest("li, a, button") technique
      // already used elsewhere in this file for row-level
      // operations.
      let row = link;

      while (
        row.parentElement &&
        row.parentElement !== container
      ) {
        row = row.parentElement;
      }

      if (row.parentElement === container) {
        rowByHandle.set(handle, row);
      }

    });

    if (!rowByHandle.size) {
      // This theme's markup did not expose any recognizable
      // product-page links inside the results container.
      // Leave native order untouched rather than guess.
      return getContainerHandleOrder(container);
    }

    // Move only matched rows, in backend order. Unmatched rows
    // are never touched. appendChild on a node already in the
    // document MOVES it rather than cloning it, so this cannot
    // introduce a duplicate product, and it cannot introduce a
    // product that was not already part of the native markup —
    // an excluded product was never in `products[]` to begin
    // with, so it was never part of buildAIQuery()'s title
    // clauses, and this function has no path that could add a
    // row back in.
    orderedHandles.forEach(handle => {

      const row =
        rowByHandle.get(handle);

      if (row) {
        container.appendChild(row);
      }

    });

    // Report the container's actual resulting order (not just the
    // intended `orderedHandles`), since unmatched rows may still
    // occupy positions this function deliberately left untouched.
    // This is what the persistence observer later compares against
    // to detect a foreign replacement.
    return getContainerHandleOrder(container);
  }


  // =========================================================
  // RENDER AI RESULTS
  // =========================================================

  async function renderAIResults(
    input,
    query,
    products,
    state,
    requestId,
    resultType = "direct",
    resultMessage = "",
    shouldRender = null,
    // Instant local results pass their own signal (see LOCAL
    // CATALOG); everything else uses the input's request.
    signal = null
  ) {
    if (!Array.isArray(products) || !products.length) {
      input.removeAttribute("aria-busy");
      return false;
    }

    const currentQuery = String(input.value || "").trim();

    // Instant local results are not tied to a server request;
    // shouldRender decides whether they are still wanted.
    const isCurrentRequest = () =>
      requestId === LOCAL_REQUEST || requestId === state.request;

    if (
      !isCurrentRequest() ||
      currentQuery !== query
    ) {
      return;
    }

    const aiQuery = buildAIQuery(products, query);

    if (!aiQuery) {
      input.removeAttribute("aria-busy");
      return;
    }

    state.aiQuery = aiQuery;

    const nativeMarkup = await fetchNativeMarkup(
      aiQuery,
      input,
      signal || state.controller?.signal,
      products
    );

    if (
      !isCurrentRequest() ||
      String(input.value || "").trim() !== query ||
      (shouldRender && !shouldRender())
    ) {
      return false;
    }

    // Remove Shopify's "Search for ..." action because it exposes the
    // internal AI title query rather than the customer's original wording.
    const markup = removeNativeSearchForAction(nativeMarkup);

    if (!markup) {
      input.removeAttribute("aria-busy");
      return;
    }

    const container =
      getResultContainer(input) ||
      openNativeShell(input);

    if (!container) {
      input.removeAttribute("aria-busy");
      console.warn(
        "[Askmerce] Native predictive container unavailable"
      );
      return;
    }

    state.internalMutation = true;
    state.renderingAI = true;

    try {
      // Shopify generated this markup. No product-card markup or CSS is
      // created by the app.
      container.innerHTML = markup;

      learnThemeStatusStyle(container);

      // Native predictive search re-ranks by its own relevance,
      // not by GLM/rule ranking. Reorder the already-rendered
      // native rows to match the backend's products[] order —
      // this only moves existing elements, never adds/removes
      // any. Failure here must never prevent the (already
      // correct, already relevant) native markup from showing,
      // so it is isolated in its own try/catch.
      //
      // The returned handle order is the container's actual
      // resulting state (not just what we intended) — stored so
      // the persistence observer can later detect whether the
      // theme's own predictive-search controller has since
      // replaced these contents, and reassert this result.
      try {
        state.expectedHandles =
          reorderNativeResults(container, products) || [];
      } catch (reorderError) {
        state.expectedHandles = [];
        console.warn(
          "[Askmerce] Could not reorder native results; showing native order",
          reorderError
        );
      }

      // "recommended" means the backend found a genuinely relevant,
      // catalog-matched result for a need-based/natural-language
      // query (e.g. "suggest me good earrings") — it is a normal,
      // relevant result, not a fallback substitute. Only
      // "alternative" means the query itself wasn't well served by
      // the catalog and the backend is offering a related
      // substitute instead — that is the only case that should
      // ever show the "didn't find exactly that" banner.
      state.resultType =
        resultType === "alternative"
          ? "alternative"
          : resultType === "recommended"
            ? "recommended"
            : "direct";

      state.resultMessage =
        state.resultType === "alternative"
          ? (
              String(resultMessage || "").trim() ||
              "We didn't find exactly that, but you might like these"
            )
          : "";

      // Only a true "alternative" result gets the native
      // predictive-search status banner. Product cards remain
      // entirely Shopify/theme generated.
      if (
        state.resultType === "alternative" &&
        state.resultMessage
      ) {
        const status = createStatusElement(
          input,
          state.resultMessage
        );

        if (status) {
          container.insertBefore(
            status,
            container.firstChild
          );
        }
      }

      state.markup = container.innerHTML;
      state.lastRenderedQuery = query;

      // Search/AI results are on screen: a late instant local
      // render for this query must not replace them.
      if (requestId !== LOCAL_REQUEST) {
        state.serverRenderedQuery = query;
      }
      state.mode = "results";
      state.searchingQuery = query;
    } finally {
      queueMicrotask(() => {
        state.internalMutation = false;
        state.renderingAI = false;
      });
    }

    input.setAttribute("aria-expanded", "true");
    input.removeAttribute("aria-busy");


    return true;
  }


  // =========================================================
  // LOCAL CATALOG (instant results while typing)
  // =========================================================
  //
  // The shop's in-stock products (title, handle, type, vendor,
  // tags, SKUs) are loaded once when the search box is first
  // used and kept for CFG.localCatalogTtl. Each keystroke matches
  // the words against that list in the browser, so matching
  // products show at once, in the theme's own dropdown, instead of
  // after the typing pause and a server round trip.
  //
  // Only when every word matches (the last one may be half-typed);
  // otherwise — vague wording, typos, natural-language questions —
  // nothing changes: the normal instant + AI search handles it.
  // The AI's results still replace these as before. Products the
  // merchant's Exclude rule hides are never in the list; Boost /
  // Demote order matches the search.
  // =========================================================

  const LOCAL_STOP_WORDS = new Set([
    "a", "an", "the", "and", "or", "of", "for", "to", "in", "on", "with",
    "my", "me", "i", "im", "want", "need", "show", "find", "looking",
    "some", "something", "any", "please", "buy", "get", "give", "is",
    "are", "it", "that", "this", "which", "what", "who", "best", "good"
  ]);

  const localCatalog = runtime.localCatalog || {
    status: "idle", // idle | loading | ready | off
    items: [],
    promise: null
  };

  runtime.localCatalog = localCatalog;

  function localCatalogKey() {
    return `askmerce-catalog:${window.Shopify?.shop || window.location.hostname}`;
  }

  function normalizeWords(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
  }

  // "rings" -> "ring", "glasses" -> "glass", "dresses" -> "dress"
  function singularWord(word) {
    if (word.length > 4 && word.endsWith("es") && /(ss|x|ch|sh)es$/.test(word)) {
      return word.slice(0, -2);
    }

    if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) {
      return word.slice(0, -1);
    }

    return word;
  }

  function prepareLocalItem(item) {
    const fieldWords = value =>
      new Set(normalizeWords(value).flatMap(word => [word, singularWord(word)]));

    return {
      handle: String(item?.h || ""),
      title: String(item?.t || ""),
      rule: Number(item?.r) || 0,
      titleNorm: normalizeWords(item?.t).join(" "),
      titleWords: fieldWords(item?.t),
      typeWords: fieldWords(item?.y),
      otherWords: fieldWords([item?.v, ...(Array.isArray(item?.g) ? item.g : [])].join(" ")),
      skus: (Array.isArray(item?.k) ? item.k : []).map(sku => String(sku).toLowerCase())
    };
  }

  function useLocalCatalog(data) {
    if (data?.enabled === true && Array.isArray(data.products)) {
      localCatalog.items = data.products
        .map(prepareLocalItem)
        .filter(item => item.handle && item.title);
      localCatalog.status = "ready";
    } else {
      localCatalog.items = [];
      localCatalog.status = "off";
    }
  }

  function ensureLocalCatalog() {
    if (localCatalog.status === "ready" || localCatalog.status === "off") {
      return Promise.resolve();
    }

    if (localCatalog.promise) {
      return localCatalog.promise;
    }

    try {
      const saved = JSON.parse(window.sessionStorage.getItem(localCatalogKey()) || "null");

      if (saved && Date.now() - saved.time < CFG.localCatalogTtl) {
        useLocalCatalog(saved.data);
        return Promise.resolve();
      }
    } catch (error) {
      // No storage (private mode): just fetch it.
    }

    localCatalog.status = "loading";

    const root = (window.Shopify?.routes?.root || "/").replace(/\/?$/, "/");

    localCatalog.promise = fetch(`${root}${APP_PROXY_PATH}/catalog`, {
      headers: { Accept: "application/json" },
      credentials: "same-origin"
    })
      .then(response => (response.ok ? response.json() : { enabled: false }))
      .catch(() => ({ enabled: false }))
      .then(data => {
        useLocalCatalog(data);

        try {
          window.sessionStorage.setItem(
            localCatalogKey(),
            JSON.stringify({ time: Date.now(), data })
          );
        } catch (error) {
          // Storage full or unavailable: kept in memory only.
        }
      })
      .finally(() => {
        localCatalog.promise = null;
      });

    return localCatalog.promise;
  }

  /*
   * Products whose words match every word of the query (the last
   * word may be half-typed), best first. [] when anything doesn't
   * match, so the normal search decides instead.
   */
  function findLocalMatches(query) {
    if (localCatalog.status !== "ready" || !localCatalog.items.length) {
      return [];
    }

    const raw = String(query || "").trim().toLowerCase();
    const allWords = normalizeWords(raw);
    const lastTyping = !/\s$/.test(String(query || ""));
    const words = allWords.filter(
      (word, index) =>
        !LOCAL_STOP_WORDS.has(word) ||
        (lastTyping && index === allWords.length - 1 && allWords.length === 1)
    );

    if (!words.length) {
      return [];
    }

    const queryNorm = allWords.join(" ");

    const matchIn = (wordSet, word, isLast) => {
      const single = singularWord(word);

      if (wordSet.has(word) || wordSet.has(single)) {
        return true;
      }

      if (isLast && lastTyping && word.length >= 2) {
        for (const candidate of wordSet) {
          if (candidate.startsWith(word)) {
            return true;
          }
        }
      }

      return false;
    };

    const scored = [];

    for (const item of localCatalog.items) {
      // An exact SKU is the strongest possible match.
      if (item.skus.includes(raw)) {
        scored.push({ item, score: 1000 });
        continue;
      }

      let score = 0;
      let matchedAll = true;

      words.forEach((word, index) => {
        if (!matchedAll) {
          return;
        }

        const isLast = index === words.length - 1;

        if (matchIn(item.titleWords, word, isLast)) {
          score += 3;
        } else if (matchIn(item.typeWords, word, isLast)) {
          score += 2;
        } else if (matchIn(item.otherWords, word, isLast)) {
          score += 1;
        } else {
          matchedAll = false;
        }
      });

      if (!matchedAll) {
        continue;
      }

      if (item.titleNorm.startsWith(queryNorm)) {
        score += 3;
      } else if (item.titleNorm.includes(queryNorm)) {
        score += 2;
      }

      scored.push({ item, score });
    }

    // Boost first, Demote last (only among real matches, like search).
    scored.sort((a, b) =>
      (b.item.rule > 0) - (a.item.rule > 0) ||
      (a.item.rule < 0) - (b.item.rule < 0) ||
      b.score - a.score ||
      a.item.title.length - b.item.title.length ||
      a.item.title.localeCompare(b.item.title)
    );

    return scored
      .slice(0, CFG.maxResults)
      .map(({ item }) => ({ handle: item.handle, title: item.title }));
  }

  /*
   * Shows instant local matches for `query` in the theme's own
   * dropdown. Returns true when there were matches to show (the
   * caller then skips the loading message). Never blocks: drawing
   * happens in the background and is dropped if the shopper has
   * typed on, or the search/AI results arrived first.
   */
  function showLocalMatches(input, query) {
    const state = getState(input);
    const products = findLocalMatches(query);

    if (state.localLane?.controller) {
      state.localLane.controller.abort();
    }

    state.localLane = null;

    if (!products.length) {
      return false;
    }

    const lane = { query, controller: new AbortController() };
    state.localLane = lane;

    const stillWanted = () =>
      state.localLane === lane &&
      String(input.value || "").trim() === query &&
      state.serverRenderedQuery !== query;

    renderAIResults(
      input,
      query,
      products,
      state,
      LOCAL_REQUEST,
      "direct",
      "",
      stillWanted,
      lane.controller.signal
    )
      .then(rendered => {
        if (rendered && stillWanted()) {
          state.localShown = { query, products };

          // The AI is still working on this search.
          input.setAttribute("aria-busy", "true");
        }
      })
      .catch(() => {
        // Best effort: the normal search shows results anyway.
      });

    return true;
  }


  // =========================================================
  // PREDICTIVE AI SEARCH
  // =========================================================

  async function runPredictiveSearch(
    input,
    query
  ) {
    const cleanQuery = String(query || "").trim();
    const state = getState(input);

    if (!cleanQuery) {
      return;
    }

    // A new run owns the latest query. Older runs become stale immediately.
    cancelState(state);
    state.query = cleanQuery;

    // Do not start the same preview query twice from duplicate/native input
    // events. requestAI also has a shared in-flight guard, but this prevents
    // a second lifecycle from even reaching the request layer.
    if (state.lastStartedQuery === cleanQuery) {
      const cached = getCached(`${SEARCH_MODE}:${cleanQuery.toLowerCase()}`);
      const active = inFlight.get(`${SEARCH_MODE}:${cleanQuery.toLowerCase()}`);

      if (cached || active) {
        return;
      }
    }

    state.lastStartedQuery = cleanQuery;
    state.mode = "loading";
    input.setAttribute("aria-busy", "true");

    // The instant JEV request gets its own request slot so it never
    // marks the AI request as stale (and vice versa).
    const instantLane = {
      request: 0,
      controller: null,
      query: cleanQuery
    };

    state.instantLane = instantLane;

    let aiFinished = false;
    let instantShown = null;

    const stillCurrent = () =>
      state.instantLane === instantLane &&
      cleanQuery === String(input.value || "").trim();

    const productsOf = response =>
      Array.isArray(response?.products)
        ? response.products.slice(0, CFG.maxResults)
        : [];

    const signatureOf = response =>
      JSON.stringify([
        response?.resultType || "",
        productsOf(response).map(product => product?.handle || product?.title || "")
      ]);

    // Instant local matches already on screen for this exact query
    // (see LOCAL CATALOG).
    const localShownNow = () =>
      state.localShown?.query === cleanQuery ? state.localShown : null;

    // 1. Instant JEV results (shown only until the AI answers).
    //    Skipped when instant local matches are already shown (no
    //    flicker between two instant lists).
    const instantPromise = requestAI(cleanQuery, instantLane, INSTANT_MODE)
      .then(async ({ result: instant }) => {
        const instantProducts = productsOf(instant);

        if (
          !instant ||
          aiFinished ||
          !stillCurrent() ||
          !instantProducts.length ||
          localShownNow()
        ) {
          return;
        }

        const rendered = await renderAIResults(
          input,
          cleanQuery,
          instantProducts,
          state,
          state.request,
          instant.resultType,
          instant.message,
          () => !aiFinished && stillCurrent()
        );

        if (rendered) {
          instantShown = instant;
          state.serverRenderedQuery = cleanQuery;

          // The AI is still working on this search.
          input.setAttribute("aria-busy", "true");
        }
      })
      .catch(() => {
        // Instant results are best-effort; the AI request decides.
      });

    // 2. The AI's results (the backend falls back to JEV itself if
    //    the AI fails). Only once the customer has paused typing
    //    for CFG.aiPause; typing again before that skips the call.
    const extraPause = Math.max(0, CFG.aiPause - CFG.debounce);

    if (extraPause) {
      await new Promise(resolve => setTimeout(resolve, extraPause));

      if (!stillCurrent()) {
        return;
      }
    }

    const { result, id } = await requestAI(
      cleanQuery,
      state,
      SEARCH_MODE
    );

    aiFinished = true;

    if (
      !result ||
      id !== state.request ||
      cleanQuery !== String(input.value || "").trim()
    ) {
      return;
    }

    const products = productsOf(result);

    // Instant local matches count as instant results too.
    const localShown = instantShown ? null : localShownNow();

    if (!products.length) {
      // Keep instant results rather than replacing them with
      // nothing.
      if (instantShown || localShown) {
        input.removeAttribute("aria-busy");
        return;
      }

      showStatus(
        input,
        noResultsText(cleanQuery),
        "no-results"
      );
      return;
    }

    // AI failed (backend answered with JEV) or AI agrees with what
    // is already shown: keep the instant results, no flicker.
    if (
      instantShown &&
      (
        result.servedBy === "jev" ||
        signatureOf(result) === signatureOf(instantShown)
      )
    ) {
      input.removeAttribute("aria-busy");
      return;
    }

    // Same for instant local matches: keep them when the AI picked
    // exactly the same products (and has no "didn't find" message).
    if (
      localShown &&
      result.resultType !== "alternative" &&
      JSON.stringify(products.map(product => product?.handle || "")) ===
        JSON.stringify(localShown.products.map(product => product.handle))
    ) {
      state.serverRenderedQuery = cleanQuery;
      input.removeAttribute("aria-busy");
      return;
    }

    const aiRendered = await renderAIResults(
      input,
      cleanQuery,
      products,
      state,
      id,
      result.resultType,
      result.message
    );

    if (aiRendered) {
      state.serverRenderedQuery = cleanQuery;
    }

    // Not awaited earlier; make sure it has settled.
    await instantPromise;
  }


  // =========================================================
  // DEBOUNCE
  // =========================================================

  function scheduleSearch(
    input,
    query
  ) {
    const state = getState(input);
    const cleanQuery = String(query || "").trim();

    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    // Every keystroke makes the previous request obsolete.
    cancelState(state);
    state.query = cleanQuery;

    if (!cleanQuery) {
      if (state.localLane?.controller) {
        state.localLane.controller.abort();
      }
      state.localLane = null;
      state.mode = "idle";
      state.aiQuery = "";
      state.searchingQuery = "";
      state.lastStartedQuery = "";
      input.removeAttribute("aria-busy");
      return;
    }

    // Instant local matches, when every word matches a product
    // (see LOCAL CATALOG). Otherwise, as before: suppress native
    // suggestions and show the loading message until results come.
    if (!showLocalMatches(input, cleanQuery)) {
      showStatus(input, "Looking for best result...", "loading");

      // The product list is still loading (first keystroke): show its
      // matches as soon as it arrives, unless results came first.
      if (localCatalog.status === "loading" && localCatalog.promise) {
        localCatalog.promise.then(() => {
          if (
            String(input.value || "").trim() === cleanQuery &&
            state.serverRenderedQuery !== cleanQuery &&
            !state.localLane
          ) {
            showLocalMatches(input, cleanQuery);
          }
        });
      }
    }

    state.timer = setTimeout(() => {
      state.timer = null;

      runPredictiveSearch(input, cleanQuery).catch(error => {
        if (error?.name === "AbortError") return;

        if (String(input.value || "").trim() === cleanQuery) {
          state.mode = "idle";
          input.removeAttribute("aria-busy");

          // Don't leave "Looking for best result..." on screen
          // forever; results already shown stay.
          const container = getResultContainer(input);

          if (
            container &&
            container.querySelector("[data-ai-search-status]") &&
            !container.querySelector("a[href*='/products/']")
          ) {
            state.statusText = "";
            clearResultArea(input);
          }
        }

        console.error(
          "[Askmerce] Predictive search error:",
          error
        );
      });
    }, CFG.debounce);
  }


  // =========================================================
  // FULL SEARCH: SAVE AI QUERY
  // =========================================================

  function savePendingSearch(
    originalQuery,
    aiQuery
  ) {

    try {

      sessionStorage.setItem(
        CFG.pendingSearchKey,

        JSON.stringify({
          originalQuery,

          aiQuery,

          time:
            Date.now()
        })
      );

    } catch (_) {}
  }


  function getPendingSearch() {

    try {

      const raw =
        sessionStorage.getItem(
          CFG.pendingSearchKey
        );


      if (!raw) {
        return null;
      }


      sessionStorage.removeItem(
        CFG.pendingSearchKey
      );


      const data =
        JSON.parse(
          raw
        );


      if (
        !data?.originalQuery ||
        !data?.aiQuery
      ) {

        return null;
      }


      if (
        Date.now() -
          Number(
            data.time || 0
          ) >
        30000
      ) {

        return null;
      }


      return data;

    } catch (_) {

      return null;
    }
  }


  // =========================================================
  // RESTORE ORIGINAL QUERY ON FULL SEARCH PAGE
  // =========================================================

  function restoreOriginalSearchQuery(
    originalQuery,
    aiQuery
  ) {

    if (
      !originalQuery ||
      !aiQuery
    ) {

      return;
    }


    document
      .querySelectorAll(
        [
          'input[type="search"]',
          'input[name="q"]',
          'input[name="query"]'
        ].join(",")
      )
      .forEach(
        input => {

          if (
            input.value ===
              aiQuery ||
            input.value.includes(
              aiQuery
            )
          ) {

            input.value =
              input.value
                .split(
                  aiQuery
                )
                .join(
                  originalQuery
                );


            input.setAttribute(
              "value",
              input.value
            );
          }
        }
      );


    replaceVisibleQueryText(
      originalQuery,
      aiQuery
    );


    try {

      const url =
        new URL(
          window.location.href
        );


      url.searchParams.set(
        "q",
        originalQuery
      );

      window.history.replaceState(
        {},
        "",
        url.toString()
      );

    } catch (_) {}
  }


  /*
   * Many themes print the search terms on the results page
   * (e.g. `4 results for "..."`) and in the page title. Shopify
   * filled them with the internal AI query (title:"..." OR ...),
   * so show the shopper's wording there too. Only text nodes
   * that contain the exact internal query are touched.
   */
  function replaceVisibleQueryText(
    originalQuery,
    aiQuery
  ) {
    try {
      if (document.title.includes(aiQuery)) {
        document.title = document.title.split(aiQuery).join(originalQuery);
      }

      if (!document.body) {
        return;
      }

      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: node =>
            node.nodeValue &&
            node.nodeValue.includes(aiQuery) &&
            !node.parentElement?.closest("script, style, noscript, textarea")
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_REJECT
        }
      );

      const nodes = [];

      while (walker.nextNode()) {
        nodes.push(walker.currentNode);
      }

      nodes.forEach(node => {
        node.nodeValue = node.nodeValue.split(aiQuery).join(originalQuery);
      });
    } catch (_) {
      // Cosmetic only; never break the results page.
    }
  }


  function restoreFullSearchPage() {

    if (
      !window.location.pathname
        .toLowerCase()
        .startsWith(
          "/search"
        )
    ) {

      return;
    }


    const pending =
      getPendingSearch();


    if (!pending) {
      return;
    }


    setTimeout(
      () => {

        restoreOriginalSearchQuery(
          pending.originalQuery,
          pending.aiQuery
        );

      },
      50
    );


    setTimeout(
      () => {

        restoreOriginalSearchQuery(
          pending.originalQuery,
          pending.aiQuery
        );

      },
      500
    );


    // Themes that render parts of the results page later (e.g.
    // a heading drawn by script) get one more pass.
    setTimeout(
      () => {

        replaceVisibleQueryText(
          pending.originalQuery,
          pending.aiQuery
        );

      },
      1500
    );
  }


  // =========================================================
  // SEARCH QUESTIONS (merchant suggestions)
  // =========================================================
  //
  // The merchant's 5–7 questions (admin "Search Questions"
  // page) arrive in the app embed's data-search-questions
  // attribute. They are shown inside the theme's OWN
  // predictive-search dropdown — found with the same
  // getResultContainer() used for AI results, styled with the
  // same learned theme row style as the status messages — when
  // a search input is focused and empty.
  //
  // Selecting a question goes straight to the full search
  // results page with the AI's products (selectQuestion), using
  // the same steps as the existing submit flow, which itself is
  // unchanged.
  //
  // When the attribute is absent (feature off, fewer than 5
  // questions, or an older embed) none of this runs.
  // =========================================================

  const QUESTIONS_MIN = 5;
  const QUESTIONS_MAX = 7;
  const QUESTION_MAX_LENGTH = 120;
  const QUESTION_HIGHLIGHT = "rgba(127, 127, 127, 0.12)";
  // How many times a theme may wipe the open questions before
  // we stop putting them back (avoids fighting a theme).
  const QUESTION_MAX_RESTORES = 5;

  let searchQuestionsConfig = null;
  let questionListSequence = 0;

  function readSearchQuestions() {
    try {
      const root = document.querySelector(
        "[data-ai-product-search][data-search-questions]"
      );

      if (!root) {
        return null;
      }

      const data = JSON.parse(root.getAttribute("data-search-questions") || "null");

      if (!data || data.enabled !== true || !Array.isArray(data.questions)) {
        return null;
      }

      const seen = new Set();
      const questions = data.questions
        .map(question => String(question == null ? "" : question).replace(/\s+/g, " ").trim())
        .filter(question => {
          const key = question.toLowerCase();

          if (!question || question.length > QUESTION_MAX_LENGTH || seen.has(key)) {
            return false;
          }

          seen.add(key);
          return true;
        })
        .slice(0, QUESTIONS_MAX);

      if (questions.length < QUESTIONS_MIN) {
        return null;
      }

      return {
        heading: String(data.heading || "").replace(/\s+/g, " ").trim().slice(0, 60),
        questions
      };
    } catch (_) {
      return null;
    }
  }

  function getSearchQuestions() {
    if (!searchQuestionsConfig) {
      searchQuestionsConfig = readSearchQuestions();
    }

    return searchQuestionsConfig;
  }

  /*
   * On the search results page the theme pre-fills its search
   * inputs with the current query. Until the shopper edits it,
   * such an input counts as empty for the questions, so opening
   * search there shows the questions too.
   */
  function currentResultsQuery() {
    try {
      if (!/(^|\/)search\/?$/i.test(window.location.pathname)) {
        return "";
      }

      return String(new URLSearchParams(window.location.search).get("q") || "")
        .replace(/\s+/g, " ")
        .trim();
    } catch (_) {
      return "";
    }
  }

  function inputValue(input) {
    return String(input.value || "").replace(/\s+/g, " ").trim();
  }

  function questionsAllowedFor(input) {
    const value = inputValue(input);
    return !value || value === currentResultsQuery();
  }

  function getQuestionGroup(container) {
    return container
      ? container.querySelector("[data-ai-search-questions]")
      : null;
  }

  /*
   * WHERE THE QUESTIONS ARE SHOWN, in this order:
   *
   *  1. "native": the predictive dropdown this script already
   *     knows (getResultContainer — Dawn family). Unchanged.
   *  2. "theme":  the theme's own search-results area, found by
   *     what most themes have in common (aria-controls of the
   *     search box, or an element near it named like
   *     predictive / results / suggestions). Nothing is
   *     theme-specific. It is then checked to really be visible;
   *     if the theme keeps it hidden, (3) is used instead.
   *  3. "panel":  a dropdown attached directly under the theme's
   *     own search box, styled from that box (font, colours,
   *     border, corners). It is not a search bar; the theme's
   *     box stays the only one.
   *
   * Only the questions use (2) and (3). AI results for typed
   * searches keep using getResultContainer() exactly as before.
   */
  const QUESTION_AREA_SELECTOR = [
    "[id*='predictive' i]",
    "[class*='predictive' i]",
    "[id*='result' i]",
    "[class*='result' i]",
    "[id*='suggest' i]",
    "[class*='suggest' i]",
    "[id*='autocomplete' i]",
    "[class*='autocomplete' i]",
    "[role='listbox']"
  ].join(",");

  // Name parts that mean "a piece of the search UI", not the
  // area results are listed in.
  const QUESTION_AREA_EXCLUDED_WORDS = new Set([
    "count", "title", "heading", "header", "close", "icon", "btn",
    "button", "toggle", "label", "input", "field", "form", "spinner",
    "loader", "loading", "overlay", "backdrop", "trigger", "submit",
    "reset", "clear", "item", "card", "empty", "error", "message"
  ]);

  // Stop looking at these (the search's own boundaries).
  const QUESTION_SCOPE_BOUNDARY =
    "header, [role='banner'], dialog, [role='dialog'], [aria-modal='true']";

  function nameWords(element) {
    return String(
      `${element.id || ""} ${element.getAttribute("class") || ""}`
    )
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  }

  function isQuestionAreaCandidate(element, input) {
    if (
      !element ||
      element.contains(input) ||
      element.closest("[data-ai-search-panel]")
    ) {
      return false;
    }

    const tag = element.tagName.toLowerCase();

    if (
      !tag.includes("-") &&
      !["div", "ul", "ol", "section", "aside", "nav"].includes(tag)
    ) {
      return false;
    }

    // The search page's own product grid is not a dropdown.
    if (
      element.closest("main") &&
      element.querySelector("a[href*='/products/']")
    ) {
      return false;
    }

    return true;
  }

  function questionAreaScore(element) {
    const words = nameWords(element);

    if (words.some(word => QUESTION_AREA_EXCLUDED_WORDS.has(word))) {
      return 0;
    }

    let score = 0;

    if (words.some(word => word.startsWith("predictive"))) score += 3;
    if (words.some(word => word.includes("result"))) score += 2;
    if (words.some(word => word.includes("suggest"))) score += 2;
    if (words.some(word => word.includes("autocomplete"))) score += 2;
    if (words.some(word => word.includes("search"))) score += 1;
    if (element.getAttribute("role") === "listbox") score += 2;

    return score;
  }

  function findThemeQuestionArea(input) {
    try {
      // a) The element the search box says it controls.
      const owners = [input, input.closest("[role='combobox']")].filter(Boolean);

      for (const owner of owners) {
        const ids = `${owner.getAttribute("aria-controls") || ""} ${owner.getAttribute("aria-owns") || ""}`
          .split(/\s+/)
          .filter(Boolean);

        for (const id of ids) {
          const element = document.getElementById(id);

          if (isQuestionAreaCandidate(element, input)) {
            return element;
          }
        }
      }

      // b) The closest well-named area around the search box.
      for (
        let scope = input.parentElement, level = 0;
        scope && level < 8;
        scope = scope.parentElement, level++
      ) {
        if (
          scope === document.body ||
          scope === document.documentElement ||
          scope.matches("main") ||
          scope.querySelector("main")
        ) {
          break;
        }

        let best = null;
        let bestScore = 1;

        scope.querySelectorAll(QUESTION_AREA_SELECTOR).forEach(element => {
          if (!isQuestionAreaCandidate(element, input)) {
            return;
          }

          const score = questionAreaScore(element);

          // Document order: on a tie the outer area wins.
          if (score > bestScore) {
            best = element;
            bestScore = score;
          }
        });

        if (best) {
          return best;
        }

        if (scope.matches(QUESTION_SCOPE_BOUNDARY)) {
          break;
        }
      }
    } catch (error) {
      // Detection is best-effort; the panel is the fallback.
    }

    return null;
  }

  function isShownOnScreen(element) {
    if (!element || !element.isConnected) {
      return false;
    }

    const rect = element.getBoundingClientRect();

    if (rect.width < 1 || rect.height < 1) {
      return false;
    }

    if (typeof element.checkVisibility === "function") {
      return element.checkVisibility({
        opacityProperty: true,
        visibilityProperty: true
      });
    }

    return window.getComputedStyle(element).visibility !== "hidden";
  }

  /*
   * The theme's search box: the input plus its wrapper (icon,
   * submit button, border), i.e. the largest ancestor that is
   * still about as tall as the input.
   */
  function findSearchBox(input) {
    const height = input.getBoundingClientRect().height;
    let box = input;

    if (!height) {
      return box;
    }

    for (
      let element = input.parentElement;
      element && element !== document.body;
      element = element.parentElement
    ) {
      if (
        element.matches(QUESTION_SCOPE_BOUNDARY) ||
        element.getBoundingClientRect().height > Math.max(height * 1.8, height + 24)
      ) {
        break;
      }

      box = element;
    }

    return box;
  }

  // First background that is not see-through, from the search
  // box outwards (the box, then the drawer/header behind it).
  function surfaceColor(element) {
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      const color = window.getComputedStyle(node).backgroundColor || "";
      const match = color.match(/rgba?\(([^)]+)\)/i);

      if (!match) {
        continue;
      }

      const parts = match[1].split(/[\s,/]+/).filter(Boolean);
      const alpha = parts.length > 3 ? parseFloat(parts[3]) : 1;

      if (alpha >= 0.9) {
        return color;
      }
    }

    return "#ffffff";
  }

  function styleQuestionPanel(input, panel, box) {
    const inputStyle = window.getComputedStyle(input);
    const borderWidth = parseFloat(inputStyle.borderTopWidth || "0");
    const radius = Math.min(
      parseFloat(inputStyle.borderTopLeftRadius || inputStyle.borderRadius || "0") || 0,
      12
    );

    panel.style.position = "absolute";
    panel.style.zIndex = "2147483000";
    panel.style.boxSizing = "border-box";
    panel.style.minWidth = "220px";
    panel.style.margin = "4px 0 0";
    panel.style.padding = "6px 0";
    panel.style.maxHeight = "60vh";
    panel.style.overflowY = "auto";
    panel.style.textAlign = "left";
    panel.style.textTransform = "none";
    panel.style.letterSpacing = "normal";
    panel.style.fontFamily = inputStyle.fontFamily;
    panel.style.fontSize = inputStyle.fontSize;
    panel.style.color = inputStyle.color;
    panel.style.backgroundColor = surfaceColor(input);
    panel.style.border =
      borderWidth > 0
        ? `${inputStyle.borderTopWidth} solid ${inputStyle.borderTopColor}`
        : "1px solid rgba(127, 127, 127, 0.25)";
    panel.style.borderRadius = `${radius}px`;
    panel.style.boxShadow = "0 10px 30px rgba(0, 0, 0, 0.12)";
  }

  // Puts the panel right under the search box, inside the same
  // part of the page (so it shows inside the theme's drawer or
  // modal too).
  function positionQuestionPanel(input) {
    const state = getState(input);
    const panel = state.questionPanel;

    if (!panel || !panel.isConnected) {
      return;
    }

    if (!state.questionBoxMeasured && input.getBoundingClientRect().height) {
      // The box could not be measured while the drawer was still
      // closed; measure it now that it is visible.
      state.questionBoxMeasured = true;
      const box = findSearchBox(input);

      if (box !== state.questionBox) {
        state.internalMutation = true;
        state.questionBox = box;
        box.after(panel);
        queueMicrotask(() => { state.internalMutation = false; });
      }
    }

    const box = state.questionBox;
    const boxRect = box ? box.getBoundingClientRect() : null;

    if (!boxRect || !boxRect.width) {
      return;
    }

    const parent = panel.offsetParent;
    const parentRect = parent
      ? parent.getBoundingClientRect()
      : { top: 0, left: 0 };
    const offsetTop = parent ? parent.scrollTop - parent.clientTop : window.scrollY;
    const offsetLeft = parent ? parent.scrollLeft - parent.clientLeft : window.scrollX;

    panel.style.top = `${Math.round(boxRect.bottom - parentRect.top + offsetTop)}px`;
    panel.style.left = `${Math.round(boxRect.left - parentRect.left + offsetLeft)}px`;
    panel.style.width = `${Math.round(boxRect.width)}px`;
  }

  let questionPanelResizeListener = false;

  function ensureQuestionPanel(input) {
    const state = getState(input);

    if (!state.questionPanel) {
      const panel = document.createElement("div");
      panel.setAttribute("data-ai-search-panel", "true");
      state.questionPanel = panel;
    }

    const panel = state.questionPanel;
    const box = findSearchBox(input);

    state.questionBox = box;
    state.questionBoxMeasured = Boolean(input.getBoundingClientRect().height);

    if (!panel.isConnected || panel.previousElementSibling !== box) {
      box.after(panel);
    }

    styleQuestionPanel(input, panel, box);

    if (!questionPanelResizeListener) {
      questionPanelResizeListener = true;

      window.addEventListener("resize", () => {
        trackedInputs.forEach(tracked => {
          const trackedState = states.get(tracked);

          if (trackedState && trackedState.questionKind === "panel") {
            positionQuestionPanel(tracked);
          }
        });
      });
    }

    return panel;
  }

  function resolveQuestionPlacement(input) {
    const state = getState(input);

    // Skipped only when the questions were found invisible in it
    // (e.g. it matched a hidden menu inside the search form).
    if (!state.nativeQuestionRejected && getResultContainer(input)) {
      return { kind: "native", container: null };
    }

    if (!state.questionAreaRejected) {
      const area = findThemeQuestionArea(input);

      if (area) {
        return { kind: "theme", container: area };
      }
    }

    return { kind: "panel", container: null };
  }

  // The element the questions are in right now (any placement).
  function questionContainerFor(input) {
    const state = getState(input);

    return state.questionKind && state.questionKind !== "native"
      ? state.questionContainer
      : getResultContainer(input);
  }

  function removeQuestionPlacement(input) {
    const state = getState(input);

    if (state.questionKind === "panel" && state.questionPanel) {
      state.questionPanel.remove();
    } else if (state.questionKind === "theme" || state.questionKind === "native") {
      const group = getQuestionGroup(
        state.questionKind === "native"
          ? getResultContainer(input)
          : state.questionContainer
      );

      if (group) {
        group.remove();
      }
    }

    if (state.questionPendingElement) {
      state.questionPendingElement.remove();
      state.questionPendingElement = null;
    }
  }

  /*
   * After showing in the theme's area: once the search box is on
   * screen (drawers animate in), check the questions are really
   * visible. Themes that keep that area hidden until results
   * arrive get the panel instead. The panel is re-aligned while
   * the drawer settles.
   */
  function verifyQuestionPlacement(input, attempt) {
    const state = getState(input);
    const kind = state.questionKind;

    setTimeout(() => {
      if (state.mode !== "questions" || state.questionKind !== kind) {
        return;
      }

      if (kind === "panel") {
        positionQuestionPanel(input);
      }

      if (!isShownOnScreen(input)) {
        if (attempt < 10) {
          verifyQuestionPlacement(input, attempt + 1);
        }

        return;
      }

      if (kind === "theme" || kind === "native") {
        const container =
          kind === "native" ? getResultContainer(input) : state.questionContainer;
        const group = getQuestionGroup(container);

        if (!isShownOnScreen(group) || !isShownOnScreen(container)) {
          if (kind === "native") {
            state.nativeQuestionRejected = true;
          } else {
            state.questionAreaRejected = true;
          }

          showQuestionSuggestions(input, {});
        }

        return;
      }

      if (attempt < 3) {
        verifyQuestionPlacement(input, attempt + 1);
      }
    }, attempt === 0 ? 60 : 150);
  }

  // "Searching with AI..." where the questions were, for the
  // theme-area and panel placements (the native dropdown uses
  // showStatus() as before).
  function showQuestionPending(input, placement, text) {
    const state = getState(input);
    const config = { heading: "", questions: [] };
    let container = placement.container;

    if (placement.kind === "panel") {
      container = ensureQuestionPanel(input);

      // The panel is this script's own element and is reused: a
      // cancelled earlier message (shopper kept typing, then pressed
      // Enter again) must not stay in it next to the new one.
      container?.replaceChildren();
    }

    if (!container) {
      return;
    }

    const group = buildQuestionGroup(input, container, config, "plain");
    const row = document.createElement("div");
    const label = document.createElement("span");

    label.textContent = text;
    styleQuestionRow(row, label, false, "plain", input);
    row.setAttribute("data-ai-search-status", "true");
    row.setAttribute("role", "status");
    row.appendChild(label);
    group.insertBefore(row, group.firstChild);

    state.internalMutation = true;

    try {
      container.insertBefore(group, container.firstChild);
    } finally {
      queueMicrotask(() => { state.internalMutation = false; });
    }

    state.questionPendingElement =
      placement.kind === "panel" ? container : group;

    if (placement.kind === "panel") {
      positionQuestionPanel(input);
    }
  }

  function getQuestionOptions(input) {
    const group = getQuestionGroup(questionContainerFor(input));

    return group
      ? Array.from(group.querySelectorAll("[data-ai-search-question]"))
      : [];
  }

  function setActiveQuestion(input, index) {
    const state = getState(input);
    const options = getQuestionOptions(input);

    state.activeQuestion =
      options.length && index >= 0 ? index % options.length : -1;

    options.forEach((option, i) => {
      const active = i === state.activeQuestion;
      option.setAttribute("aria-selected", active ? "true" : "false");
      option.style.backgroundColor = active ? QUESTION_HIGHLIGHT : "";
    });

    if (state.activeQuestion >= 0) {
      input.setAttribute("aria-activedescendant", options[state.activeQuestion].id);
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  /*
   * Theme-native look, same approach as createStatusElement():
   * the classes/padding learned from this theme's own product
   * rows, or Dawn-family classes before anything is learned.
   */
  function styleQuestionRow(row, textElement, isHeading, look, input) {
    if (look === "plain") {
      // Theme area / panel: the theme's own font and colours are
      // inherited; rows line up with the text in the search box.
      const inputStyle = window.getComputedStyle(input);
      const padX = Math.round(
        Math.max(12, parseFloat(inputStyle.paddingLeft || "0") || 0) +
        (parseFloat(inputStyle.borderLeftWidth || "0") || 0)
      );

      row.style.display = "block";
      row.style.padding = isHeading ? `0.5em ${padX}px 0.25em` : `0.55em ${padX}px`;
      row.style.lineHeight = "1.4";
      textElement.style.margin = "0";
      textElement.style.color = "inherit";

      if (isHeading) {
        textElement.style.fontSize = "0.8em";
        textElement.style.opacity = "0.7";
      }

      return;
    }

    const learned = themeStatusStyle;

    if (learned) {
      textElement.className = learned.textClass || "";
      row.style.paddingTop = learned.paddingTop;
      row.style.paddingBottom = learned.paddingBottom;
      row.style.paddingLeft = learned.paddingLeft;
      row.style.paddingRight = learned.paddingRight;
    } else if (isHeading) {
      textElement.className =
        "predictive-search__heading text-body caption-with-letter-spacing";
    } else {
      row.className = "predictive-search__list-item predictive-search__item";
      textElement.className = "predictive-search__item-heading h5";
    }

    if (isHeading) {
      textElement.style.opacity = "0.75";

      if (learned) {
        textElement.style.fontSize = "0.85em";
      }
    }

    textElement.style.margin = "0";

    if (!learned) {
      queueMicrotask(() => {
        try {
          if (
            row.isConnected &&
            parseFloat(window.getComputedStyle(row).paddingLeft || "0") === 0
          ) {
            row.style.padding = isHeading ? "1rem 2rem 0.5rem" : "1rem 2rem";
          }
        } catch (error) {
          // best-effort only
        }
      });
    }
  }

  function buildQuestionGroup(input, container, config, look) {
    const learned = look === "plain" ? null : themeStatusStyle;
    const textTag =
      learned && /^(p|span|div|h[1-6])$/.test(learned.textTag)
        ? learned.textTag
        : "span";

    const listId = `ai-search-questions-${++questionListSequence}`;
    const group = document.createElement(container.matches("ul, ol") ? "li" : "div");
    group.setAttribute("data-ai-search-questions", "true");
    group.style.listStyle = "none";

    const list = document.createElement("ul");
    list.id = listId;
    list.setAttribute("role", "listbox");
    list.style.listStyle = "none";
    list.style.margin = "0";
    list.style.padding = "0";

    if (config.heading) {
      const headingRow = document.createElement("div");
      const headingText = document.createElement(textTag === "span" ? "span" : "p");
      headingText.id = `${listId}-label`;
      headingText.textContent = config.heading;
      styleQuestionRow(headingRow, headingText, true, look, input);
      headingRow.appendChild(headingText);
      group.appendChild(headingRow);
      list.setAttribute("aria-labelledby", headingText.id);
    }

    config.questions.forEach((question, index) => {
      const option = document.createElement("li");
      const text = document.createElement(textTag);

      option.id = `${listId}-${index}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.setAttribute("data-ai-search-question", question);
      option.style.listStyle = "none";
      option.style.cursor = "pointer";

      text.textContent = question;
      styleQuestionRow(option, text, false, look, input);
      option.appendChild(text);

      // Keep focus in the input so themes that close their
      // dropdown on blur don't close it before the click lands.
      option.addEventListener("pointerdown", event => event.preventDefault());
      option.addEventListener("mousedown", event => event.preventDefault());
      option.addEventListener("pointerenter", () => setActiveQuestion(input, index));
      option.addEventListener("click", event => {
        event.preventDefault();
        // The list is replaced by "Searching with AI..." during
        // this click, so to the theme's document-level "click
        // outside closes search" handlers the target would look
        // like it is outside the search. The click is ours; it
        // stops here.
        event.stopPropagation();
        selectQuestion(input, question);
      });

      list.appendChild(option);
    });

    group.appendChild(list);
    return group;
  }

  function showQuestionSuggestions(input, options) {
    const config = getSearchQuestions();

    if (!config || !input || !questionsAllowedFor(input)) {
      return false;
    }

    const state = getState(input);
    const restoring = Boolean(options && options.restore);

    if (restoring) {
      state.questionRestores = (state.questionRestores || 0) + 1;

      if (state.questionRestores > QUESTION_MAX_RESTORES) {
        state.mode = "idle";
        return false;
      }
    } else {
      state.questionRestores = 0;
    }

    const placement = resolveQuestionPlacement(input);
    const native = placement.kind === "native";

    state.internalMutation = true;

    try {
      // Moving to a different placement (e.g. theme area found
      // hidden -> panel): take the questions out of the old one.
      if (
        state.questionKind &&
        (state.questionKind !== placement.kind ||
          (!native && state.questionContainer !== placement.container && placement.kind === "theme"))
      ) {
        removeQuestionPlacement(input);
      }

      const container = native
        ? openNativeShell(input)
        : placement.kind === "theme"
          ? placement.container
          : ensureQuestionPanel(input);

      if (!container) {
        return false;
      }

      if (native && ((options && options.replace) || inputValue(input))) {
        // Clear our own earlier results/status from this input,
        // or native rows for a pre-filled results-page input.
        container.replaceChildren();
      } else {
        // Keep any content the theme shows itself (popular
        // products etc.); questions go above it. The theme's own
        // area is never cleared.
        const existing = getQuestionGroup(container);

        if (existing) {
          existing.remove();
        }
      }

      container.insertBefore(
        buildQuestionGroup(input, container, config, native ? "native" : "plain"),
        container.firstChild
      );

      state.questionKind = placement.kind;
      state.questionContainer = container;
    } finally {
      queueMicrotask(() => {
        state.internalMutation = false;
      });
    }

    state.mode = "questions";
    state.activeQuestion = -1;
    state.statusText = "";
    state.searchingQuery = "";
    input.removeAttribute("aria-busy");
    input.removeAttribute("aria-activedescendant");
    input.setAttribute("aria-expanded", "true");

    if (placement.kind === "panel") {
      positionQuestionPanel(input);
    }

    // Every placement is checked to be really visible (see
    // verifyQuestionPlacement); hidden ones fall through to the
    // next placement.
    verifyQuestionPlacement(input, 0);

    return true;
  }

  function hideQuestionSuggestions(input, options) {
    const state = getState(input);
    const kind = state.questionKind || "native";
    const container = questionContainerFor(input);
    const group = getQuestionGroup(container);

    state.internalMutation = true;

    try {
      if (group) {
        group.remove();
      }

      if (kind === "panel" && state.questionPanel) {
        state.questionPanel.remove();
      }
    } finally {
      queueMicrotask(() => {
        state.internalMutation = false;
      });
    }

    state.questionKind = null;
    state.questionContainer = null;

    if (state.mode === "questions") {
      state.mode = "idle";
    }

    state.activeQuestion = -1;
    input.removeAttribute("aria-activedescendant");

    if (
      options &&
      options.close &&
      kind === "native" &&
      container &&
      !String(container.textContent || "").trim()
    ) {
      closeNativeShell(input);
    }
  }

  /*
   * Search results page URL, built the same way as the submit
   * flow below: the form's action, its other fields kept (e.g.
   * options[prefix], type), and `q` set to the given query.
   */
  function searchResultsUrl(form, query) {
    const action =
      (form && form.getAttribute("action")) ||
      window.Shopify?.routes?.search_url ||
      "/search";

    const target = new URL(action, window.location.origin);

    if (form) {
      for (const [key, value] of new FormData(form).entries()) {
        if (key !== "q" && typeof value === "string") {
          target.searchParams.append(key, value);
        }
      }
    }

    target.searchParams.set("q", query);
    return target.toString();
  }

  /*
   * A selected question goes straight to the full search
   * results page with the AI's products — the same steps the
   * submit flow (FORM SUBMIT / ENTER) takes for a typed query:
   * requestAI() in final mode -> buildAIQuery() -> savePendingSearch()
   * so the results page shows the question as the search text
   * (restoreFullSearchPage) -> navigate. No products are shown
   * in the dropdown; it only says "Searching with AI..." while
   * the AI answers.
   *
   * If the AI returns nothing (or fails), the results page is
   * still opened, with the question itself as the query.
   */
  async function selectQuestion(input, question) {
    const state = getState(input);

    // A newer selection replaces an unfinished one.
    if (state.questionLane) {
      state.questionLane.cancelled = true;
    }

    /*
     * The question search gets its own request slot (like the
     * instant JEV lane), not the input's. Themes react to the
     * click in their own ways — closing the search, clearing the
     * box, firing input events that end in cancelState() — and
     * the first, uncached AI answer takes a few seconds, so with
     * the input's slot such reactions silently dropped the
     * search (it only "worked" on a second, cached try). Only
     * the shopper cancels it: Escape, or typing a different
     * search.
     */
    const lane = { request: 0, controller: null, query: question, cancelled: false };
    state.questionLane = lane;

    const cancel = () => {
      lane.cancelled = true;

      if (lane.controller) {
        lane.controller.abort();
      }

      if (state.questionPendingElement) {
        state.questionPendingElement.remove();
        state.questionPendingElement = null;
      }
    };

    const onKeydown = event => {
      if (event.key === "Escape") {
        cancel();
      }
    };

    const onInput = event => {
      const value = event.target === input ? inputValue(input) : "";

      // An emptied box is usually the theme resetting its search
      // UI; a different non-empty value is the shopper typing.
      if (value && value !== question) {
        cancel();
      }
    };

    document.addEventListener("keydown", onKeydown, true);
    document.addEventListener("input", onInput, true);

    const placement = {
      kind: state.questionKind || "native",
      container: state.questionContainer
    };

    hideQuestionSuggestions(input);
    cancelState(state);

    input.value = question;
    state.query = question;
    state.lastStartedQuery = "";

    if (placement.kind === "native") {
      showStatus(input, "Just a moment…", "loading");
    } else {
      showQuestionPending(input, placement, "Just a moment…");
    }

    let aiQuery = "";

    try {
      const { result } = await requestAI(question, lane, SEARCH_MODE);
      const products = Array.isArray(result?.products) ? result.products : [];

      if (products.length) {
        aiQuery = buildAIQuery(products, question);
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        console.error("[Askmerce] Question search error:", error);
      }
    } finally {
      document.removeEventListener("keydown", onKeydown, true);
      document.removeEventListener("input", onInput, true);
    }

    if (lane.cancelled || state.questionLane !== lane) {
      return;
    }

    state.questionLane = null;

    if (aiQuery && aiQuery !== question) {
      savePendingSearch(question, aiQuery);
    }

    window.location.assign(searchResultsUrl(input.form, aiQuery || question));
  }


  // =========================================================
  // INPUT EVENT INTERCEPTION
  // =========================================================

  // =========================================================
  // THEME CLEAR BUTTON
  // =========================================================
  //
  // While the shopper types, this script handles the input event
  // so the theme doesn't run its own product search. In themes
  // like Horizon (and Dawn) that same handler is what shows the
  // theme's own "Clear"/reset button, so it stayed hidden. Here we
  // do only that part, exactly the way the theme does it:
  //   - Horizon: resetButton.hidden = false
  //   - Dawn-style: remove the "hidden" class
  // No styles or elements are added, and the browser's own clear
  // control is left as it is. Hiding it again (empty box, Escape,
  // clicking Clear) stays with the theme's own handlers, which
  // still run for those.
  // =========================================================

  const THEME_CLEAR_SELECTOR = [
    '[ref="resetButton"]',
    'button[type="reset"]',
    ".reset__button",
    ".search__reset",
    ".predictive-search__reset",
    'button[aria-label*="clear" i]',
    'button[aria-label*="reset" i]'
  ].join(",");

  function findThemeClearButton(input) {
    const scope =
      input.closest(
        "predictive-search-component, predictive-search, search-form, " +
        "form, [role='search'], dialog"
      ) || input.parentElement;

    if (!scope) {
      return null;
    }

    for (const candidate of scope.querySelectorAll(THEME_CLEAR_SELECTOR)) {
      // Never one of this script's own elements.
      if (candidate.closest("[data-ai-search-questions], [data-ai-search-status], [data-ai-search-panel]")) {
        continue;
      }

      return candidate;
    }

    return null;
  }

  function showThemeClearButton(input) {
    if (!String(input.value || "").length) {
      return;
    }

    try {
      const button = findThemeClearButton(input);

      if (!button) {
        return;
      }

      if (button.hidden) {
        button.hidden = false;
      } else if (button.classList.contains("hidden")) {
        button.classList.remove("hidden");
      }
    } catch (error) {
      // Cosmetic only; never affect search.
    }
  }


  function attachInput(input) {
    if (!isSearchInput(input) || attachedInputs.has(input)) {
      return;
    }

    attachedInputs.add(input);
    trackedInputs.add(input);

    const state = getState(input);
    state.host = getPredictiveHost(input);
    patchPredictiveHost(input);

    // Only the input event is intercepted so the app can decide which
    // products the theme should display. Keyboard, focus, Escape, arrows,
    // mobile drawers/modals and accessibility remain native to the theme.
    input.addEventListener(
      "input",
      event => {
        const query = String(input.value || "").trim();

        if (!query) {
          // Let the native theme handle an empty search normally.
          cancelState(state);
          state.mode = "idle";
          state.query = "";
          state.lastStartedQuery = "";
          input.removeAttribute("aria-busy");

          // Merchant questions, if configured (no-op otherwise).
          showQuestionSuggestions(input, { replace: true });
          return;
        }

        // The shopper started typing: questions shown outside the
        // native dropdown (theme area / panel) go away. In the
        // native dropdown they are replaced by the AI status as
        // before.
        if (
          state.mode === "questions" &&
          state.questionKind &&
          state.questionKind !== "native"
        ) {
          hideQuestionSuggestions(input);
        }

        if (query.length < CFG.minLength) {
          // Below the meaningful-character threshold: no AI request
          // is sent yet (still avoids firing a backend search for a
          // single stray keystroke), but native Shopify search must
          // never be allowed to render either — e.g. its own
          // "Search for 's'" suggestion. Native is suppressed the
          // same way a normal query suppresses it, showing the same
          // "Looking for best result..." placeholder as a holding
          // state (mirrors what scheduleSearch already shows
          // immediately, before its debounce timer even fires) until
          // enough characters are typed to actually search.
          cancelState(state);
          state.query = query;
          state.lastStartedQuery = "";

          event.preventDefault();
          event.stopImmediatePropagation();

          // The theme's own typing handler didn't run: show its Clear
          // button the way it would (see showThemeClearButton).
          showThemeClearButton(input);

          showStatus(input, "Looking for best result...", "loading");
          return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();

        showThemeClearButton(input);

        // Instant local results (no-op once loaded or turned off).
        ensureLocalCatalog();

        scheduleSearch(input, query);
      },
      true
    );

    // -------------------------------------------------------
    // Merchant search questions (see SEARCH QUESTIONS). Every
    // handler below returns immediately unless questions are
    // configured and currently shown for an empty input.
    // -------------------------------------------------------

    const showQuestionsIfEmpty = () => {
      if (!questionsAllowedFor(input) || !getSearchQuestions()) {
        return;
      }

      if (
        state.mode === "questions" &&
        getQuestionGroup(questionContainerFor(input))
      ) {
        return;
      }

      showQuestionSuggestions(input, {
        // Our own earlier results/status may still be in the
        // dropdown; theme-owned empty-state content is kept.
        replace: Boolean(state.markup || state.statusText)
      });
    };

    // Load the product list for instant results before the first
    // keystroke (once per page; kept for CFG.localCatalogTtl).
    const loadLocalCatalog = () => {
      ensureLocalCatalog();
    };

    input.addEventListener("focus", loadLocalCatalog);
    input.addEventListener("pointerdown", loadLocalCatalog);

    // Already focused before this script started (e.g. a theme that
    // auto-focuses its search box): load it now.
    if (document.activeElement === input) {
      loadLocalCatalog();
    }

    input.addEventListener("focus", showQuestionsIfEmpty);
    input.addEventListener("click", showQuestionsIfEmpty);

    input.addEventListener(
      "keydown",
      event => {
        if (state.mode !== "questions" || !questionsAllowedFor(input)) {
          return;
        }

        const options = getQuestionOptions(input);

        if (!options.length) {
          return;
        }

        const current =
          typeof state.activeQuestion === "number" ? state.activeQuestion : -1;

        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          event.stopImmediatePropagation();

          setActiveQuestion(
            input,
            event.key === "ArrowDown"
              ? (current + 1) % options.length
              : (current <= 0 ? options.length - 1 : current - 1)
          );
        } else if (event.key === "Enter" && current >= 0) {
          event.preventDefault();
          event.stopImmediatePropagation();

          selectQuestion(
            input,
            options[current].getAttribute("data-ai-search-question")
          );
        }
      },
      true
    );

    input.addEventListener("keyup", event => {
      // Some themes (Dawn family) close their dropdown on any key
      // release while the query is empty. Keep it open while the
      // questions are shown; once the shopper types, the query is
      // no longer empty and key events reach the theme as usual.
      if (state.mode === "questions" && questionsAllowedFor(input)) {
        event.stopPropagation();
      }
    });

    input.addEventListener("blur", () => {
      if (state.mode !== "questions") {
        return;
      }

      setTimeout(() => {
        if (state.mode === "questions" && document.activeElement !== input) {
          hideQuestionSuggestions(input, { close: true });
        }
      }, 150);
    });
  }


  function attachAllInputs() {

    findSearchInputs()
      .forEach(
        attachInput
      );
  }


  // =========================================================
  // FORM SUBMIT / ENTER
  // =========================================================


  /*
   * One AI search for Enter / the search button, the same on
   * every theme:
   *
   *  - It has its own request slot (like a selected question),
   *    so theme reactions to Enter (closing the drawer, input
   *    events, re-renders) can't silently drop it — that is what
   *    made some themes need a second Enter.
   *  - If the dropdown search already asked the AI for these
   *    exact words, that answer is reused instead of cancelled
   *    and asked again (faster, and no lost answer).
   *  - Pressing Enter again while it runs does not start a
   *    second search.
   *  - If the AI fails, the normal results page still opens with
   *    the shopper's words, so Enter always does something.
   */
  async function runAISubmit(input, form) {
    const query =
      String(
        input.value ||
        ""
      ).trim();

    if (!query) {
      return;
    }

    attachInput(
      input
    );

    const state =
      getState(input);

    if (
      state.submitLane &&
      !state.submitLane.cancelled &&
      state.submitLane.query === query
    ) {
      return;
    }

    if (state.submitLane) {
      state.submitLane.cancelled = true;
    }

    const lane = { request: 0, controller: null, query, cancelled: false };
    state.submitLane = lane;

    // Keep the dropdown's AI request for these words running.
    const running = inFlight.get(`${SEARCH_MODE}:${query.toLowerCase()}`);

    if (running && state.controller === running.controller) {
      state.controller = null;
    }

    if (state.mode === "questions") {
      hideQuestionSuggestions(input);
    }

    cancelState(
      state
    );

    state.query = query;

    // Visible feedback on every theme: the theme's dropdown if the
    // app knows it, otherwise a line under the theme's search box.
    const inDropdown = Boolean(getResultContainer(input));
    const showMessage = text => {
      if (state.questionPendingElement) {
        state.questionPendingElement.remove();
        state.questionPendingElement = null;
      }

      if (inDropdown) {
        showStatus(input, text, text === "Just a moment…" ? "loading" : "no-results");
      } else {
        showQuestionPending(input, { kind: "panel", container: null }, text);
      }
    };

    showMessage("Just a moment…");

    const cancel = () => {
      lane.cancelled = true;

      if (lane.controller) {
        lane.controller.abort();
      }

      if (state.questionPendingElement) {
        state.questionPendingElement.remove();
        state.questionPendingElement = null;
      }
    };

    const onKeydown = event => {
      if (event.key === "Escape") {
        cancel();
      }
    };

    const onInput = event => {
      const value =
        event.target === input ? String(input.value || "").trim() : "";

      if (value && value !== query) {
        cancel();
      }
    };

    document.addEventListener("keydown", onKeydown, true);
    document.addEventListener("input", onInput, true);

    let result = null;
    let failed = false;

    try {
      ({ result } = await requestAI(query, lane, SEARCH_MODE));
    } catch (error) {
      if (error?.name !== "AbortError") {
        failed = true;
        console.error(
          "[Askmerce] Submit error:",
          error
        );
      }
    } finally {
      document.removeEventListener("keydown", onKeydown, true);
      document.removeEventListener("input", onInput, true);
    }

    if (lane.cancelled || state.submitLane !== lane) {
      return;
    }

    state.submitLane = null;

    if (failed) {
      window.location.assign(searchResultsUrl(form, query));
      return;
    }

    const products =
      Array.isArray(
        result?.products
      )
        ? result.products
        : [];

    /*
     * No AI recommendation.
     *
     * Stay inside predictive search.
     */
    const aiQuery =
      products.length
        ? buildAIQuery(products, query)
        : "";

    if (!aiQuery) {
      showMessage(noResultsText(query));
      return;
    }

    /*
     * Save original query + AI query.
     * Full search page can restore the original
     * customer wording.
     */
    savePendingSearch(
      query,
      aiQuery
    );

    /*
     * Theme form parameters are kept; Shopify receives the
     * internal AI query.
     */
    window.location.assign(
      searchResultsUrl(form, aiQuery)
    );
  }

  document.addEventListener(
    "submit",

    event => {

      const form =
        event.target;

      if (
        !form ||
        form.tagName !==
          "FORM"
      ) {
        return;
      }

      const input =
        form.querySelector(
          [
            'input[type="search"]',
            'input[name="q"]',
            'input[name="query"]'
          ].join(",")
        );

      if (
        !input ||
        !isSearchInput(input)
      ) {
        return;
      }

      const query =
        String(
          input.value ||
          ""
        ).trim();

      if (!query) {
        return;
      }

      const method =
        String(
          form.getAttribute(
            "method"
          ) ||
          "get"
        ).toLowerCase();

      if (
        method !==
        "get"
      ) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      runAISubmit(input, form);
    },

    true
  );

  /*
   * Enter in the search box, handled before the theme's own key
   * handlers (document capture phase). Some themes navigate to
   * their normal search from their own Enter handler, or have no
   * real form submit, so the submit listener above never ran.
   * Left to the theme: a highlighted dropdown result (the theme
   * opens it), a highlighted merchant question (handled by the
   * questions), IME composition, and non-GET forms.
   */
  document.addEventListener(
    "keydown",
    event => {
      if (
        event.key !== "Enter" ||
        event.isComposing ||
        event.defaultPrevented ||
        event.shiftKey || event.ctrlKey || event.metaKey || event.altKey
      ) {
        return;
      }

      const input = event.target;

      if (!isSearchInput(input) || !String(input.value || "").trim()) {
        return;
      }

      const form = input.form;

      if (
        form &&
        String(form.getAttribute("method") || "get").toLowerCase() !== "get"
      ) {
        return;
      }

      const state = getState(input);

      if (state.mode === "questions" && state.activeQuestion >= 0) {
        return;
      }

      if (input.getAttribute("aria-activedescendant")) {
        return;
      }

      const container = getResultContainer(input);

      if (container && container.querySelector('[aria-selected="true"]')) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      runAISubmit(input, form);
    },
    true
  );


  // =========================================================
  // ESCAPE
  // =========================================================

  document.addEventListener(
    "keydown",

    event => {

      if (
        event.key !==
        "Escape"
      ) {

        return;
      }


      const input =
        document.activeElement;


      if (
        !isSearchInput(input)
      ) {

        return;
      }


      const state =
        getState(input);


      cancelState(
        state
      );


      state.mode =
        "idle";


      state.searchingQuery =
        "";


      clearResultArea(
        input
      );


      closeNativeShell(
        input
      );

    },

    true
  );


  // =========================================================
  // INITIALIZATION
  // =========================================================

  function init() {



    // Keep Shopify native predictive-search requests enabled.
    patchFetch();


    /*
     * Attach to inputs already present.
     */
    attachAllInputs();


    // Keep successful AI recommendations visible if the browser restores
    // the tab and the theme re-renders its predictive-search DOM.
    installResultPersistenceObserver();

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        restoreAllAIResults();
      }
    });

    window.addEventListener("pageshow", restoreAllAIResults);
    window.addEventListener("focus", restoreAllAIResults);


    /*
     * Restore original query on full search page.
     */
    restoreFullSearchPage();


    /*
     * Shopify can create search modals/drawers later,
     * so watch for newly-created search inputs.
     */
    const observer =
      new MutationObserver(
        () => {

          attachAllInputs();

        }
      );


    observer.observe(
      document.documentElement,
      {
        childList:
          true,

        subtree:
          true
      }
    );
  }


  if (
    document.readyState ===
    "loading"
  ) {

    document.addEventListener(
      "DOMContentLoaded",
      init,
      {
        once:
          true
      }
    );

  } else {

    init();
  }

})();