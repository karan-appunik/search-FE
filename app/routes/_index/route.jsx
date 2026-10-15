import { redirect } from "react-router";
import styles from "./styles.module.css";

// Public landing page. Installation must start from a
// Shopify-owned surface (App Store requirement 2.3.1), so there
// is no "enter your shop domain" form here; merchants install
// and open the app from Shopify.
export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export default function App() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>AI Product Search</h1>
        <p className={styles.text}>
          Let shoppers search your store the way they talk, and find the
          right products instantly.
        </p>
        <p>
          Install AI Product Search from the Shopify App Store, then open it
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
