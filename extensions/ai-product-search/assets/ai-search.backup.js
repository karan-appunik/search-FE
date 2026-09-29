(function () {
    "use strict";

    const LOG_PREFIX =
        "[AI Product Search]";

    const CONFIG = {
        minSearchLength: 3,
        debounceDelay: 450,
        maxProducts: 8
    };


    // =========================================================
    // STATE
    // =========================================================

    const states =
        new WeakMap();

    let requestSequence = 0;


    // =========================================================
    // BASIC HELPERS
    // =========================================================

    function isElementVisible(
        element
    ) {

        if (!element) {
            return false;
        }


        const style =
            window.getComputedStyle(
                element
            );


        const rect =
            element.getBoundingClientRect();


        return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            rect.width > 0 &&
            rect.height > 0
        );

    }


    function isSearchInput(
        element
    ) {

        if (
            !element ||
            element.tagName !== "INPUT"
        ) {
            return false;
        }


        const type =
            (
                element.getAttribute(
                    "type"
                ) || ""
            )
                .toLowerCase();


        const name =
            (
                element.getAttribute(
                    "name"
                ) || ""
            )
                .toLowerCase();


        const placeholder =
            (
                element.getAttribute(
                    "placeholder"
                ) || ""
            )
                .toLowerCase();


        const ariaLabel =
            (
                element.getAttribute(
                    "aria-label"
                ) || ""
            )
                .toLowerCase();


        return (
            type === "search" ||
            name === "q" ||
            name === "query" ||
            placeholder.includes("search") ||
            ariaLabel.includes("search")
        );

    }


    function getState(
        input
    ) {

        let state =
            states.get(
                input
            );


        if (!state) {

            state = {
                timer: null,

                requestId: 0,

                query: "",

                aiActive: false,

                nativeMarkup: "",

                nativeContainer: null,

                observer: null,

                ignoreMutation: false,

                promise: null

            };


            states.set(
                input,
                state
            );

        }


        return state;

    }


    function escapeSearchValue(
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


    // =========================================================
    // SHOPIFY SHOP
    // =========================================================

    function getShop() {

        return (
            window.Shopify?.shop ||
            ""
        );

    }


    // =========================================================
    // SEARCH INPUT
    // =========================================================

    function findSearchInput() {

        const selectors = [
            'input[type="search"]',
            'input[name="q"]',
            'input[name="query"]',
            'input[placeholder*="search" i]',
            'input[aria-label*="search" i]'
        ];


        /*
         * Prefer the currently focused search input.
         */

        const active =
            document.activeElement;


        if (
            active &&
            isSearchInput(active)
        ) {

            return active;

        }


        /*
         * Prefer visible inputs.
         */

        for (
            const selector
            of selectors
        ) {

            try {

                const elements =
                    document.querySelectorAll(
                        selector
                    );


                for (
                    const element
                    of elements
                ) {

                    if (
                        isElementVisible(
                            element
                        )
                    ) {

                        return element;

                    }

                }

            } catch {
                // Ignore
            }

        }


        return null;

    }


    // =========================================================
    // NATIVE SEARCH CONTAINER
    // =========================================================

    function getSearchComponent(
        input
    ) {

        if (!input) {
            return null;
        }


        const selectors = [
            "predictive-search",
            "search-modal",
            "search-drawer",
            '[role="dialog"]'
        ];


        for (
            const selector
            of selectors
        ) {

            try {

                const element =
                    input.closest(
                        selector
                    );


                if (element) {

                    return element;

                }

            } catch {
                // Ignore
            }

        }


        return null;

    }


    function getNativeResultContainer(
        input
    ) {

        if (!input) {
            return null;
        }


        /*
         * -----------------------------------------------------
         * 1. aria-controls / aria-owns
         * -----------------------------------------------------
         */

        const ids = [

            input.getAttribute(
                "aria-controls"
            ),

            input.getAttribute(
                "aria-owns"
            )

        ]
            .filter(Boolean)
            .flatMap(
                function (value) {

                    return value
                        .split(/\s+/)
                        .filter(Boolean);

                }
            );


        for (
            const id
            of ids
        ) {

            const element =
                document.getElementById(
                    id
                );


            if (
                element &&
                element !== input
            ) {

                return element;

            }

        }


        /*
         * -----------------------------------------------------
         * 2. Native predictive-search component
         * -----------------------------------------------------
         */

        const component =
            getSearchComponent(
                input
            );


        if (component) {

            const selectors = [

                "#predictive-search",

                "[data-predictive-search]",

                "[role='listbox']",

                ".predictive-search",

                ".predictive-search__results",

                ".predictive-search-results"

            ];


            for (
                const selector
                of selectors
            ) {

                try {

                    const element =
                        component.querySelector(
                            selector
                        );


                    if (
                        element &&
                        element !== input
                    ) {

                        return element;

                    }

                } catch {
                    // Ignore
                }

            }

        }


        /*
         * -----------------------------------------------------
         * 3. Search form fallback
         * -----------------------------------------------------
         */

        const form =
            input.closest(
                "form"
            );


        if (form) {

            const selectors = [

                "[data-predictive-search]",

                "[role='listbox']",

                ".predictive-search",

                ".predictive-search__results",

                ".predictive-search-results"

            ];


            for (
                const selector
                of selectors
            ) {

                try {

                    const element =
                        form.querySelector(
                            selector
                        );


                    if (element) {

                        return element;

                    }

                } catch {
                    // Ignore
                }

            }

        }


        return null;

    }


    // =========================================================
    // SECTION ID
    // =========================================================

    function getSectionId(
        input,
        resultContainer
    ) {

        const candidates = [];


        const component =
            getSearchComponent(
                input
            );


        if (component) {

            candidates.push(
                component
            );

        }


        if (
            resultContainer
        ) {

            candidates.push(
                resultContainer
            );

        }


        const parents = [
            component?.parentElement,
            resultContainer?.parentElement,
            input?.closest(
                "[data-section-id]"
            )
        ];


        candidates.push(
            ...parents
        );


        for (
            const element
            of candidates
        ) {

            if (!element) {
                continue;
            }


            const value =
                element.getAttribute(
                    "data-section-id"
                );


            if (
                value &&
                value.trim()
            ) {

                return value.trim();

            }

        }


        /*
         * If the result container itself has a useful ID.
         */

        if (
            resultContainer?.id
        ) {

            const id =
                resultContainer.id;


            if (
                id !==
                "predictive-search-results" &&
                id !==
                "predictive-search"
            ) {

                return id;

            }

        }


        /*
         * Shopify's common predictive-search
         * section ID.
         */

        return "predictive-search";

    }


    // =========================================================
    // BUILD NATIVE SHOPIFY QUERY
    // =========================================================

    function buildNativeQuery(
        products,
        originalQuery
    ) {

        if (
            !Array.isArray(
                products
            ) ||
            products.length === 0
        ) {

            return String(
                originalQuery || ""
            ).trim();

        }


        /*
         * The AI has already selected the actual products.
         *
         * We don't create custom cards.
         *
         * Instead, we ask Shopify native search to find
         * those product titles.
         *
         * Example:
         *
         * AI selects:
         *   Black Party Dress
         *   Black Midi Dress
         *
         * Native query becomes:
         *
         * title:"Black Party Dress"
         * OR
         * title:"Black Midi Dress"
         */

        const clauses =
            products
                .slice(
                    0,
                    CONFIG.maxProducts
                )
                .map(
                    function (product) {

                        const title =
                            String(
                                product?.title ||
                                ""
                            ).trim();


                        if (!title) {
                            return "";
                        }


                        return (
                            'title:"' +
                            escapeSearchValue(
                                title
                            ) +
                            '"'
                        );

                    }
                )
                .filter(Boolean);


        if (
            clauses.length === 0
        ) {

            return String(
                originalQuery || ""
            ).trim();

        }


        return clauses.length === 1
            ? clauses[0]
            : clauses.join(
                " OR "
            );

    }


    // =========================================================
    // NATIVE PREDICTIVE SEARCH HTML
    // =========================================================

    async function fetchNativeSearchMarkup(
        query,
        sectionIds
    ) {

        const root =
            window.Shopify?.routes?.root ||
            "/";


        const tried =
            new Set();


        for (
            const sectionId
            of sectionIds
        ) {

            if (
                !sectionId ||
                tried.has(
                    sectionId
                )
            ) {

                continue;

            }


            tried.add(
                sectionId
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
                    CONFIG.maxProducts
                )
            );


            params.set(
                "resources[options][unavailable_products]",
                "hide"
            );


            const url =
                root.replace(
                    /\/?$/,
                    "/"
                ) +
                "search/suggest?" +
                params.toString();


            console.log(
                `${LOG_PREFIX} Native Shopify query:`,
                query
            );


            const response =
                await fetch(
                    url,
                    {
                        method:
                            "GET",

                        headers: {
                            Accept:
                                "text/html"
                        },

                        credentials:
                            "same-origin"
                    }
                );


            if (
                !response.ok
            ) {

                console.warn(
                    `${LOG_PREFIX} Native search section failed:`,
                    sectionId,
                    response.status
                );


                continue;

            }


            const text =
                await response.text();


            const documentFragment =
                new DOMParser()
                    .parseFromString(
                        text,
                        "text/html"
                    );


            /*
             * Shopify renders the requested section
             * with this wrapper.
             */

            const sectionWrapper =
                documentFragment.getElementById(
                    `shopify-section-${sectionId}`
                );


            if (
                sectionWrapper
            ) {

                return {
                    markup:
                        sectionWrapper.innerHTML,

                    sectionId

                };

            }


            /*
             * Some themes may return the predictive
             * result container without the wrapper.
             */

            const fallbackSelectors = [

                "#predictive-search",

                "#predictive-search-results",

                "[data-predictive-search]",

                "[role='listbox']",

                ".predictive-search__results",

                ".predictive-search-results"

            ];


            for (
                const selector
                of fallbackSelectors
            ) {

                try {

                    const element =
                        documentFragment.querySelector(
                            selector
                        );


                    if (element) {

                        return {
                            markup:
                                element.innerHTML,

                            sectionId

                        };

                    }

                } catch {
                    // Ignore
                }

            }

        }


        throw new Error(
            "Unable to render native Shopify search section"
        );

    }


    // =========================================================
    // NATIVE RESULT WATCHER
    // =========================================================

    function watchNativeContainer(
        input,
        container
    ) {

        if (
            !input ||
            !container
        ) {

            return;

        }


        const state =
            getState(
                input
            );


        if (
            state.observer &&
            state.nativeContainer ===
            container
        ) {

            return;

        }


        if (
            state.observer
        ) {

            state.observer.disconnect();

            state.observer =
                null;

        }


        state.nativeContainer =
            container;


        state.observer =
            new MutationObserver(
                function () {

                    /*
                     * Ignore the mutation caused by
                     * our own native markup replacement.
                     */

                    if (
                        state.ignoreMutation
                    ) {

                        state.ignoreMutation =
                            false;

                        return;

                    }


                    /*
                     * Only protect the result while
                     * the AI query is the active query.
                     */

                    if (
                        !state.aiActive
                    ) {

                        return;

                    }


                    if (
                        !state.nativeMarkup
                    ) {

                        return;

                    }


                    /*
                     * The Shopify theme may re-render its
                     * original search results after our
                     * results have been inserted.
                     *
                     * Reapply the cached native Shopify
                     * markup.
                     */

                    if (
                        container.innerHTML !==
                        state.nativeMarkup
                    ) {

                        console.log(
                            `${LOG_PREFIX} Restoring AI-selected native results`
                        );


                        state.ignoreMutation =
                            true;


                        container.innerHTML =
                            state.nativeMarkup;

                    }

                }
            );


        state.observer.observe(
            container,
            {
                childList:
                    true,

                subtree:
                    true
            }
        );

    }


    // =========================================================
    // APPLY NATIVE RESULTS
    // =========================================================

    function applyNativeMarkup(
        input,
        markup
    ) {

        const container =
            getNativeResultContainer(
                input
            );


        if (
            !container
        ) {

            console.warn(
                `${LOG_PREFIX} Native result container not found`
            );


            return false;

        }


        const state =
            getState(
                input
            );


        /*
         * Store the exact theme-rendered markup.
         */

        state.nativeMarkup =
            markup;


        state.nativeContainer =
            container;


        watchNativeContainer(
            input,
            container
        );


        /*
         * Replace ONLY the contents.
         *
         * The element itself, its position,
         * theme classes and theme JS remain intact.
         */

        state.ignoreMutation =
            true;


        container.innerHTML =
            markup;


        /*
         * Make sure the native container remains
         * visible/open when the theme had it open.
         */

        container.removeAttribute(
            "hidden"
        );


        container.setAttribute(
            "aria-hidden",
            "false"
        );


        return true;

    }


    // =========================================================
    // AI REQUEST
    // =========================================================

    async function requestAI(
        query,
        input
    ) {

        const state =
            getState(
                input
            );


        const currentRequestId =
            ++requestSequence;


        state.requestId =
            currentRequestId;


        /*
         * Reuse an in-flight request for the
         * exact same query.
         */

        if (
            state.promise &&
            state.query === query
        ) {

            return state.promise;

        }

        state.query =
            query;


        state.promise =
            (async function () {

                console.log(
                    `${LOG_PREFIX} AI search:`,
                    query
                );


                const url =
                    "/apps/ai-search/search" +
                    "?q=" +
                    encodeURIComponent(query);


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
                                "same-origin"
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


                if (
                    currentRequestId !==
                    requestSequence
                ) {

                    return null;

                }


                return result;

            })();


        try {

            return await state.promise;

        } finally {

            if (
                state.promise
            ) {

                state.promise =
                    null;

            }

        }

    }


    // =========================================================
    // RUN AI PREDICTIVE SEARCH
    // =========================================================

    async function runAISearch(
        query,
        input
    ) {

        const state =
            getState(
                input
            );


        const requestId =
            ++requestSequence;


        state.requestId =
            requestId;


        try {

            const result =
                await requestAI(
                    query,
                    input
                );


            if (
                requestId !==
                state.requestId
            ) {

                return;

            }


            if (
                requestId !==
                requestSequence
            ) {

                return;

            }


            const products =
                Array.isArray(
                    result?.products
                )
                    ? result.products
                    : [];


            /*
             * No AI products:
             *
             * Keep Shopify's own search results.
             */

            if (
                products.length === 0
            ) {

                state.aiActive =
                    false;


                state.nativeMarkup =
                    "";


                return;

            }


            /*
             * Turn AI-selected products into
             * a native Shopify search query.
             */

            const nativeQuery =
                buildNativeQuery(
                    products,
                    query
                );


            if (
                !nativeQuery
            ) {

                return;

            }


            const container =
                getNativeResultContainer(
                    input
                );


            const detectedSectionId =
                getSectionId(
                    input,
                    container
                );


            /*
             * First use the detected section.
             *
             * Then use Shopify's standard
             * predictive-search section ID.
             */

            const sectionIds = [

                detectedSectionId,

                "predictive-search"

            ];


            const nativeResponse =
                await fetchNativeSearchMarkup(
                    nativeQuery,
                    sectionIds
                );


            if (
                requestId !==
                state.requestId ||
                requestId !==
                requestSequence
            ) {

                return;

            }


            const applied =
                applyNativeMarkup(
                    input,
                    nativeResponse.markup
                );


            if (
                !applied
            ) {

                /*
                 * Do not create any custom UI.
                 *
                 * If we can't safely use the theme's
                 * native container, simply leave the
                 * native search alone.
                 */

                state.aiActive =
                    false;

                state.nativeMarkup =
                    "";

                return;

            }


            state.aiActive =
                true;


            console.log(
                `${LOG_PREFIX} Native Shopify UI updated with AI-selected products`
            );

        } catch (error) {

            if (
                requestId !==
                state.requestId
            ) {

                return;

            }


            console.error(
                `${LOG_PREFIX} AI search error:`,
                error
            );


            /*
             * IMPORTANT:
             *
             * Never break Shopify's native search.
             *
             * On failure, simply let the theme
             * continue normally.
             */

            state.aiActive =
                false;

            state.nativeMarkup =
                "";

        }

    }


    // =========================================================
    // DEBOUNCE
    // =========================================================

    function scheduleAISearch(
        query,
        input
    ) {

        const state =
            getState(
                input
            );


        clearTimeout(
            state.timer
        );


        if (
            query.length <
            CONFIG.minSearchLength
        ) {

            ++requestSequence;


            state.aiActive =
                false;


            state.nativeMarkup =
                "";


            return;

        }


        state.timer =
            setTimeout(
                function () {

                    runAISearch(
                        query,
                        input
                    );

                },
                CONFIG.debounceDelay
            );

    }


    // =========================================================
    // INPUT EVENT
    // =========================================================

    document.addEventListener(
        "input",
        function (event) {

            const input =
                event.target;


            if (
                !isSearchInput(
                    input
                )
            ) {

                return;

            }


            const query =
                String(
                    input.value ||
                    ""
                )
                    .trim();


            console.log(
                `${LOG_PREFIX} Query:`,
                query
            );


            const state =
                getState(
                    input
                );


            /*
             * Query changed.
             *
             * Let Shopify handle the native UI normally
             * until the new AI result is ready.
             */

            state.aiActive =
                false;


            state.nativeMarkup =
                "";


            state.query =
                query;


            scheduleAISearch(
                query,
                input
            );

        },
        true
    );


    // =========================================================
    // FORM SUBMIT
    // =========================================================

    document.addEventListener(
        "submit",
        async function (event) {

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
                !input
            ) {

                return;

            }


            const query =
                String(
                    input.value ||
                    ""
                )
                    .trim();


            if (
                query.length <
                CONFIG.minSearchLength
            ) {

                return;

            }


            /*
             * Only intercept GET search forms.
             */

            const method =
                (
                    form.getAttribute(
                        "method"
                    ) || "get"
                )
                    .toLowerCase();


            if (
                method !==
                "get"
            ) {

                return;

            }


            /*
             * Take control of the full search,
             * but still use Shopify's own search page.
             */

            event.preventDefault();

            event.stopPropagation();


            if (
                typeof event.stopImmediatePropagation ===
                "function"
            ) {

                event.stopImmediatePropagation();

            }


            try {

                const result =
                    await requestAI(
                        query,
                        input
                    );


                const products =
                    Array.isArray(
                        result?.products
                    )
                        ? result.products
                        : [];


                const nativeQuery =
                    buildNativeQuery(
                        products,
                        query
                    );


                /*
                 * Preserve the theme's own form
                 * parameters, such as:
                 *
                 * options[prefix]
                 */

                const formData =
                    new FormData(
                        form
                    );


                const action =
                    form.getAttribute(
                        "action"
                    ) ||
                    (
                        window.Shopify?.routes
                            ?.search_url ||
                        "/search"
                    );


                const target =
                    new URL(
                        action,
                        window.location.origin
                    );


                /*
                 * Remove existing query parameters
                 * because FormData will provide them.
                 */

                target.search =
                    "";


                for (
                    const [
                        key,
                        value
                    ]
                    of formData.entries()
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


                target.searchParams.set(
                    "q",
                    nativeQuery ||
                    query
                );


                window.location.assign(
                    target.toString()
                );

            } catch (
            error
            ) {

                /*
                 * If AI fails, use normal Shopify
                 * form submission.
                 */

                console.error(
                    `${LOG_PREFIX} Submit AI error:`,
                    error
                );


                form.submit();

            }

        },
        true
    );


    // =========================================================
    // ESCAPE
    // =========================================================

    document.addEventListener(
        "keydown",
        function (event) {

            if (
                event.key !==
                "Escape"
            ) {

                return;

            }


            ++requestSequence;


            const input =
                findSearchInput();


            if (
                input
            ) {

                const state =
                    getState(
                        input
                    );


                clearTimeout(
                    state.timer
                );


                state.aiActive =
                    false;


                state.nativeMarkup =
                    "";


                if (
                    state.observer
                ) {

                    state.observer.disconnect();

                    state.observer =
                        null;

                }


                state.nativeContainer =
                    null;

            }

        },
        true
    );


    // =========================================================
    // INITIALIZATION
    // =========================================================

    function init() {

        console.log(
            `${LOG_PREFIX} Native-only AI search loaded`
        );


        const input =
            findSearchInput();


        if (
            input
        ) {

            console.log(
                `${LOG_PREFIX} Native Shopify search detected`,
                input
            );

        }


        /*
         * Deliberately:
         *
         * - no custom container
         * - no Shadow DOM
         * - no custom CSS
         * - no fallback button
         * - no fallback modal
         */

    }


    if (
        document.readyState ===
        "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            init
        );

    } else {

        init();

    }

})();