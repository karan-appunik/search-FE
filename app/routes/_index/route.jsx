import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>AI Product Search</h1>
        <p className={styles.text}>
          Let shoppers search your store the way they talk, and find the
          right products instantly.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
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
