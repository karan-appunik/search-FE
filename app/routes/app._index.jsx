import { Link, useFetcher, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import { backendInternalFetch } from "../utils/backend.server";
import askmerceIcon from "../assets/askmerce-icon.png";
import {
  Banner,
  Button,
  Icon,
  Page
} from "../components/ui";

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
// "Open theme editor" button deep-links there with the
// embed pre-selected (Shopify's activateAppId link).
// =========================================================

// File name of the app embed block in
// extensions/ai-product-search/blocks/ (without .liquid).
const APP_EMBED_HANDLE = "ai-search-embed";

// App name. The theme editor lists the app embed by this name too
// (the block "name" in ai-search-embed.liquid), so step 2 says it.
const APP_NAME = "Askmerce";

// Read-only: the saved Search questions setting (same app-data
// metafield app.search-questions.jsx reads and writes).
const SEARCH_QUESTIONS_QUERY = `#graphql
  query DashboardSearchQuestions {
    currentAppInstallation {
      searchQuestions: metafield(namespace: "ai_search", key: "search_questions") {
        jsonValue
      }
    }
  }
`;

// Same minimum app.search-questions.jsx requires to show them.
const MIN_SEARCH_QUESTIONS = 5;

/*
 * True when Search questions are saved and turned on (shown on
 * the store). Display only; any error just means "not active".
 */
async function readSearchQuestionsActive(admin) {
  try {
    const response = await admin.graphql(SEARCH_QUESTIONS_QUERY);
    const { data } = await response.json();
    const value = data?.currentAppInstallation?.searchQuestions?.jsonValue;
    const questions = Array.isArray(value?.questions)
      ? value.questions.filter((question) => String(question || "").trim())
      : [];

    return value?.enabled === true && questions.length >= MIN_SEARCH_QUESTIONS;
  } catch (error) {
    // Shopify auth responses (re-auth) must reach the browser as-is.
    if (error instanceof Response) {
      throw error;
    }

    return false;
  }
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const [result, searchQuestionsActive] = await Promise.all([
    backendInternalFetch("/api/internal/status", {
      searchParams: { shop: session.shop },
      signal: request.signal
    }),
    readSearchQuestionsActive(admin)
  ]);

  const themeEditorUrl =
    `https://${session.shop}/admin/themes/current/editor` +
    // eslint-disable-next-line no-undef
    `?context=apps&activateAppId=${process.env.SHOPIFY_API_KEY}/${APP_EMBED_HANDLE}`;

  return {
    shop: session.shop,
    themeEditorUrl,
    searchQuestionsActive,
    status: result.ok ? result.data?.data?.shop : null,
    statusError: result.ok ? null : result.data?.message || "Unable to load status"
  };
};

function formatDate(value) {
  if (!value) {
    return "Never";
  }

  try {
    return new Date(value).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  } catch {
    return "Unknown";
  }
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// Each part of the app has its own soft, neutral tone
// (sage, slate, teal, mauve), used for its icon and numbers.
const TOOLS = [
  {
    to: "/app/goal-products",
    icon: "target",
    tone: "teal",
    title: "Goals & rules",
    text: "Boost, push down or hide chosen products in search results."
  },
  {
    to: "/app/search-questions",
    icon: "chat",
    tone: "mauve",
    title: "Search questions",
    text: "Suggest 5–7 questions when shoppers open your search bar."
  }
  // Search preview is hidden for now.
];

const HOW_IT_WORKS = [
  {
    tone: "slate",
    title: "A shopper searches",
    text: "In your store's search bar, in their own words — even with typos."
  },
  {
    tone: "mauve",
    title: "Askmerce finds the best matches",
    text: "It understands what they mean and compares it with your catalog."
  },
  {
    tone: "sage",
    title: "Matching products appear",
    text: "In your theme's own search dropdown and results page."
  }
];

const FAQ = [
  {
    q: "Do I need to edit my theme code?",
    a: "No. The app runs inside your theme's existing search bar through an app embed. You can switch it off anytime in the theme editor."
  },
  {
    q: "What will shoppers see?",
    a: "Your theme's own search dropdown and results page, filled with the products the AI picks. No new search bar or pop-up."
  },
  {
    q: "Which products can be found?",
    a: "Active products on your online store. Draft and archived products are left out."
  },
  {
    q: "Do product changes update automatically?",
    a: "Yes. New and edited products sync on their own. Use Sync products anytime to refresh your whole catalog."
  }
];

export default function Index() {
  const { shop, status, statusError, themeEditorUrl, searchQuestionsActive } = useLoaderData();
  const fetcher = useFetcher();

  const isSyncing = fetcher.state !== "idle";
  const result = fetcher.data;

  // Products count a product once; variants count each variant.
  // A product is in stock when at least one variant is.
  const variantsTotal =
    status?.products?.variants?.total ?? status?.products?.total ?? 0;

  const productsTotal = status?.products?.total ?? 0;
  const inStock = status?.products?.available ?? 0;
  const outOfStock = status?.products?.unavailable ?? 0;
  const stockShare =
    inStock + outOfStock > 0 ? Math.round((inStock / (inStock + outOfStock)) * 100) : 0;

  const isSynced = productsTotal > 0;

  const ruleType = status?.goal?.ruleType || "";
  const ruleLabel = ruleType ? ruleType.charAt(0).toUpperCase() + ruleType.slice(1) : "";

  const syncProducts = () => {
    fetcher.submit({}, { method: "POST", action: "/api/products/sync" });
  };

  // Icon tiles are solid logo lime (tone "sage", see admin-ui.css).
  const metrics = status
    ? [
        {
          tone: "sage",
          icon: "box",
          label: "Searchable products",
          value: productsTotal,
          foot: plural(variantsTotal, "variant")
        },
        {
          tone: "sage",
          icon: "store",
          label: "In stock",
          value: `${stockShare}%`,
          foot: `${outOfStock} out of stock`
        },
        {
          tone: "sage",
          icon: "target",
          label: "Active rule",
          value: status.goal ? status.goal.name : "None",
          title: status.goal?.name || undefined,
          foot: status.goal
            ? `${ruleLabel ? `${ruleLabel} · ` : ""}${plural(status.goal.selectedProductCount, "product")}`
            : "Optional"
        },
        {
          tone: "sage",
          icon: "clock",
          label: "Last synced",
          value: formatDate(status.lastSyncedAt),
          foot: status.lastSyncedAt ? "Updates automatically" : "Run your first sync"
        }
      ]
    : [];

  return (
    <Page>
      {/* ---------- Header ---------- */}
      <header className="dash-hero">
        <div className="dash-hero__brand">
          <img className="dash-hero__logo" src={askmerceIcon} alt="" width="44" height="44" />
          <div className="dash-hero__text">
            <h1 className="dash-hero__title">{APP_NAME}</h1>
            <p className="dash-hero__sub">
              Askmerce lets shoppers search your store in their own words and find the right
              products.
            </p>
          </div>
        </div>

        <div className="dash-hero__side">
          {status && !isSynced && (
            <span className="dash-hero__note">Not synced yet</span>
          )}
          <Button variant="secondary" size="sm" icon="sync" loading={isSyncing} onClick={syncProducts}>
            {isSyncing ? "Syncing…" : "Sync products"}
          </Button>
        </div>
      </header>

      {result?.success && (
        <Banner tone="success">
          <p>
            <strong>Sync complete.</strong> {result.productsSynced} of{" "}
            {result.shopifyProducts} products are searchable ({result.variantsSynced} incl.
            variants).
            {result.notActiveProducts > 0 &&
              ` ${plural(result.notActiveProducts, "draft or archived product")} skipped.`}
            {result.productsRemoved > 0 &&
              ` ${plural(result.productsRemoved, "inactive product")} removed.`}
            {result.skipped > 0 && ` ${plural(result.skipped, "variant")} skipped.`}
          </p>
        </Banner>
      )}

      {result?.success === false && (
        <Banner tone="critical">{result.message || "Product sync failed"}</Banner>
      )}

      {statusError && <Banner tone="critical">{statusError}</Banner>}

      {/* ---------- Set up ---------- */}
      <section className="dash-card" aria-labelledby="dash-setup">
        <div className="dash-card__head">
          <h2 id="dash-setup" className="dash-card__title">Set up</h2>
          <span className="dash-card__meta">About 2 minutes</span>
        </div>

        <ol className="dash-setup">
          <li className="dash-setup__step">
            <span className="dash-num dash-tone--sage" aria-hidden="true">1</span>
            <div className="dash-setup__body">
              <h3 className="dash-setup__title">Sync products</h3>
              <p className="dash-setup__text">
                Lets the <strong>{APP_NAME}</strong> learn your catalog. Read-only, nothing in your store changes.
              </p>
              <div className="dash-setup__action">
                <Button variant="secondary" size="sm" loading={isSyncing} onClick={syncProducts}>
                  {isSyncing ? "Syncing…" : "Sync now"}
                </Button>
              </div>
            </div>
          </li>

          <li className="dash-setup__step">
            <span className="dash-num dash-tone--sage" aria-hidden="true">2</span>
            <div className="dash-setup__body">
              <h3 className="dash-setup__title">Turn it on in your theme</h3>
              <p className="dash-setup__text">
                Switch on <strong>{APP_NAME}</strong> in App embeds, then{" "}
                <strong>Save</strong>.
              </p>
              <div className="dash-setup__action">
                <Button variant="secondary" size="sm" href={themeEditorUrl} target="_top">
                  Open theme editor
                </Button>
              </div>
            </div>
          </li>

          <li className="dash-setup__step">
            <span className="dash-num dash-tone--sage" aria-hidden="true">3</span>
            <div className="dash-setup__body">
              <h3 className="dash-setup__title">Try a search</h3>
              <p className="dash-setup__text">Search your store like a shopper would.</p>
              <div className="dash-setup__action">
                {shop && (
                  <a
                    href={`https://${shop}`}
                    target="_blank"
                    rel="noreferrer"
                    className="ui-btn ui-btn--secondary ui-btn--sm"
                  >
                    Open store
                  </a>
                )}
              </div>
            </div>
          </li>
        </ol>
      </section>

      {/* ---------- Catalog + tools ---------- */}
      <div className="dash-split">
        {status && (
          <section className="dash-card" aria-labelledby="dash-catalog">
            <div className="dash-card__head">
              <h2 id="dash-catalog" className="dash-card__title">Your catalog</h2>
            </div>

            <div className="dash-metrics">
              {metrics.map((metric) => (
                <div className="dash-metric" key={metric.label}>
                  <span className="dash-metric__head">
                    <span className={`dash-icon dash-icon--sm dash-tone--${metric.tone}`} aria-hidden="true">
                      <Icon name={metric.icon} size={12} />
                    </span>
                    <span className="dash-metric__label">{metric.label}</span>
                  </span>
                  <span
                    className={`dash-metric__value dash-text--${metric.tone}`}
                    title={metric.title}
                  >
                    {metric.value}
                  </span>
                  <span className="dash-metric__foot">{metric.foot}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="dash-card" aria-labelledby="dash-tools">
          <div className="dash-card__head">
            <h2 id="dash-tools" className="dash-card__title">Customize search</h2>
            <span className="dash-card__meta">Optional</span>
          </div>

          <div className="dash-tools">
            {TOOLS.map((tool) => (
              <Link key={tool.to} to={tool.to} className="dash-tool">
                <span className={`dash-icon dash-icon--lg dash-tone--${tool.tone}`} aria-hidden="true">
                  <Icon name={tool.icon} size={16} />
                </span>
                <span className="dash-tool__body">
                  <span className="dash-tool__title">
                    {tool.title}
                    {((tool.to === "/app/goal-products" && status?.goal) ||
                      (tool.to === "/app/search-questions" && searchQuestionsActive)) && (
                      <span className="dash-done">Active</span>
                    )}
                  </span>
                  <span className="dash-tool__text">{tool.text}</span>
                </span>
                <span className="dash-tool__go" aria-hidden="true">
                  <Icon name="arrowRight" size={14} />
                </span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      {/* ---------- How it works ---------- */}
      <section className="dash-card" aria-labelledby="dash-how">
        <div className="dash-card__head">
          <h2 id="dash-how" className="dash-card__title">How it works</h2>
        </div>

        <ol className="dash-how">
          {HOW_IT_WORKS.map((step, index) => (
            <li className="dash-how__item" key={step.title}>
              <span className={`dash-num dash-tone--${step.tone}`} aria-hidden="true">
                {index + 1}
              </span>
              <div>
                <h3 className="dash-how__title">{step.title}</h3>
                <p className="dash-how__text">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------- Good to know ---------- */}
      <section className="dash-card" aria-labelledby="dash-faq">
        <div className="dash-card__head">
          <h2 id="dash-faq" className="dash-card__title">Good to know</h2>
        </div>

        <div className="dash-faq">
          {FAQ.map((item) => (
            <details className="dash-faq__item" key={item.q}>
              <summary>
                {item.q}
                <span className="dash-faq__icon" aria-hidden="true">
                  <Icon name="plus" size={13} />
                </span>
              </summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>
    </Page>
  );
}
