import { useEffect } from "react";
import { redirect, useNavigate } from "react-router";
import styles from "./styles.module.css";

// Public landing page. Installation must start from a
// Shopify-owned surface (App Store requirement 2.3.1), so there
// is no "enter your shop domain" form here; merchants install
// and open the app from Shopify.
// Any sign the request comes from the Shopify admin: open the
// app (the dashboard) straight away.
const ADMIN_PARAMS = ["shop", "host", "embedded", "id_token", "hmac"];

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (ADMIN_PARAMS.some((name) => url.searchParams.has(name))) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

// Shown inside the Shopify admin only for a moment if the admin
// loaded this address without its usual parameters: it goes on
// to the dashboard. Outside Shopify (e.g. someone opening the
// app's address directly) the public description below shows.
function useOpenDashboardWhenEmbedded() {
  const navigate = useNavigate();

  useEffect(() => {
    let embedded = false;

    try {
      embedded = window.top !== window.self;
    } catch {
      embedded = true;
    }

    if (!embedded) {
      return;
    }

    if (window.location.search) {
      window.location.replace(`/app${window.location.search}`);
    } else {
      // Reached from inside the app (e.g. a link to "/"): stay in
      // the app so its Shopify session is kept.
      navigate("/app", { replace: true });
    }
  }, [navigate]);
}

export default function App() {
  useOpenDashboardWhenEmbedded();

  return (
    <div className={styles.index}>
      {/* Runs before the page paints, so inside the admin the
          description never flashes before the dashboard opens. */}
      <script
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html:
            "(function(){var s=window.location.search;if(!s)return;var e=true;try{e=window.top!==window.self;}catch(x){}if(e){document.documentElement.style.visibility='hidden';window.location.replace('/app'+s);}})();"
        }}
      />
      <div className={styles.content}>
        <h1 className={styles.heading}>Askmerce</h1>
        <p className={styles.text}>
          Let shoppers search your store the way they talk, and find the
          right products instantly.
        </p>
        <p>
          Install Askmerce from the Shopify App Store, then open it
          from <strong>Apps</strong> in your Shopify admin.
        </p>
        <ul className={styles.list}>
          <li>
            <strong>Natural-language search</strong>. Shoppers can type
            requests like &quot;something warm for winter&quot; and AI finds
            the products that match what they mean.
          </li>
          <li>
            <strong>Instant, typo-tolerant results</strong>. Suggestions appear
            while shoppers type, even with partial words or spelling mistakes,
            right in your existing theme search bar.
          </li>
          <li>
            <strong>Search rules</strong>. Boost, exclude or demote selected
            products in search results to match your merchandising goals.
          </li>
        </ul>
      </div>
    </div>
  );
}
