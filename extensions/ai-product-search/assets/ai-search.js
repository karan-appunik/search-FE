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
    console.log(
      "[AI Product Search] Existing runtime detected; skipping duplicate initialization.",
      typeof existingRuntime === "object"
        ? (existingRuntime.runtimeId || "unknown")
        : "legacy-runtime"
    );
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
  // an AI call.
  aiPause: 400,
  maxResults: 6,
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
console.log("[AI SEARCH DEBUG] calling requestAI", query);
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


      console.log(
        "[AI Product Search] Using cached AI result:",
        cacheKey
      );


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
      console.log(
        "[AI Product Search] DEDUP: exact request already in flight:",
        cacheKey
      );

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


      console.log(
        "[AI Product Search] Reused in-flight AI result:",
        cacheKey
      );


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
      "/apps/ai-search/search?q=" +
      encodeURIComponent(query) +
      "&mode=" +
      encodeURIComponent(mode);


    const promise =
      (async () => {

        const started =
          performance.now();


        console.log(
          "[AI Product Search] Sending AI request:",
          { query, mode, requestId: id, runtimeId: runtime.runtimeId }
        );


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


        console.log(
          `[AI Product Search] AI response: ${Math.round(
            performance.now() -
            started
          )}ms`
        );


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

  async function fetchNativeMarkup(
    query,
    input,
    signal
  ) {

    const markupStartedAt = performance.now();

console.log(
  "[AI Product Search] Shopify markup START:",
  query
);

    const container =
      getResultContainer(
        input
      );


    const sectionId =
      "predictive-search";


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
      "section_id",
      sectionId
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


    const response =
      await fetch(
        `${root}search/suggest?${params.toString()}`,
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


    if (
      !response.ok
    ) {

      throw new Error(
        `Native Shopify search failed: ${response.status}`
      );
    }


    const html =
      await response.text();

      console.log(
  `[AI Product Search] Shopify markup response: ${
    Math.round(performance.now() - markupStartedAt)
  }ms`
);


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
        "[AI Product Search] Could not remove native search action",
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

        const container = getResultContainer(input);

        if (!container) {
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
    shouldRender = null
  ) {
    if (!Array.isArray(products) || !products.length) {
      input.removeAttribute("aria-busy");
      return false;
    }

    const currentQuery = String(input.value || "").trim();

    if (
      requestId !== state.request ||
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
      state.controller?.signal
    );

    if (
      requestId !== state.request ||
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
        "[AI Product Search] Native predictive container unavailable"
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
          "[AI Product Search] Could not reorder native results; showing native order",
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

    console.log(
      "[AI Product Search] Native recommendations rendered:",
      products.length,
      "for:",
      query
    );

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
        console.log(
          "[AI Product Search] SKIP duplicate query lifecycle:",
          cleanQuery
        );
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

    // 1. Instant JEV results (shown only until the AI answers).
    const instantPromise = requestAI(cleanQuery, instantLane, INSTANT_MODE)
      .then(async ({ result: instant }) => {
        const instantProducts = productsOf(instant);

        if (!instant || aiFinished || !stillCurrent() || !instantProducts.length) {
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

    if (!products.length) {
      // Keep instant results rather than replacing them with
      // nothing.
      if (instantShown) {
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

    await renderAIResults(
      input,
      cleanQuery,
      products,
      state,
      id,
      result.resultType,
      result.message
    );

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
      state.mode = "idle";
      state.aiQuery = "";
      state.searchingQuery = "";
      state.lastStartedQuery = "";
      input.removeAttribute("aria-busy");
      return;
    }

    // Suppress native suggestions immediately. The result area shows only
    // the AI loading message until AI returns.
    showStatus(input, "Looking for best result...", "loading");

    state.timer = setTimeout(() => {
      state.timer = null;

      runPredictiveSearch(input, cleanQuery).catch(error => {
        if (error?.name === "AbortError") return;

        if (String(input.value || "").trim() === cleanQuery) {
          state.mode = "idle";
          input.removeAttribute("aria-busy");
        }

        console.error(
          "[AI Product Search] Predictive search error:",
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
  }


  // =========================================================
  // INPUT EVENT INTERCEPTION
  // =========================================================

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
          return;
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

          showStatus(input, "Looking for best result...", "loading");
          return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();

        scheduleSearch(input, query);
      },
      true
    );
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

  document.addEventListener(
    "submit",

    async event => {

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


      attachInput(
        input
      );


      const state =
        getState(input);


      if (
        state.timer
      ) {

        clearTimeout(
          state.timer
        );


        state.timer =
          null;
      }


      cancelState(
        state
      );


      showStatus(
        input,
        "Searching with AI...",
        "loading"
      );


      try {

        const {
          result
        } =
          await requestAI(
            query,
            state,
            SEARCH_MODE
          );


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
        if (
          !products.length
        ) {

          showStatus(
            input,

            noResultsText(query),

            "no-results"
          );


          return;
        }


        const aiQuery =
          buildAIQuery(
            products,
            query
          );


        if (!aiQuery) {

          showStatus(
            input,

            noResultsText(query),

            "no-results"
          );


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


        const action =
          form.getAttribute(
            "action"
          ) ||
          window.Shopify
            ?.routes
            ?.search_url ||
          "/search";


        const target =
          new URL(
            action,
            window.location.origin
          );


        /*
         * Preserve theme form parameters.
         */
        for (
          const [
            key,
            value
          ]
          of new FormData(
            form
          ).entries()
        ) {

          if (
            key ===
            "q"
          ) {

            continue;
          }


          if (
            typeof value ===
            "string"
          ) {

            target.searchParams.append(
              key,
              value
            );
          }
        }


        /*
         * Shopify receives the internal AI query.
         */
        target.searchParams.set(
          "q",
          aiQuery
        );


        window.location.assign(
          target.toString()
        );

      } catch (
        error
      ) {

        if (
          error?.name !==
          "AbortError"
        ) {

          console.error(
            "[AI Product Search] Submit error:",
            error
          );
        }
      }

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

    console.log(
      "[AI Product Search] AI-owned predictive search loaded"
    );


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